/**
 * The AI creative director is the only path where text a model wrote becomes a
 * stored creative direction. These tests pin that the response is unwrapped,
 * that every direction is checked against the project's own material before the
 * service sees it, and that a malformed response raises instead of degrading
 * into a weaker answer.
 */
import { describe, expect, it, vi } from "vitest";

import { AiCreativeDirector } from "./creative-director";
import { extractCreativeJson } from "./creative-director-prompt";
import type { AIProvider } from "../../core/ports/ai-provider";
import type { CreativeDirectorRequest } from "../../core/ports/creative-director";
import { makeCreativeContext } from "../../testing/fakes";
import { CreativeValidationFailure } from "../../core/services/creative-direction-validator";

function providerReturning(text: string): AIProvider {
  return {
    generate: vi.fn(async () => ({ text, model: "test-model" })),
  };
}

const context = makeCreativeContext({ mode: "BALANCED" });
const request: CreativeDirectorRequest = {
  context,
  count: 3,
  angles: [
    "PROBLEM_SOLUTION",
    "PRODUCT_FIRST",
    "WORKFLOW",
    "TRANSFORMATION",
    "FOUNDER",
    "TECHNICAL",
    "SOCIAL",
    "EMOTIONAL",
    "EDUCATIONAL",
    "BEFORE_AFTER",
  ],
};

const grounded = {
  name: "The chase, then the fix",
  angle: "PROBLEM_SOLUTION",
  thesis: "The chase eats a morning and scheduling removes it",
  hook: {
    statement: "Chasing status eats a morning",
    mechanism: "Open on a real moment",
    emotionalTrigger: "Recognition",
  },
  audienceAngle: "For engineering leads",
  emotionalAngle: "Relief",
  narrativeSummary: "The problem, then the fix, then the proof",
  visualStrategy: {
    approach: "The real schedule screen",
    rationale: "The real screen is the proof",
    productMoments: ["The export queue"],
    assetIds: ["as_1"],
  },
  proofStrategy: {
    claimIds: ["cl_1"],
    evidenceIds: ["ev_1"],
    proofPoints: ["Show the queued export"],
  },
  voiceDirection: "Plain and direct",
  musicDirection: "Low and sustained",
  soundDirection: "Interface sound",
  cta: "Start free trial",
  rationale: "It uses what the project recorded",
};

describe("extractCreativeJson", () => {
  it("reads a bare array", () => {
    expect(extractCreativeJson("[]")).toEqual([]);
  });

  it("reads a wrapped directions object", () => {
    expect(extractCreativeJson('{"directions":[{"name":"A"}]}')).toEqual({
      directions: [{ name: "A" }],
    });
  });

  it("reads an array inside a fence", () => {
    const fenced = '```json\n[{"name":"A"}]\n```';
    expect(extractCreativeJson(fenced)).toEqual([{ name: "A" }]);
  });

  it("reads an array the model wrapped in prose", () => {
    const wrapped = 'Here are three directions:\n[{"name":"A"}]\nLet me know.';
    expect(extractCreativeJson(wrapped)).toEqual([{ name: "A" }]);
  });

  it("refuses prose rather than inventing directions from it", () => {
    expect(() => extractCreativeJson("I cannot help with that request."))
      .toThrowError(/did not return a JSON object/i);
  });

  it("refuses a truncated array instead of returning half of one", () => {
    // There is no closing bracket, so there is nothing to salvage.
    expect(() => extractCreativeJson('[{"name":"A"}')).toThrowError(/not valid JSON/i);
  });
});

