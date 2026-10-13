import { describe, expect, it } from "vitest";
import { fitCopy, normalizeWhitespace } from "../adapters/copy/fit-copy";
import { validateCopyOutput } from "../adapters/copy/validate-copy";
import { FORMAT_CONTRACTS, listFormatContracts, requireFormatContract } from "../formats/registry";
import { isCompatibleFormat, kindForSource, resolveTargetFormat } from "../formats/compatibility";
import { adaptationOutputStorageKey, buildAdaptationRecipe, defaultStorageKeyFor, RECIPE_VERSION } from "../recipe/build-recipe";
import { hashRecipe, parseRecipe } from "../recipe/hash-recipe";
import { hashSourceSnapshot, serializeSourceSnapshot, assertSnapshotIntegrity } from "../source/source-snapshot";
import { validateSnapshot } from "../source/validate-snapshot";
import { deriveBatchProgress, deriveBatchStatus } from "../progress";
import { AdaptationError } from "../errors";
import type { AdaptationJobRecord, AdaptationSourceSnapshot } from "../domain/types";
import { sha256Hex } from "../serialization/hash-adaptation";

const SAMPLE_TEXT =
  "First sentence here. Second sentence here. Third sentence here.";

const writingSnapshot: AdaptationSourceSnapshot = {
  sourceType: "WRITING_VARIANT",
  variantId: "v1",
  documentId: "d1",
  label: "Caption A",
  text: SAMPLE_TEXT,
  textSha256: sha256Hex(SAMPLE_TEXT),
  claims: [
    { text: "First sentence here.", status: "GROUNDED", sourceIds: ["s1"] },
    { text: "Third sentence here.", status: "UNSUPPORTED", sourceIds: ["s2"] },
  ],
};

