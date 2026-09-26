import { describe, expect, it } from "vitest";
import {
  extractBenefits,
  extractProblems,
  extractWorkflows,
  type InsightCandidate,
} from "./insight-extraction";
import { splitSentences } from "./text";

function candidates(text: string, section: string | null = null): InsightCandidate[] {
  return splitSentences(text).map((sentence) => ({
    text: sentence,
    section,
    locator: `s:${splitSentences(text).indexOf(sentence)}`,
  }));
}

const LAUNCH_BRIEF = [
  "Launchboard helps marketing teams ship launch content faster.",
  "Marketing teams currently spend hours manually rewriting the same launch announcement for every channel.",
  "Most teams lose track of which version was published where.",
  "Launchboard adapts one campaign for every platform, so you can publish everywhere from a single brief.",
  "It cuts the manual work per launch and keeps every channel consistent.",
  "To publish, create a campaign, generate platform-specific drafts, review the drafts, then publish the final versions.",
].join(" ");

describe("deterministic insight extraction", () => {
  it("extracts a problem with evidence from real source language", () => {
    const problems = extractProblems(candidates(LAUNCH_BRIEF));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.map((problem) => problem.name).join(" ")).toMatch(/hour|manual|rewrit|track|version/i);
    for (const problem of problems) {
      expect(problem.excerpt.length).toBeGreaterThan(0);
      expect(LAUNCH_BRIEF).toContain(problem.excerpt.replace(/…$/, ""));
      expect(problem.painKind).toBeTruthy();
    }
  });

  it("extracts a benefit without copying a feature name", () => {
    const benefits = extractBenefits(candidates(LAUNCH_BRIEF), [
      "Campaign workspace",
      "Platform-specific drafts",
    ]);
    expect(benefits.length).toBeGreaterThan(0);
    for (const benefit of benefits) {
      expect(LAUNCH_BRIEF).toContain(benefit.excerpt.replace(/…$/, ""));
      expect(["Campaign workspace", "Platform-specific drafts"]).not.toContain(benefit.name);
    }
  });

  it("extracts an ordered workflow with steps", () => {
    const workflows = extractWorkflows(candidates(LAUNCH_BRIEF));
    expect(workflows).toHaveLength(1);
    const [workflow] = workflows;
    expect(workflow?.steps.length).toBeGreaterThanOrEqual(3);
    expect(workflow?.name.length).toBeGreaterThan(3);
    expect(workflow?.excerpt).toMatch(/publish/i);
  });

  it("distinguishes a problem from a benefit for the same subject", () => {
    const text =
      "Teams waste hours exporting data by hand. Automating export means analysts get their numbers in seconds.";
    const problems = extractProblems(candidates(text));
    const benefits = extractBenefits(candidates(text));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.name).not.toBe(benefits[0]?.name);
  });

  it("emits nothing when the source states no pain, outcome or sequence", () => {
    const text = "The dashboard renders a chart. The chart uses a color palette from the theme.";
    expect(extractProblems(candidates(text))).toHaveLength(0);
    expect(extractBenefits(candidates(text))).toHaveLength(0);
    expect(extractWorkflows(candidates(text))).toHaveLength(0);
  });

  it("deduplicates a pain repeated by a second source", () => {
    const text = [
      "Teams waste hours rewriting launch copy.",
      "Teams waste hours rewriting launch copy.",
    ].join(" ");
    const problems = extractProblems(candidates(text));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.excerpt).toContain("rewriting launch copy");
  });

  it("never ends an entity name on a dangling quantifier or preposition", () => {
    const problems = extractProblems(
      candidates("Teams lose hours manually rewriting one launch announcement for every channel."),
    );
    expect(problems).toHaveLength(1);
    const name = problems[0]!.name.toLowerCase();
    for (const dangling of [" every", " each", " across", " for", " per", " between"]) {
      expect(name.endsWith(dangling)).toBe(false);
    }
    expect(name).toContain("launch announcement");
  });

  it("keeps genuinely different pains apart", () => {
    const text = [
      "Teams waste hours rewriting launch copy.",
      "Analysts lose track of which numbers were reported last quarter.",
    ].join(" ");
    expect(extractProblems(candidates(text))).toHaveLength(2);
  });

  it("does not treat a feature name as a problem or a benefit", () => {
    const text = "Platform-specific drafts. Campaign workspace. Real-time dashboards.";
    expect(extractProblems(candidates(text), ["Real-time dashboards"])).toHaveLength(0);
    expect(extractBenefits(candidates(text), ["Campaign workspace"])).toHaveLength(0);
  });

  it("requires ordered actions before accepting a workflow", () => {
    const text = "Fast, simple and reliable. Cheap, open source and modern.";
    expect(extractWorkflows(candidates(text))).toHaveLength(0);
  });

  it("accepts a flow described by a heading plus ordered actions", () => {
    const text = "Create a campaign, generate the drafts, review them and publish the final versions.";
    const scoped = candidates(text, "Publishing workflow");
    const workflows = extractWorkflows(scoped);
    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.name).toBe("Publishing workflow");
    expect(workflows[0]?.steps.map((step) => step.action)).toHaveLength(4);
  });

  it("keeps the section with the candidate so provenance can be scoped", () => {
    const text = "Teams waste hours rebuilding the same report for every stakeholder.";
    const [problem] = extractProblems(candidates(text, "Reporting"));
    expect(problem?.section).toBe("Reporting");
  });
});