describe("AiCreativeDirector", () => {
  it("turns a fenced array of directions into proposals", async () => {
    const director = new AiCreativeDirector(
      providerReturning("```json\n" + JSON.stringify([grounded]) + "\n```"),
    );

    const result = await director.generate(request);

    expect(result.provider).toBe("ai-creative-director");
    expect(result.model).toBe("test-model");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].name).toBe("The chase, then the fix");
    expect(result.proposals[0].draft.angle).toBe("PROBLEM_SOLUTION");
  });

  it("reads the wrapped directions object as readily as a bare array", async () => {
    const director = new AiCreativeDirector(
      providerReturning(JSON.stringify({ directions: [grounded] })),
    );
    const result = await director.generate(request);
    expect(result.proposals).toHaveLength(1);
  });

  it("takes the model's own id and description when it sent them", async () => {
    const director = new AiCreativeDirector(
      providerReturning(
        JSON.stringify([{ ...grounded, id: "d-9", description: "A calmer open" }]),
      ),
    );
    const result = await director.generate(request);
    expect(result.proposals[0].id).toBe("d-9");
    expect(result.proposals[0].description).toBe("A calmer open");
  });

  it("raises rather than returning prose", async () => {
    const director = new AiCreativeDirector(
      providerReturning("I would rather not answer in that format."),
    );
    await expect(director.generate(request)).rejects.toBeInstanceOf(
      CreativeValidationFailure,
    );
  });

  it("raises on an empty direction list rather than returning nothing", async () => {
    const director = new AiCreativeDirector(providerReturning("[]"));
    await expect(director.generate(request)).rejects.toThrow(/no directions/i);
  });

  it("refuses a direction that cites a claim the project does not have", async () => {
    const director = new AiCreativeDirector(
      providerReturning(
        JSON.stringify([
          {
            ...grounded,
            proofStrategy: { ...grounded.proofStrategy, claimIds: ["cl_invented"] },
          },
        ]),
      ),
    );
    await expect(director.generate(request)).rejects.toBeInstanceOf(
      CreativeValidationFailure,
    );
  });

  it("refuses a direction that invents a number no claim supports", async () => {
    const director = new AiCreativeDirector(
      providerReturning(
        JSON.stringify([{ ...grounded, thesis: "Teams ship 10x faster" }]),
      ),
    );
    await expect(director.generate(request)).rejects.toBeInstanceOf(
      CreativeValidationFailure,
    );
  });

  it("refuses a field the domain does not have instead of dropping it", async () => {
    const director = new AiCreativeDirector(
      providerReturning(JSON.stringify([{ ...grounded, scenes: ["a beat"] }])),
    );
    await expect(director.generate(request)).rejects.toBeInstanceOf(
      CreativeValidationFailure,
    );
  });

  it("tells the model which mode it is writing for", async () => {
    const ai = providerReturning(JSON.stringify([grounded]));
    const director = new AiCreativeDirector(ai, { defaultModel: "claude-x" });

    await director.generate({ ...request, context: { ...context, mode: "WILD" } });

    const call = vi.mocked(ai.generate).mock.calls[0][0];
    expect(call.model).toBe("claude-x");
    expect(call.temperature).toBe(0.9);
    expect(call.metadata).toMatchObject({ mode: "WILD", purpose: "creative-direction" });
    expect(call.messages[0].content).toContain("WILD");
    // The claim ids the model is allowed to cite travel with the prompt.
    expect(call.messages[1].content).toContain("cl_1");
  });

  it("keeps a grounded direction out of reach of a stale mode", async () => {
    // The same text is fine in Wild and refused in Guided, which is only true if
    // the parse is checked against the mode the caller asked for.
    const wild = new AiCreativeDirector(
      providerReturning(
        JSON.stringify([
          {
            ...grounded,
            angle: "EMOTIONAL",
            hook: {
              statement: "Imagine if your status update sent itself",
              mechanism: "Open on a metaphor",
              emotionalTrigger: "Delight",
            },
          },
        ]),
      ),
    );
    await expect(
      wild.generate({ ...request, context: { ...context, mode: "WILD" } }),
    ).resolves.toBeTruthy();

    const guided = new AiCreativeDirector(
      providerReturning(
        JSON.stringify([
          {
            ...grounded,
            angle: "EMOTIONAL",
            hook: {
              statement: "Imagine if your status update sent itself",
              mechanism: "Open on a metaphor",
              emotionalTrigger: "Delight",
            },
          },
        ]),
      ),
    );
    await expect(
      guided.generate({ ...request, context: { ...context, mode: "GUIDED" } }),
    ).rejects.toBeInstanceOf(CreativeValidationFailure);
  });
});
