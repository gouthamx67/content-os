import { describe, expect, it } from "vitest";
import { InputError, SOURCE_STATUS_TO_PUBLIC, SOURCE_TYPE_TO_INPUT_KIND } from "../core/domain/input";
import type { Source } from "../core/domain/source";
import { parseInputRequest, serializeInput, serializeSource, wrapInputHttpError } from "./input-api";

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: "source-1",
    projectId: "project-1",
    type: "TEXT",
    name: "Brief",
    uri: null,
    metadata: JSON.stringify({ origin: "clipboard" }),
    status: "READY",
    mimeType: "text/plain",
    sizeBytes: 5,
    contentHash: "a".repeat(64),
    storageKey: "projects/project-1/inputs/hash/original",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseInputRequest", () => {
  it("accepts a true mixed JSON batch", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inputs: [
          { type: "url", kind: "web_app", value: "https://example.com" },
          { type: "repository", provider: "github", value: "https://github.com/acme/site" },
          { type: "text", name: "Notes", value: "Hello" },
        ],
      }),
    });

    await expect(parseInputRequest(request)).resolves.toEqual([
      { type: "url", kind: "web_app", value: "https://example.com" },
      { type: "repository", provider: "github", value: "https://github.com/acme/site" },
      { type: "text", name: "Notes", value: "Hello" },
    ]);
  });

  it("groups multipart folder files while retaining independent uploads", async () => {
    const form = new FormData();
    form.set(
      "inputs",
      JSON.stringify([
        { type: "upload", fileIndex: 0 },
        { type: "folder", name: "checkout", fileIndices: [1, 2] },
      ]),
    );
    form.append("files", new File(["export {};"], "index.ts", { type: "text/plain" }));
    form.append("files", new File(["# Demo"], "README.md", { type: "text/markdown" }));
    form.append("files", new File(["body"], "style.css", { type: "text/css" }));
    const request = new Request("http://localhost/api", { method: "POST", body: form });

    const inputs = await parseInputRequest(request);

    expect(inputs[0]).toMatchObject({ type: "upload", file: { name: "index.ts" } });
    expect(inputs[1]).toMatchObject({
      type: "folder",
      name: "checkout",
      files: [
        { name: "README.md", relativePath: "README.md" },
        { name: "style.css", relativePath: "style.css" },
      ],
    });
  });

  it("rejects malformed and oversized request envelopes", async () => {
    const malformed = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs: {} }),
    });
    await expect(parseInputRequest(malformed)).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const oversized = new Request("http://localhost/api", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=test",
        "content-length": String(151 * 1024 * 1024),
      },
      body: "ignored",
    });
    await expect(parseInputRequest(oversized)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });

    const oversizedJsonBody = JSON.stringify({
      inputs: [{ type: "text", value: "x".repeat(6 * 1024 * 1024) }],
    });
    const streamedJson = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(oversizedJsonBody));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(streamedJson.headers.get("content-length")).toBeNull();
    await expect(parseInputRequest(streamedJson)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });

    const unsupported = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs: [{ type: "unknown", value: "x" }] }),
    });
    await expect(parseInputRequest(unsupported)).rejects.toMatchObject({
      code: "UNSUPPORTED_INPUT_TYPE",
    });

    const jsonUpload = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs: [{ type: "upload", fileIndex: 0 }] }),
    });
    await expect(parseInputRequest(jsonUpload)).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const excessiveForm = new FormData();
    for (let index = 0; index < 21; index += 1) {
      excessiveForm.append("files", new File(["x"], `${index}.txt`, { type: "text/plain" }));
    }
    await expect(
      parseInputRequest(
        new Request("http://localhost/api", { method: "POST", body: excessiveForm }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("input HTTP representation", () => {
  it("returns canonical API values without storage paths", () => {
    expect(serializeInput(source())).toEqual({
      id: "source-1",
      projectId: "project-1",
      kind: "text",
      name: "Brief",
      origin: "clipboard",
      uri: null,
      status: "ready",
      mimeType: "text/plain",
      sizeBytes: 5,
      contentHash: "a".repeat(64),
      metadata: { origin: "clipboard" },
      error: null,
      createdAt: "2026-09-25T00:00:00.000Z",
      updatedAt: "2026-09-25T00:00:00.000Z",
    });
  });

  it("omits storage internals from legacy source responses while retaining type", () => {
    const serialized = serializeSource(source());
    expect(serialized.type).toBe("TEXT");
    expect(serialized).not.toHaveProperty("storageKey");
    expect(serialized.contentHash).toBe("a".repeat(64));
  });

  it("maps stable ingestion errors to appropriate HTTP statuses", () => {
    expect(wrapInputHttpError(new InputError("INVALID_FILE", "bad file")).status).toBe(400);
    expect(wrapInputHttpError(new InputError("FILE_TOO_LARGE", "large")).status).toBe(413);
    expect(wrapInputHttpError(new InputError("UNSUPPORTED_INPUT_TYPE", "type")).status).toBe(415);
    expect(wrapInputHttpError(new InputError("URL_TIMEOUT", "timeout")).status).toBe(504);
    expect(wrapInputHttpError(new InputError("STORAGE_FAILED", "storage")).status).toBe(500);
  });

  it("keeps domain mappings exhaustive", () => {
    expect(SOURCE_TYPE_TO_INPUT_KIND.WEB_APP).toBe("web_app");
    expect(SOURCE_STATUS_TO_PUBLIC.PROCESSING).toBe("processing");
  });
});
