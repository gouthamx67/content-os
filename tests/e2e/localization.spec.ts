import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import {
  BASE_URL,
  cleanupE2EUser,
  registerBrowserUser,
  SESSION_COOKIE,
  startStack,
  stopStack,
  type E2EStack,
  type RegisteredBrowserUser,
} from "./support/image-harness";

/**
 * Real browser proof of CP22 localization.
 *
 * A writing document is localized through the actual UI: the job is processed,
 * reviewed, approved, applied and its artifact previewed. The guards that make
 * localization trustworthy — no export before apply, no cross-project read, and
 * a source change that staleness — are exercised against the same server.
 *
 * The remote-llm spec also drives the real provider boundary: the server is
 * started with a local OpenAI-compatible endpoint as its translation model, so
 * the browser flow records remote-llm provenance without a vendor key.
 */

type Services = typeof import("../../src/infrastructure/services");
type Orm = Awaited<ReturnType<typeof loadOrm>>["orm"];

async function loadOrm() {
  const dbModule = await import("../../src/prisma/db");
  return { orm: dbModule.db.orm.public };
}

let stack: E2EStack;
let services: Services;
let orm: Orm;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
let projectId: string;
let otherProjectId: string;
let documentId: string;
let email = "";
let translationStub: {
  server: ReturnType<typeof createServer>;
  baseUrl: string;
} | undefined;

async function createWritingDocument(args: {
  projectId: string;
  userId: string;
  content: string;
  version: number;
}): Promise<string> {
  const { createHash } = await import("node:crypto");
  const sha = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const id = `wdoc-${Math.random().toString(36).slice(2, 10)}`;

  await orm.WritingDocument.create({
    id,
    projectId: args.projectId,
    createdById: args.userId,
    title: "Localization source headline",
    blockType: "BODY",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    audience: "Launch audience",
    language: "en",
    content: args.content,
    contentSha256: sha(args.content),
    contextSnapshot: "{}",
    contextSha256: sha("{}"),
    version: args.version,
  });

  return id;
}

/**
 * An OpenAI-compatible endpoint standing in for the vendor model. The remote-llm
 * provider posts a prompt containing the pending segments; this server applies a
 * small English-to-Spanish dictionary and answers in the JSON shape a real model
 * would, so the browser flow crosses a real network boundary and records
 * `remote-llm` / `stub-mt-1` as provenance instead of faking provider success.
 */
async function startTranslationStub(): Promise<{
  server: ReturnType<typeof createServer>;
  baseUrl: string;
}> {
  const dictionary: Record<string, string> = {
    hello: "hola",
    world: "mundo",
    second: "segunda",
    paragraph: "párrafo",
    launch: "lanzamiento",
    headline: "titular",
  };

  const translate = (text: string) =>
    text.replace(/[A-Za-z]+/g, (word) => {
      const mapped = dictionary[word.toLowerCase()];
      if (!mapped) return word;
      return /^[A-Z]/.test(word)
        ? mapped.charAt(0).toUpperCase() + mapped.slice(1)
        : mapped;
    });

  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const parsed = JSON.parse(raw) as { messages?: { content?: string }[] };
      const prompt = parsed.messages?.[1]?.content ?? "";
      const segments = [...prompt.matchAll(/^\{"segmentId".*\}$/gm)]
        .map(
          (match) =>
            JSON.parse(match[0]) as {
              segmentId: string;
              sourceText: string;
            },
        )
        .map((segment) => ({
          segmentId: segment.segmentId,
          targetText: translate(segment.sourceText),
        }));

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          model: "stub-mt-1",
          choices: [{ message: { content: JSON.stringify({ segments }) } }],
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}/v1` };
}

beforeAll(async () => {
  translationStub = await startTranslationStub();
  process.env["LOCALIZATION_LLM_BASE_URL"] = translationStub.baseUrl;
  process.env["LOCALIZATION_LLM_MODEL"] = "stub-mt-1";

  stack = await startStack();
  if (!stack.reachable || !stack.available) return;

  services = await import("../../src/infrastructure/services");
  ({ orm } = await loadOrm());

  email = `cp22-localization-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP22 localization" },
    user.userId,
  );
  projectId = project.id;

  const other = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP22 other project" },
    user.userId,
  );
  otherProjectId = other.id;

  documentId = await createWritingDocument({
    projectId,
    userId: user.userId,
    content: "First paragraph.\n\nSecond paragraph with {brand} token.",
    version: 1,
  });

  browser = await chromium.launch({
    executablePath: stack.executablePath,
    args: ["--no-sandbox"],
  });
  context = await browser.newContext();
  await context.addCookies([
    { name: SESSION_COOKIE, value: user.cookieValue, url: BASE_URL },
  ]);
});