function job(overrides: Partial<AdaptationJobRecord> = {}): AdaptationJobRecord {
  return {
    id: "j1",
    batchId: "b1",
    projectId: "p1",
    requestedById: "u1",
    platformId: "",
    formatId: "COPY_SHORT",
    kind: "COPY",
    recipe: "{}",
    recipeSha256: "0".repeat(64),
    status: "QUEUED",
    progressPct: 0,
    outputText: null,
    outputMimeType: null,
    outputStorageKey: null,
    outputByteSize: null,
    outputChecksumSha256: null,
    outputWidth: null,
    outputHeight: null,
    renderJobId: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("format registry", () => {
  it("publishes exactly the formats the engine promises", () => {
    expect(FORMAT_CONTRACTS.map((format) => format.id).sort()).toEqual([
      "COPY_CAPTION",
      "COPY_LONG",
      "COPY_MEDIUM",
      "COPY_SHORT",
      "IMAGE_LANDSCAPE",
      "IMAGE_PORTRAIT",
      "IMAGE_SQUARE",
      "IMAGE_TRANSPARENT",
      "IMAGE_VERTICAL",
      "VIDEO_LANDSCAPE",
      "VIDEO_SQUARE",
      "VIDEO_VERTICAL",
    ]);
  });

  it("keeps every image target inside the pixel ceiling", () => {
    for (const format of listFormatContracts("IMAGE")) {
      const pixels = format.image!.width * format.image!.height;

      expect(pixels).toBeLessThanOrEqual(16_000_000);
    }
  });

  it("only marks the transparent format as carrying alpha", () => {
    const alpha = listFormatContracts("IMAGE").filter(
      (format) => format.image?.alpha,
    );

    expect(alpha.map((format) => format.id)).toEqual(["IMAGE_TRANSPARENT"]);
  });

  it("gives the transparent format a contain fit and the rest a cover fit", () => {
    const transparent = requireFormatContract("IMAGE_TRANSPARENT");
    expect(transparent.image?.fit).toBe("CONTAIN");

    for (const id of ["IMAGE_SQUARE", "IMAGE_PORTRAIT", "IMAGE_VERTICAL", "IMAGE_LANDSCAPE"]) {
      expect(requireFormatContract(id).image?.fit).toBe("COVER");
    }
  });

  it("refuses a format nobody defined", () => {
    expect(() => requireFormatContract("IMAGE_TIKTOK_9_16")).toThrowError(
      AdaptationError,
    );
  });
});

describe("source compatibility", () => {
  it("maps each source kind to exactly one adaptation kind", () => {
    expect(kindForSource("WRITING_VARIANT")).toBe("COPY");
    expect(kindForSource("GENERATED_IMAGE")).toBe("IMAGE");
    expect(kindForSource("VISUAL_COMPOSITION")).toBe("VIDEO");
  });

  it("never lets writing become a video", () => {
    expect(isCompatibleFormat("WRITING_VARIANT", requireFormatContract("COPY_SHORT"))).toBe(true);
    expect(isCompatibleFormat("WRITING_VARIANT", requireFormatContract("IMAGE_SQUARE"))).toBe(false);
    expect(isCompatibleFormat("WRITING_VARIANT", requireFormatContract("VIDEO_SQUARE"))).toBe(false);
  });

  it("never lets an image become copy", () => {
    expect(isCompatibleFormat("GENERATED_IMAGE", requireFormatContract("IMAGE_SQUARE"))).toBe(true);
    expect(isCompatibleFormat("GENERATED_IMAGE", requireFormatContract("COPY_SHORT"))).toBe(false);
  });

  it("explains a mismatch rather than silently returning nothing", () => {
    expect(() =>
      resolveTargetFormat({
        sourceType: "GENERATED_IMAGE",
        formatId: "COPY_SHORT",
      }),
    ).toThrowError(/COPY/);
  });
});

describe("copy fitting", () => {
  it("keeps whole sentences while they fit", () => {
    const fitted = fitCopy({
      text: "One two three. Four five six. Seven eight nine.",
      maxCharacters: 80,
      maxWords: 20,
    });

    expect(fitted.text).toBe("One two three. Four five six. Seven eight nine.");
    expect(fitted.truncated).toBe(false);
  });

  it("stops before a sentence that would break the limit", () => {
    const fitted = fitCopy({
      text: "Short one. A much longer second sentence that will not fit at all here.",
      maxCharacters: 20,
      maxWords: 20,
    });

    expect(fitted.text).toBe("Short one.");
    expect(fitted.truncated).toBe(true);
  });

  it("cuts at a word rather than a character when even one sentence is too long", () => {
    const fitted = fitCopy({
      text: "alpha beta gamma delta epsilon",
      maxCharacters: 12,
      maxWords: 20,
    });

    expect(fitted.text).toBe("alpha beta");
    expect(fitted.characterCount).toBeLessThanOrEqual(12);
  });

  it("normalises runs of whitespace without touching the words", () => {
    expect(normalizeWhitespace("  a \n\n b\t c  ")).toBe("a b c");
  });

  it("refuses an output that is not a prefix of its source", () => {
    expect(() =>
      validateCopyOutput({
        outputText: "Something entirely different.",
        sourceText: "The real source text.",
        maxCharacters: 100,
        maxWords: 50,
      }),
    ).toThrowError(AdaptationError);
  });

  it("refuses an output over the format's ceiling", () => {
    expect(() =>
      validateCopyOutput({
        outputText: "x".repeat(50),
        sourceText: "x".repeat(50),
        maxCharacters: 10,
        maxWords: 100,
      }),
    ).toThrowError(AdaptationError);
  });

  it("claims no source for an unsupported claim", async () => {
    const { survivingClaims } = await import("../adapters/copy/validate-copy");

    const kept = survivingClaims({
      outputText: "First sentence here. Third sentence here.",
      claims: writingSnapshot.sourceType === "WRITING_VARIANT" ? writingSnapshot.claims : [],
    });

    expect(kept.claims).toHaveLength(2);
    expect(kept.sourceIds).toEqual(["s1"]);
  });
});

describe("recipes", () => {
  const format = requireFormatContract("COPY_SHORT");
  const recipeArgs = {
    projectId: "p1",
    snapshot: writingSnapshot,
    sourceId: "v1",
    sourceSha256: "a".repeat(64),
    format,
    platformId: null,
    provenanceSourceIds: ["s1"],
    outputStorageKey: "p1/COPY_SHORT-abc/output.txt",
  };

  it("produces the same hash for the same decisions", () => {
    const first = buildAdaptationRecipe(recipeArgs);
    const second = buildAdaptationRecipe(recipeArgs);

    expect(first.recipeSha256).toBe(second.recipeSha256);
    expect(hashRecipe(first.recipe)).toBe(first.recipeSha256);
  });

  it("changes the hash when a decision changes", () => {
    const base = buildAdaptationRecipe(recipeArgs);
    const other = buildAdaptationRecipe({ ...recipeArgs, platformId: "linkedin" });

    expect(base.recipeSha256).not.toBe(other.recipeSha256);
  });

  it("survives a round trip through its serialized form", () => {
    const built = buildAdaptationRecipe(recipeArgs);
    const parsed = parseRecipe(JSON.stringify(built.recipe));

    expect(parsed.formatId).toBe("COPY_SHORT");
    expect(parsed.provenanceSourceIds).toEqual(["s1"]);
    expect(hashRecipe(parsed)).toBe(built.recipeSha256);
  });

  it("refuses a recipe that claims a recipe version it does not know", () => {
    expect(() =>
      parseRecipe(
        JSON.stringify({
          ...buildAdaptationRecipe(recipeArgs).recipe,
          recipeVersion: RECIPE_VERSION + 1,
        }),
      ),
    ).toThrowError(AdaptationError);
  });

  it("claims provenance only from CP06 sources", () => {
    const built = buildAdaptationRecipe(recipeArgs);

    expect(built.recipe.provenanceSourceIds).toEqual(["s1"]);
    expect(JSON.stringify(built.recipe)).not.toContain(recipeArgs.outputStorageKey.slice(0, 5) + "/ab");
  });

  it("derives an output key that cannot escape the project folder", () => {
    const key = defaultStorageKeyFor(recipeArgs);

    expect(key).toMatch(/^p1\/COPY_SHORT-[0-9a-f]{12}\/output\.txt$/);
    expect(key?.startsWith("..")).toBe(false);
    expect(key?.includes("..")).toBe(false);
  });

  it("gives video no output key, because CP15 owns those bytes", () => {
    const videoFormat = requireFormatContract("VIDEO_SQUARE");

    expect(
      adaptationOutputStorageKey({
        projectId: "p1",
        sourceSha256: "a".repeat(64),
        formatId: "VIDEO_SQUARE",
        platformId: null,
        extension: "txt",
      }),
    ).toBeNull();

    expect(
      defaultStorageKeyFor({ ...recipeArgs, format: videoFormat }),
    ).toBeNull();
  });

  it("separates the same source adapted for two platforms", () => {
    const plain = adaptationOutputStorageKey({
      projectId: "p1",
      sourceSha256: "a".repeat(64),
      formatId: "COPY_SHORT",
      platformId: null,
      extension: "txt",
    });
    const tagged = adaptationOutputStorageKey({
      projectId: "p1",
      sourceSha256: "a".repeat(64),
      formatId: "COPY_SHORT",
      platformId: "linkedin",
      extension: "txt",
    });

    expect(plain).not.toBe(tagged);
  });
});

describe("snapshots", () => {
  it("detects a snapshot that was edited after it was frozen", () => {
    const serialized = serializeSourceSnapshot(writingSnapshot);
    const digest = hashSourceSnapshot(serialized);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(() => assertSnapshotIntegrity({ serialized, expectedSha256: digest })).not.toThrow();

    const tampered = serialized.replace("First sentence here.", "Something else entirely.");
    expect(() =>
      assertSnapshotIntegrity({ serialized: tampered, expectedSha256: digest }),
    ).toThrowError(AdaptationError);
  });

  it("rejects a snapshot that claims a source kind it does not hold", () => {
    expect(() =>
      validateSnapshot({
        sourceType: "GENERATED_IMAGE",
        assetId: "a1",
        // A raster snapshot with no bytes metadata is not a raster snapshot.
        storageKey: "k",
        mimeType: "image/png",
      } as unknown as AdaptationSourceSnapshot),
    ).toThrowError(AdaptationError);
  });

  it("accepts a well-formed raster snapshot", () => {
    expect(() =>
      validateSnapshot({
        sourceType: "GENERATED_IMAGE",
        assetId: "a1",
        storageKey: "p1/o/a.png",
        mimeType: "image/png",
        width: 100,
        height: 100,
        checksumSha256: "a".repeat(64),
        transparent: false,
      }),
    ).not.toThrow();
  });
});

describe("batch derivation", () => {
  it("reads a batch that has not started as queued", () => {
    expect(deriveBatchStatus([job()])).toBe("QUEUED");
  });

  it("reads a batch with work in flight as running", () => {
    expect(deriveBatchStatus([job({ status: "RUNNING" }), job({ id: "j2" })])).toBe("RUNNING");
  });

  it("reads a fully successful batch as succeeded at 100%", () => {
    const jobs = [
      job({ status: "SUCCEEDED" }),
      job({ id: "j2", status: "SUCCEEDED" }),
    ];

    expect(deriveBatchStatus(jobs)).toBe("SUCCEEDED");
    expect(deriveBatchProgress(jobs)).toBe(100);
  });

  it("reads a mixed batch as partial rather than failed", () => {
    const jobs = [
      job({ status: "SUCCEEDED" }),
      job({ id: "j2", status: "FAILED" }),
    ];

    expect(deriveBatchStatus(jobs)).toBe("PARTIAL");
    expect(deriveBatchProgress(jobs)).toBe(100);
  });

  it("reads a wholly failed batch as failed", () => {
    expect(
      deriveBatchStatus([job({ status: "FAILED" }), job({ id: "j2", status: "FAILED" })]),
    ).toBe("FAILED");
  });

  it("does not count a job parked on a render as finished", () => {
    const jobs = [
      job({ status: "SUCCEEDED" }),
      job({ id: "j2", status: "WAITING_RENDER" }),
    ];

    expect(deriveBatchProgress(jobs)).toBe(50);
    expect(deriveBatchStatus(jobs)).toBe("RUNNING");
  });

  it("says work is still stopping while a cancellation propagates", () => {
    const jobs = [
      job({ status: "CANCELLED" }),
      job({ id: "j2", status: "CANCEL_REQUESTED" }),
    ];

    expect(deriveBatchStatus(jobs)).toBe("CANCEL_REQUESTED");
    expect(deriveBatchProgress(jobs)).toBe(50);
  });
});
