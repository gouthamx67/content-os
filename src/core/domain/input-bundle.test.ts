import { describe, expect, it } from "vitest";
import type { Source } from "./source";
import { createInputBundle } from "./input-bundle";

const projectId = "project-1";

function source(overrides: Partial<Source> & Pick<Source, "id" | "contentHash">): Source {
  return {
    projectId,
    type: "TEXT",
    name: "Input",
    uri: null,
    metadata: null,
    status: "READY",
    mimeType: "text/plain",
    sizeBytes: 4,
    storageKey: `projects/${projectId}/inputs/${overrides.contentHash}/original`,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("createInputBundle", () => {
  it("groups verified inputs by content hash and keeps unversioned inputs explicit", () => {
    const bundle = createInputBundle(projectId, [
      source({ id: "source-1", contentHash: "hash-a" }),
      source({ id: "source-2", contentHash: "hash-a" }),
      source({ id: "source-3", contentHash: null, storageKey: null, status: "QUEUED" }),
      source({ id: "source-4", contentHash: null, storageKey: null, status: "FAILED", errorCode: "INVALID_URL" }),
    ]);

    expect(bundle.versions).toEqual([
      {
        contentHash: "hash-a",
        sourceIds: ["source-1", "source-2"],
      },
    ]);
    expect(bundle.unversioned.map((input) => input.id)).toEqual(["source-3", "source-4"]);
    expect(bundle.inputs).toHaveLength(4);
  });

  it("rejects sources outside the requested project", () => {
    expect(() =>
      createInputBundle(projectId, [
        source({
          id: "source-1",
          contentHash: "hash-a",
          projectId: "project-2",
        }),
      ]),
    ).toThrowError("Input bundle contains a source from another project");
  });
});
