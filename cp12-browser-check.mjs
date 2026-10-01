import { chromium } from "playwright-core";

const BASE = "http://localhost:3111";
const stamp = Date.now();
const email = `browser-${stamp}@test.local`;
const password = "BrowserTest123!";

const json = (r) => (r.status === 204 ? null : r.json());

async function api(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, body: await json(res), setCookie };
}

const fail = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(name);
};

// ---- Seed a project through the real HTTP API -------------------------------
const reg = await api("/api/auth/register", {
  method: "POST",
  body: { email, password },
});
check("register", reg.status === 200 || reg.status === 201, `status ${reg.status}`);

const session = (reg.setCookie ?? "").split(";")[0];
check("session cookie issued", session.startsWith("content_os_session="), session.slice(0, 40));

const ws = await api("/api/workspaces", { method: "POST", body: { name: "CP12 QA" }, cookie: session });
const workspaceId = ws.body?.workspace?.id ?? ws.body?.id;
check("workspace created", Boolean(workspaceId), String(ws.status));

const pj = await api(`/api/workspaces/${workspaceId}/projects`, {
  method: "POST",
  body: { name: "CP12 Browser Project" },
  cookie: session,
});
const projectId = pj.body?.project?.id ?? pj.body?.id;
check("project created", Boolean(projectId), String(pj.status));

const brief = [
  "Northwind Analytics turns messy product research into a weekly content plan.",
  "It analyses every uploaded source, extracts features, workflows, problems and benefits,",
  "and proposes content grounded only in those extracted facts.",
  "Key features: automated source analysis, evidence-backed entity extraction, weekly planning,",
  "and a content gap detector that spots formats the project has never used.",
  "Teams struggle with repetitive briefs and inconsistent brand voice across channels.",
  "Benefits include less repetitive work, faster drafts, and analytics-ready content.",
].join(" ");

const input = await api(`/api/projects/${projectId}/inputs`, {
  method: "POST",
  body: { inputs: [{ type: "text", name: "Product brief", value: brief }] },
  cookie: session,
});
check("source ingested", input.status === 200 || input.status === 201, String(input.status));

const analyze = await api(`/api/projects/${projectId}/intelligence/analyze`, {
  method: "POST",
  body: {},
  cookie: session,
});
check("intelligence analyzed", analyze.status === 200, String(analyze.status));

const gen = await api(`/api/projects/${projectId}/recommendations/generate`, {
  method: "POST",
  cookie: session,
});
check("recommendations generated", gen.status === 200, String(gen.status));

const recs = gen.body?.recommendations ?? [];
check("at least one recommendation", recs.length > 0, `${recs.length} items`);
check(
  "API serves isProgress",
  recs.length > 0 && typeof recs[0].isProgress === "boolean",
  JSON.stringify(recs[0]?.isProgress),
);
const leakedPriority = recs.filter((r) => Object.hasOwn(r, "priorityScore"));
check("API hides priorityScore", leakedPriority.length === 0, `${leakedPriority.length} leaked`);
check(
  "every recommendation carries real source ids",
  recs.length > 0 && recs.every((r) => r.evidence?.sourceIds?.length > 0),
  JSON.stringify(recs[0]?.evidence),
);
check(
  "every recommendation carries a stable key",
  recs.length > 0 && recs.every((r) => typeof r.key === "string" && r.key.length > 0),
);

// ---- Drive the real UI ------------------------------------------------------
const browser = await chromium.launch({
  executablePath:
    "/home/gouthamx67/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext();
await ctx.addCookies([
  {
    name: session.split("=")[0],
    value: session.split("=").slice(1).join("="),
    domain: "localhost",
    path: "/",
  },
]);
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(`${BASE}/projects/${projectId}`, { waitUntil: "networkidle" });

const panelHeading = await page
  .getByRole("heading", { name: /what this project could make next/i })
  .count()
  .catch(() => 0);
check("recommendation panel renders", panelHeading > 0, `heading matches=${panelHeading}`);

// The panel lists the recommendations the API returned.
const title = recs[0]?.title ?? "";
if (title) {
  const shown = await page.getByText(title.slice(0, 40), { exact: false }).count().catch(() => 0);
  check("first recommendation rendered in the panel", shown > 0, `"${title.slice(0, 40)}" matches=${shown}`);
}

// Platform names come from the CP09 registry, not raw storage ids.
const bodyText = await page.locator("body").innerText();
const leaked = recs.filter((r) => new RegExp(`\\b${r.platform}\\b`).test(bodyText));
check(
  "no raw platform id shown where a display name exists",
  leaked.length === 0,
  leaked.map((r) => r.platform).join(","),
);

// The reason must not claim an entity is unevidenced while its evidence is cited.
const contradicted = recs.filter((r) =>
  r.evidence?.sourceIds?.length > 0 &&
  r.reasons?.some((x) => /asserted without supporting evidence/i.test(x)),
);
check(
  "no reason contradicts attached evidence",
  contradicted.length === 0,
  contradicted.map((r) => r.key).join(","),
);

// Dismiss round-trip through the UI.
if (title) {
  const before = recs.length;
  await page.getByText(title.slice(0, 40), { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const dismissBtn = page.getByRole("button", { name: /not (for me|now)|dismiss|skip/i }).first();
  const hasDismiss = await dismissBtn.count().catch(() => 0);
  if (hasDismiss) {
    await dismissBtn.click();
    await page.waitForTimeout(1500);
    const after = await api(`/api/projects/${projectId}/recommendations?status=DISMISSED`, { cookie: session });
    const dismissed = after.body?.recommendations ?? [];
    check("dismiss persisted through the UI", dismissed.length > 0, `${dismissed.length} dismissed (of ${before})`);
  } else {
    check("dismiss control present", false, "no dismiss button found");
  }
}

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await page.screenshot({ path: "/tmp/opencode/cp12-panel.png", fullPage: true });
await browser.close();

console.log(`\n${fail.length === 0 ? "ALL CHECKS PASSED" : `FAILED: ${fail.join(", ")}`}`);
process.exit(fail.length === 0 ? 0 : 1);
