import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  BASE,
  cleanupOwner,
  cleanupProject,
  cookieFor,
  createProject,
  createWritingDocument,
  loadLocalizationTestContext,
  registerUser,
  request,
  type Orm,
  type Owner,
  type Services,
} from "./helpers";

/**
 * HTTP-boundary proof that the localization engine performs real translation.
 *
 * A real HTTP server stands in for the project's OpenAI-compatible model. It
 * translates English into Spanish (a small dictionary, applied deterministically)
 * so the test never depends on a vendor key while still exercising the actual
 * network boundary: the provider posts a prompt, parses the model's JSON, and the
 * pipeline carries the translated text through validation, approval, apply and
 * export — with the provider and model recorded as provenance.
 */

type IdCtx = { id: string };
type JobCtx = { id: string; jobId: string };
type Handler<P> = (
  request: Request,
  context: { params: Promise<P> },
) => Promise<Response>;
type Route<P> = { GET?: Handler<P>; POST?: Handler<P> };

type Job = {
  id: string;
  status: string;
  provider: string | null;
  targetLocale: string;
};
type Segment = {
  id: string;
  sourceText: string;
  targetText: string | null;
};
type Detail = {
  job: Job;
  snapshot: {
    provider: string | null;
    providerModel: string | null;
    segments: Segment[];
  };
  revisionNumber: number;
};

const DICTIONARY: Record<string, string> = {
  hello: "hola",
  world: "mundo",
  second: "segunda",
  paragraph: "párrafo",
  launch: "lanzamiento",
  headline: "titular",
};

function translate(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) => {
    const mapped = DICTIONARY[word.toLowerCase()];
    if (!mapped) return word;
    return /^[A-Z]/.test(word)
      ? mapped.charAt(0).toUpperCase() + mapped.slice(1)
      : mapped;
  });
}

let server: ReturnType<typeof createServer>;
let capturedPrompt = "";
let services: Services;
let orm: Orm;
let jobsRoute: Route<IdCtx>;
let processRoute: Route<JobCtx>;
let validateRoute: Route<JobCtx>;
let reviewRoute: Route<JobCtx>;
let applyRoute: Route<JobCtx>;
let exportRoute: Route<JobCtx>;
let glossaryRoute: Route<IdCtx>;
let owner: Owner;
let projectId = "";
let sourceDocumentId = "";