afterAll(async () => {
  if (browser) await browser.close();
  if (user) {
    await cleanupE2EUser(email, user.workspaceId, [
      projectId,
      otherProjectId,
    ]).catch(() => undefined);
  }
  if (stack) stopStack(stack);
  if (translationStub) {
    const stub = translationStub;
    await new Promise<void>((resolve) => stub.server.close(() => resolve()));
    translationStub = undefined;
  }
  delete process.env["LOCALIZATION_LLM_BASE_URL"];
  delete process.env["LOCALIZATION_LLM_MODEL"];
});

describe("CP22 localization", () => {
  it("localizes, reviews, applies and previews an artifact through the UI", async () => {
    if (!stack.reachable || !stack.available) {
      return;
    }

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/localization`, {
      waitUntil: "domcontentloaded",
    });

    await page.getByTestId("locale-code").fill("en");
    await page.getByTestId("locale-is-source").check();
    await page.getByTestId("add-locale").click();
    await expect
      .poll(
        async () =>
          page.getByTestId("locale-row").filter({ hasText: "en" }).count(),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    await page.getByTestId("locale-code").fill("pt-br");
    await page.getByTestId("locale-label").fill("Brazilian Portuguese");
    await page.getByTestId("add-locale").click();
    await expect
      .poll(
        async () =>
          page.getByTestId("locale-row").filter({ hasText: "pt-BR" }).count(),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    await expect
      .poll(
        async () => page.getByTestId("localization-target").inputValue(),
        { timeout: 15_000 },
      )
      .toBe("pt-BR");

    await page.getByTestId("create-localization").click();

    await page
      .getByTestId("localization-title")
      .waitFor({ state: "visible", timeout: 15_000 });
    await expect
      .poll(async () => page.getByTestId("localization-status").textContent(), {
        timeout: 15_000,
      })
      .toContain("READY_TO_LOCALIZE");

    await page.getByTestId("segment-row").first().waitFor({ state: "visible" });

    await page.getByTestId("process-localization").click();
    await expect
      .poll(async () => page.getByTestId("localization-status").textContent(), {
        timeout: 15_000,
      })
      .toContain("NEEDS_REVIEW");

    await page.getByTestId("approve-localization").click();
    await expect
      .poll(async () => page.getByTestId("localization-status").textContent(), {
        timeout: 15_000,
      })
      .toContain("APPROVED");

    await page.getByTestId("apply-localization").click();
    await expect
      .poll(async () => page.getByTestId("localization-status").textContent(), {
        timeout: 15_000,
      })
      .toContain("APPLIED");

    await page.getByTestId("preview-artifact").click();
    await page
      .getByTestId("artifact-json")
      .waitFor({ state: "visible", timeout: 15_000 });
    const artifact = (await page.getByTestId("artifact-json").textContent())!;
    expect(artifact).toContain("pt-BR");
    expect(artifact).toContain("schemaVersion");
    expect(artifact).toContain("targetHash");

    await page.close();
  });

  it("refuses export before apply and rejects cross-project access", async () => {
    if (!stack.reachable || !stack.available) {
      return;
    }

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/localization`, {
      waitUntil: "domcontentloaded",
    });

    const created = await page.request.post(
      `${BASE_URL}/api/projects/${projectId}/localization`,
      {
        data: {
          sourceType: "WRITING_DOCUMENT",
          sourceId: documentId,
          targetLocale: "pt-BR",
          strategy: "TRANSLATE",
        },
      },
    );
    expect(created.status()).toBe(201);
    const jobId = ((await created.json()) as { job: { id: string } }).job.id;

    const refused = await page.request.get(
      `${BASE_URL}/api/projects/${projectId}/localization/${jobId}/export`,
    );
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { code?: string }).code).toBe(
      "LOCALIZATION_NOT_APPROVED",
    );

    const crossProject = await page.request.get(
      `${BASE_URL}/api/projects/${otherProjectId}/localization/${jobId}/export`,
    );
    expect(crossProject.status()).toBe(404);

    await page.close();
  });

  it("marks a job stale when its source changes", async () => {
    if (!stack.reachable || !stack.available) {
      return;
    }

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/localization`, {
      waitUntil: "domcontentloaded",
    });

    const created = await page.request.post(
      `${BASE_URL}/api/projects/${projectId}/localization`,
      {
        data: {
          sourceType: "WRITING_DOCUMENT",
          sourceId: documentId,
          targetLocale: "pt-BR",
          strategy: "TRANSLATE",
        },
      },
    );
    expect(created.status()).toBe(201);
    const detail = (await created.json()) as {
      job: { id: string };
      revisionNumber: number;
    };

    await orm.WritingDocument.where({ id: documentId }).update({
      version: 2,
      content: "Revised paragraph.\n\nNow with different copy.",
    });

    const validated = await page.request.post(
      `${BASE_URL}/api/projects/${projectId}/localization/${detail.job.id}/validate`,
      { data: { expectedRevisionNumber: detail.revisionNumber } },
    );
    expect(validated.status()).toBe(200);
    const body = (await validated.json()) as {
      stale: boolean;
      job: { status: string };
    };
    expect(body.stale).toBe(true);
    expect(body.job.status).toBe("STALE");

    await page.close();
  });

  it("uses remote-llm provider and preserves source hash through the UI", async () => {
    expect(stack).toBeDefined();
    expect(stack.reachable).toBe(true);
    expect(stack.available).toBe(true);

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/localization`, {
      waitUntil: "domcontentloaded",
    });

    // The project already seeds "en" as source in this spec; make sure both
    // locales the job needs exist before creating it.
    const existing = (await (
      await page.request.get(`${BASE_URL}/api/projects/${projectId}/locales`)
    ).json()) as { locales: { locale: string }[] };
    const known = new Set(existing.locales.map((entry) => entry.locale));

    if (!known.has("en")) {
      const seededSource = await page.request.post(
        `${BASE_URL}/api/projects/${projectId}/locales`,
        { data: { locale: "en", isSource: true, isTarget: false } },
      );
      expect(seededSource.status()).toBe(201);
    }

    if (!known.has("es")) {
      const seededTarget = await page.request.post(
        `${BASE_URL}/api/projects/${projectId}/locales`,
        { data: { locale: "es", isSource: false, isTarget: true } },
      );
      expect(seededTarget.status()).toBe(201);
    }

    // A dedicated document keeps this spec independent of the source mutation
    // the staleness spec performs on the shared document.
    const localizedDocumentId = await createWritingDocument({
      projectId,
      userId: user.userId,
      content: "Hello world.\n\nSecond paragraph.",
      version: 1,
    });
    const sourceHashBefore = (
      await orm.WritingDocument.where({ id: localizedDocumentId }).first()
    )!.contentSha256;

    const created = await page.request.post(
      `${BASE_URL}/api/projects/${projectId}/localization`,
      {
        data: {
          sourceType: "WRITING_DOCUMENT",
          sourceId: localizedDocumentId,
          targetLocale: "es",
          strategy: "TRANSLATE",
        },
      },
    );
    expect(created.status()).toBe(201);
    const createdJob = ((await created.json()) as { job: { id: string } }).job;

    await page.goto(
      `${BASE_URL}/projects/${projectId}/localization/${createdJob.id}`,
      { waitUntil: "domcontentloaded" },
    );

    const providerSelect = page.getByTestId("localization-provider");
    await providerSelect.waitFor({ state: "visible", timeout: 15_000 });
    const providerNames = await providerSelect
      .locator("option")
      .allTextContents();
    expect(providerNames).toContain("remote-llm");

    await providerSelect.selectOption("remote-llm");
    expect(await providerSelect.inputValue()).toBe("remote-llm");

    await page.getByTestId("process-localization").click();
    await expect
      .poll(async () => page.getByTestId("localization-status").textContent(), {
        timeout: 30_000,
      })
      .toContain("NEEDS_REVIEW");

    await page.getByTestId("validate-localization").click();
    await expect
      .poll(
        async () =>
          page
            .locator(
              '[data-testid="history-row"][data-revision-kind="VALIDATED"]',
            )
            .count(),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    await page.getByTestId("approve-localization").click();
    await expect
      .poll(async () => page.getByTestId("localization-status").textContent(), {
        timeout: 15_000,
      })
      .toContain("APPROVED");

    await page.getByTestId("apply-localization").click();
    await expect
      .poll(async () => page.getByTestId("localization-status").textContent(), {
        timeout: 15_000,
      })
      .toContain("APPLIED");

    await page.getByTestId("preview-artifact").click();
    await page
      .getByTestId("artifact-json")
      .waitFor({ state: "visible", timeout: 15_000 });
    const artifact = JSON.parse(
      (await page.getByTestId("artifact-json").textContent())!,
    ) as {
      targetLocale: string;
      provider: string;
      providerModel: string | null;
      status: string;
      segments: { sourceText: string; targetText: string | null }[];
    };

    expect(artifact.targetLocale).toBe("es");
    expect(artifact.provider).toBe("remote-llm");
    expect(artifact.providerModel).toBe("stub-mt-1");
    expect(artifact.status).toBe("APPLIED");
    expect(artifact.segments.length).toBeGreaterThan(0);
    for (const segment of artifact.segments) {
      expect(segment.targetText).toBeTruthy();
      expect(segment.targetText).not.toBe(segment.sourceText);
    }

    const targetText = artifact.segments
      .map((segment) => segment.targetText ?? "")
      .join(" ");
    expect(targetText).toContain("Hola");
    expect(targetText).toContain("mundo");

    const sourceAfter = await orm.WritingDocument.where({
      id: localizedDocumentId,
    }).first();
    expect(sourceAfter!.contentSha256).toBe(sourceHashBefore);
    expect(sourceAfter!.content).toBe("Hello world.\n\nSecond paragraph.");

    await page.close();
  });
});
