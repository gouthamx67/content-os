import { describe, expect, it } from "vitest";
import { ContentIntentParser } from "./content-intent-parser";

const parser = new ContentIntentParser();

describe("ContentIntentParser", () => {
  it("resolves an explicit launch video", () => {
    const parsed = parser.parse("Make a launch video");

    expect(parsed.contentTypeId).toBe("video.launch");
    expect(parsed.contentTypeOrigin).toBe("EXPLICIT");
    expect(parsed.channel).toBe("VIDEO");
    expect(parsed.unresolvedFields).not.toContain("contentType");
  });

  it("resolves a LinkedIn post to the text type", () => {
    const parsed = parser.parse("Create a LinkedIn post announcing this feature");

    expect(parsed.contentTypeId).toBe("text.linkedin");
    expect(parsed.channel).toBe("TEXT");
    expect(parsed.platforms).toEqual(["linkedin"]);
    expect(parsed.purpose).toBe("feature_announcement");
  });

  it("resolves a thumbnail", () => {
    const parsed = parser.parse("Make a thumbnail");

    expect(parsed.contentTypeId).toBe("image.thumbnail");
    expect(parsed.channel).toBe("IMAGE");
  });

  it("resolves a quantity of TikTok concepts as an inferred social video", () => {
    const parsed = parser.parse("Create 5 TikTok concepts");

    expect(parsed.contentTypeId).toBe("video.social");
    expect(parsed.contentTypeOrigin).toBe("INFERRED");
    expect(parsed.platforms).toEqual(["tiktok"]);
    expect(parsed.quantity).toBe(5);
  });

  it("reads a word number quantity", () => {
    const parsed = parser.parse("Turn this into five TikTok concepts");

    expect(parsed.quantity).toBe(5);
  });

  it("reads LinkedIn hooks as a text intent with a quantity", () => {
    const parsed = parser.parse("Give me 3 LinkedIn hooks");

    expect(parsed.contentTypeId).toBe("text.linkedin");
    expect(parsed.platforms).toEqual(["linkedin"]);
    expect(parsed.quantity).toBe(3);
  });

  it("counts a batch even when each item carries its own duration", () => {
    const parsed = parser.parse(
      "Make three 45 second cinematic launch videos for LinkedIn",
    );

    // The 45 belongs to each video; the three belongs to the request.
    expect(parsed.quantity).toBe(3);
    expect(parsed.durationSeconds).toBe(45);
    expect(parsed.contentTypeId).toBe("video.launch");
  });

  it("reads a plural format noun as the same type as its singular", () => {
    expect(parser.parse("Make a launch video for LinkedIn").contentTypeId).toBe(
      "video.launch",
    );
    expect(parser.parse("Make launch videos for LinkedIn").contentTypeId).toBe(
      "video.launch",
    );
    expect(parser.parse("Write three LinkedIn posts").contentTypeId).toBe(
      "text.linkedin",
    );
    expect(parser.parse("Run two video ads").contentTypeId).toBe("video.ad");
  });

  it("still refuses to read a bare measurement as a count", () => {
    const ratio = parser.parse("Make a 16:9 launch video");
    expect(ratio.quantity).toBe(1);
    expect(ratio.aspectRatio).toBe("16:9");

    const minutes = parser.parse("Make 3 minute explainer videos");
    expect(minutes.quantity).toBe(1);
    expect(minutes.durationSeconds).toBe(180);
  });

  it("prefers a campaign over the video inside it", () => {
    const parsed = parser.parse("Create a launch campaign with a video");

    expect(parsed.contentTypeId).toBe("campaign.launch");
    expect(parsed.channel).toBe("CAMPAIGN");
  });

  it("keeps a Product Hunt video a video", () => {
    const parsed = parser.parse("Make a Product Hunt launch video");

    expect(parsed.contentTypeId).toBe("video.launch");
  });

  it("treats a bare Product Hunt request as launch copy", () => {
    const parsed = parser.parse("Write the Product Hunt listing");

    expect(parsed.contentTypeId).toBe("text.product_hunt");
  });

  it.each([
    ["30 second video", 30],
    ["30 seconds video", 30],
    ["15 sec video", 15],
    ["a 45s launch video", 45],
    ["0:30 launch video", 30],
    ["half a minute launch video", 30],
    ["a 2 minute explainer", 120],
  ])("normalises duration in %s", (request, seconds) => {
    expect(parser.parse(request).durationSeconds).toBe(seconds);
  });

  it("does not read an aspect ratio as a duration", () => {
    const parsed = parser.parse("Make a 16:9 launch video");

    expect(parsed.durationSeconds).toBeUndefined();
    expect(parsed.aspectRatioCandidates).toEqual(["16:9"]);
  });

  it.each([
    ["vertical", "9:16"],
    ["portrait", "9:16"],
    ["9:16", "9:16"],
    ["square", "1:1"],
    ["1:1", "1:1"],
    ["landscape", "16:9"],
    ["16:9", "16:9"],
  ])("normalises the aspect ratio phrase %s", (phrase, ratio) => {
    const parsed = parser.parse(`Make a ${phrase} TikTok video`);

    expect(parsed.aspectRatio).toBe(ratio);
  });

  it("records both readings of a contradictory aspect ratio so it can be reported", () => {
    const parsed = parser.parse("Make a 16:9 vertical TikTok video");

    expect(parsed.aspectRatioCandidates).toEqual(["16:9", "9:16"]);
  });

  it("reads custom dimensions as a custom ratio", () => {
    const parsed = parser.parse("Make a 1080x1920 launch video");

    expect(parsed.aspectRatio).toBe("CUSTOM");
    expect(parsed.customAspectRatio).toEqual({ width: 1080, height: 1920 });
  });

  it("normalises a language name to a code", () => {
    expect(parser.parse("Turn this into a LinkedIn announcement in Hindi").language).toBe("hi");
    expect(parser.parse("Create a launch video in Spanish").language).toBe("es");
    expect(parser.parse("Create a launch video in French").language).toBe("fr");
  });

  it("keeps tone and style separate", () => {
    const technical = parser.parse("Make a technical minimal video");
    expect(technical.tone).toBe("technical");
    expect(technical.style).toBe("minimal");

    const confident = parser.parse("Make a confident cinematic video");
    expect(confident.tone).toBe("confident");
    expect(confident.style).toBe("cinematic");
  });

  it("reads premium as a tone and a style without collapsing them", () => {
    const parsed = parser.parse("Make a premium launch video");

    expect(parsed.tone).toBe("premium");
    expect(parsed.style).toBe("premium");
  });

  it("reads an audience without swallowing the platform", () => {
    const parsed = parser.parse("Make a launch video for startup founders");

    expect(parsed.audience).toBe("startup founders");
    expect(parsed.platforms).toEqual([]);
  });

  it("does not read a platform as an audience", () => {
    const parsed = parser.parse("Make a 30 second launch video for LinkedIn");

    expect(parsed.audience).toBeUndefined();
    expect(parsed.platforms).toEqual(["linkedin"]);
  });

  it("reads audiences for known segments", () => {
    expect(parser.parse("Make a video for developers").audience).toBe("developers");
    expect(parser.parse("Make a video for marketers").audience).toBe("marketers");
    expect(parser.parse("Make a video for product teams").audience).toBe("product teams");
  });

  it.each([
    ['with a "Start free" CTA', "Start free"],
    ["CTA: Join the waitlist", "Join the waitlist"],
    ['end with "Try it today"', "Try it today"],
  ])("reads the CTA in %s", (request, cta) => {
    expect(parser.parse(`Make a launch video ${request}`).cta).toBe(cta);
  });

  it("does not invent a CTA the user did not supply", () => {
    expect(parser.parse("Make a launch video").cta).toBeUndefined();
  });

  it("reads X as a platform and a type", () => {
    const parsed = parser.parse("Write an X post about the launch");

    expect(parsed.contentTypeId).toBe("text.x");
    expect(parsed.platforms).toEqual(["x"]);
  });

  it("records a subject mention without resolving it", () => {
    const parsed = parser.parse("Make a demo of the analytics workflow");

    expect(parsed.contentTypeId).toBe("video.product_demo");
    expect(parsed.subjectMentions).toEqual([
      { type: "WORKFLOW", label: "analytics" },
    ]);
  });

  it("records a feature mention", () => {
    const parsed = parser.parse(
      "Create 5 TikTok concepts about the analytics feature",
    );

    expect(parsed.subjectMentions).toEqual([{ type: "FEATURE", label: "analytics" }]);
  });

  it("leaves an implicit request unresolved instead of inventing an output", () => {
    for (const request of [
      "Make something for this.",
      "Create content for this.",
      "Turn this into content.",
      "Help me launch this.",
      "Make this better.",
      "Make something great from this.",
    ]) {
      const parsed = parser.parse(request);

      expect(parsed.contentTypeId).toBeUndefined();
      expect(parsed.unresolvedFields).toContain("contentType");
    }
  });

  it("keeps what is known when the output is unknown", () => {
    const parsed = parser.parse("Make this look premium.");

    expect(parsed.contentTypeId).toBeUndefined();
    expect(parsed.tone).toBe("premium");
    expect(parsed.unresolvedFields).toEqual(["contentType"]);
  });

  it("keeps both durations so the conflict can be reported", () => {
    const parsed = parser.parse("Make a 15 second or 30 second launch video");

    expect(parsed.durationCandidates).toEqual([15, 30]);
    expect(parsed.durationSeconds).toBe(15);
  });

  it("records constraints with the user as their source", () => {
    const parsed = parser.parse("Make a 30 second 9:16 TikTok video for developers");

    expect(parsed.constraints).toContainEqual({
      key: "duration",
      value: "30",
      source: "USER",
    });
    expect(parsed.constraints).toContainEqual({
      key: "aspectRatio",
      value: "9:16",
      source: "USER",
    });
    expect(parsed.constraints).toContainEqual({
      key: "platform",
      value: "tiktok",
      source: "USER",
    });
  });

  it("does not read a word-number quantity as a duration", () => {
    const parsed = parser.parse("Make five product videos");

    expect(parsed.durationSeconds).toBeUndefined();
    expect(parsed.quantity).toBe(5);
  });

  it("reads a voiceover as audio", () => {
    const parsed = parser.parse("Record a voiceover for the launch video");

    expect(parsed.contentTypeId).toBe("audio.voiceover");
    expect(parsed.channel).toBe("AUDIO");
  });
});
