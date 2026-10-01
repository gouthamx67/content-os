import { describe, expect, it } from "vitest";
import { buildOpportunityKey, indexOpportunityKeys, parseOpportunityKey } from "./recommendation-key";

describe("buildOpportunityKey", () => {
  it("is stable for the same opportunity across generations", () => {
    const first = buildOpportunityKey({
      contentTypeId: "video.product_demo",
      subjectType: "FEATURE",
      subjectId: "analytics-reporting",
      platform: "linkedin",
    });
    const second = buildOpportunityKey({
      contentTypeId: "video.product_demo",
      subjectType: "FEATURE",
      subjectId: "analytics-reporting",
      platform: "linkedin",
    });

    expect(first).toBe(second);
  });

  it("distinguishes the same subject on different platforms", () => {
    const linkedin = buildOpportunityKey({
      contentTypeId: "video.product_demo",
      subjectType: "FEATURE",
      subjectId: "analytics-reporting",
      platform: "linkedin",
    });
    const youtube = buildOpportunityKey({
      contentTypeId: "video.product_demo",
      subjectType: "FEATURE",
      subjectId: "analytics-reporting",
      platform: "youtube",
    });

    expect(linkedin).not.toBe(youtube);
  });

  it("distinguishes different content types for the same subject and platform", () => {
    const demo = buildOpportunityKey({
      contentTypeId: "video.product_demo",
      subjectType: "FEATURE",
      subjectId: "reporting",
      platform: "linkedin",
    });
    const graphic = buildOpportunityKey({
      contentTypeId: "image.ad",
      subjectType: "FEATURE",
      subjectId: "reporting",
      platform: "linkedin",
    });

    expect(demo).not.toBe(graphic);
  });

  it("distinguishes different subjects for the same content type and platform", () => {
    const analytics = buildOpportunityKey({
      contentTypeId: "video.product_demo",
      subjectType: "FEATURE",
      subjectId: "analytics",
      platform: "linkedin",
    });
    const integrations = buildOpportunityKey({
      contentTypeId: "video.product_demo",
      subjectType: "FEATURE",
      subjectId: "integrations",
      platform: "linkedin",
    });

    expect(analytics).not.toBe(integrations);
  });

  it("keeps a content type id readable rather than slugging it", () => {
    // Slugging would turn this into "video-product-demo", which is not the CP09
    // id and could never be handed back to the Content Intent bridge.
    const key = buildOpportunityKey({
      contentTypeId: "video.product_demo",
      subjectType: "PRODUCT",
      subjectId: null,
      platform: "youtube",
    });

    expect(key).toContain("video.product_demo");
    expect(parseOpportunityKey(key)?.contentTypeId).toBe("video.product_demo");
  });

  it("records a label fallback when there is no subject id", () => {
    const key = buildOpportunityKey({
      contentTypeId: "video.product_demo",
      subjectType: "PRODUCT",
      subjectId: null,
      platform: "youtube",
      subjectLabel: "Content OS",
    });

    expect(parseOpportunityKey(key)).toMatchObject({
      subjectType: "PRODUCT",
      subjectId: null,
      subjectIsLabel: true,
    });
  });

  it("survives a change in subject label when an id exists", () => {
    const before = buildOpportunityKey({
      contentTypeId: "video.product_demo",
      subjectType: "FEATURE",
      subjectId: "reporting",
      platform: "linkedin",
    });
    const after = buildOpportunityKey({
      contentTypeId: "video.product_demo",
      subjectType: "FEATURE",
      subjectId: "reporting",
      platform: "linkedin",
      subjectLabel: "Renamed Reporting Feature",
    });

    expect(after).toBe(before);
  });
});

describe("parseOpportunityKey", () => {
  it("returns null for a key it did not produce", () => {
    expect(parseOpportunityKey("nonsense")).toBeNull();
    expect(parseOpportunityKey("a:b:c")).toBeNull();
  });

  it("round-trips an id-based key", () => {
    const key = buildOpportunityKey({
      contentTypeId: "image.carousel",
      subjectType: "WORKFLOW",
      subjectId: "onboarding",
      platform: "linkedin",
    });

    expect(parseOpportunityKey(key)).toEqual({
      contentTypeId: "image.carousel",
      subjectType: "WORKFLOW",
      subjectId: "onboarding",
      subjectLabel: null,
      platform: "linkedin",
      subjectIsLabel: false,
    });
  });
});

describe("indexOpportunityKeys", () => {
  it("maps keys to ids", () => {
    const { index, collisions, malformed } = indexOpportunityKeys([
      { id: "rec-1", key: "video.product_demo|FEATURE|id:reporting|linkedin" },
      { id: "rec-2", key: "image.ad|FEATURE|id:reporting|linkedin" },
    ]);

    expect(collisions).toEqual([]);
    expect(malformed).toEqual([]);
    expect(index.keyToOpportunity.get("video.product_demo|FEATURE|id:reporting|linkedin")).toBe("rec-1");
    expect(index.keyToOpportunity.get("image.ad|FEATURE|id:reporting|linkedin")).toBe("rec-2");
  });

  it("reports a key that cannot be parsed instead of indexing it", () => {
    // A malformed key can never equal one `buildOpportunityKey` produces, so the
    // row it belongs to is invisible to reconciliation. Indexing it would hide
    // that; reporting it makes it a surfaced data problem.
    const { index, malformed } = indexOpportunityKeys([
      { id: "rec-1", key: "video.product_demo|FEATURE|id:reporting|linkedin" },
      { id: "rec-2", key: "not-a-real-key" },
    ]);

    expect(malformed).toEqual(["not-a-real-key"]);
    expect(index.keyToOpportunity.size).toBe(1);
    expect(index.keyToOpportunity.has("not-a-real-key")).toBe(false);
  });

  it("reports a collision instead of silently picking a winner", () => {
    const { index, collisions } = indexOpportunityKeys([
      { id: "rec-1", key: "video.product_demo|FEATURE|id:reporting|linkedin" },
      { id: "rec-2", key: "video.product_demo|FEATURE|id:reporting|linkedin" },
    ]);

    expect(collisions).toEqual(["video.product_demo|FEATURE|id:reporting|linkedin"]);
    // The first wins the map so lookups stay deterministic, but the collision
    // is surfaced rather than resolved.
    expect(index.keyToOpportunity.size).toBe(1);
  });
});