function action(
  route: Route<JobCtx>,
  jobId: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return route.POST!(
    request(`${BASE}/_`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cookie: cookieFor(owner.token),
      origin: BASE,
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id: projectId, jobId }) },
  );
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(raw) as { messages?: { content?: string }[] };
      capturedPrompt = parsed.messages?.[1]?.content ?? "";

      const segments = [...capturedPrompt.matchAll(/^\{"segmentId".*\}$/gm)]
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

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
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

  process.env["LOCALIZATION_LLM_BASE_URL"] = `http://127.0.0.1:${port}/v1`;
  process.env["LOCALIZATION_LLM_MODEL"] = "stub-mt-1";

  const loaded = await loadLocalizationTestContext();
  services = loaded.services;
  orm = loaded.orm;

  const localesRoute = (await import(
    "../../../app/api/projects/[id]/locales/route"
  )) as unknown as Route<IdCtx>;
  jobsRoute = (await import(
    "../../../app/api/projects/[id]/localization/route"
  )) as unknown as Route<IdCtx>;
  processRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/process/route"
  )) as unknown as Route<JobCtx>;
  validateRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/validate/route"
  )) as unknown as Route<JobCtx>;
  reviewRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/review/route"
  )) as unknown as Route<JobCtx>;
  applyRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/apply/route"
  )) as unknown as Route<JobCtx>;
  exportRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/export/route"
  )) as unknown as Route<JobCtx>;
  glossaryRoute = (await import(
    "../../../app/api/projects/[id]/localization/glossary/route"
  )) as unknown as Route<IdCtx>;

  owner = await registerUser(services, "cp22-translate");
  projectId = await createProject(services, owner, "Translation project");

  const locales: Array<[string, { isSource?: boolean; isTarget?: boolean }]> = [
    ["en", { isSource: true, isTarget: false }],
    ["es", { isSource: false, isTarget: true }],
  ];
  for (const [locale, flags] of locales) {
    const response = await localesRoute.POST!(
      request(`${BASE}/api/projects/${projectId}/locales`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(owner.token),
        origin: BASE,
        body: JSON.stringify({ locale, ...flags }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(response.status).toBe(201);
  }

  sourceDocumentId = await createWritingDocument(orm, {
    projectId,
    userId: owner.user.id,
    content: "Hello world.\n\nSecond paragraph.",
  });
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  delete process.env["LOCALIZATION_LLM_BASE_URL"];
  delete process.env["LOCALIZATION_LLM_MODEL"];
  if (orm) {
    await cleanupProject(orm, owner, projectId);
    await cleanupOwner(orm, owner);
  }
});

describe("localization with a real translation provider", () => {
  it("translates English source into Spanish across the full lifecycle", async () => {
    const glossary = await glossaryRoute.POST!(
      request(`${BASE}/api/projects/${projectId}/localization/glossary`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(owner.token),
        origin: BASE,
        body: JSON.stringify({
          sourceLocale: "en",
          targetLocale: "es",
          term: "Hello",
          translation: "Hola",
        }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(glossary.status).toBe(201);

    const created = await jobsRoute.POST!(
      request(`${BASE}/api/projects/${projectId}/localization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(owner.token),
        origin: BASE,
        body: JSON.stringify({
          sourceType: "WRITING_DOCUMENT",
          sourceId: sourceDocumentId,
          targetLocale: "es",
          strategy: "TRANSLATE",
        }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(created.status).toBe(201);
    const createdDetail = (await created.json()) as Detail;

    const processed = await action(processRoute, createdDetail.job.id, {
      expectedRevisionNumber: createdDetail.revisionNumber,
      provider: "remote-llm",
    });
    expect(processed.status).toBe(200);
    const processedDetail = (await processed.json()) as Detail;

    expect(processedDetail.job.status).toBe("NEEDS_REVIEW");
    expect(processedDetail.job.provider).toBe("remote-llm");
    expect(processedDetail.snapshot.provider).toBe("remote-llm");
    expect(processedDetail.snapshot.providerModel).toBe("stub-mt-1");

    const targets = processedDetail.snapshot.segments.map((segment) => ({
      source: segment.sourceText,
      target: segment.targetText ?? "",
    }));
    expect(targets.length).toBeGreaterThan(0);
    for (const pair of targets) {
      expect(pair.target).not.toBe(pair.source);
    }
    const processedText = targets.map((pair) => pair.target).join(" ");
    expect(processedText).toContain("Hola");
    expect(processedText).toContain("mundo");

    expect(capturedPrompt).toContain("en to es");
    expect(capturedPrompt).toContain("Hello => Hola");
    expect(capturedPrompt).toContain("each segment from en to es");

    const validated = await action(validateRoute, createdDetail.job.id, {
      expectedRevisionNumber: processedDetail.revisionNumber,
    });
    expect(validated.status).toBe(200);
    const validatedDetail = (await validated.json()) as Detail;

    const approved = await action(reviewRoute, createdDetail.job.id, {
      expectedRevisionNumber: validatedDetail.revisionNumber,
      decision: "APPROVE",
    });
    expect(approved.status).toBe(200);
    const approvedDetail = (await approved.json()) as Detail;
    expect(approvedDetail.job.status).toBe("APPROVED");

    const applied = await action(applyRoute, createdDetail.job.id, {
      expectedRevisionNumber: approvedDetail.revisionNumber,
    });
    expect(applied.status).toBe(200);
    const appliedDetail = (await applied.json()) as Detail;
    expect(appliedDetail.job.status).toBe("APPLIED");

    const exported = await exportRoute.GET!(
      request(
        `${BASE}/api/projects/${projectId}/localization/${createdDetail.job.id}/export`,
        { cookie: cookieFor(owner.token) },
      ),
      {
        params: Promise.resolve({
          id: projectId,
          jobId: createdDetail.job.id,
        }),
      },
    );
    expect(exported.status).toBe(200);
    const artifact = (await exported.json()) as {
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
    for (const segment of artifact.segments) {
      expect(segment.targetText).not.toBe(segment.sourceText);
    }
    const target = artifact.segments
      .map((segment) => segment.targetText ?? "")
      .join(" ");
    expect(target).toContain("Hola");
    expect(target).toContain("mundo");
  });
});
