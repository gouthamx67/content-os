/**
 * The intent model is asked for one JSON object, and providers rarely return
 * exactly that: some fence it, some wrap it in a sentence. These tests pin both
 * the recovery and the refusals, because a provider that returns prose instead
 * of an object must not be mistaken for a provider that returned a reading.
 */
import { describe, expect, it, vi } from "vitest";

import {
  AiContentIntentInterpreter,
} from "./content-intent-interpreter";
import { extractIntentJsonObject } from "./interpret-content-intent-text";
import type { AIProvider } from "../../core/ports/ai-provider";
import { CONTENT_TYPES } from "../../core/domain/content-type";
import { PLATFORMS } from "../../core/domain/platform";

function providerReturning(text: string): AIProvider {
  return {
    generate: vi.fn(async () => ({ text, model: "test-model" })),
  };
}

describe("extractIntentJsonObject", () => {
  it("reads a bare object", () => {
    expect(extractIntentJsonObject('{"contentTypeId":"video.ad"}')).toEqual({
      contentTypeId: "video.ad",
    });
  });

  it("reads an object inside a fence", () => {
    const fenced = '```json\n{"contentTypeId":"video.explainer"}\n```';
    expect(extractIntentJsonObject(fenced)).toEqual({ contentTypeId: "video.explainer" });
  });

  it("reads an object the model wrapped in prose", () => {
    const wrapped = 'Sure! Here is the reading:\n{"contentTypeId":"text.linkedin"}\nHope that helps.';
    expect(extractIntentJsonObject(wrapped)).toEqual({ contentTypeId: "text.linkedin" });
  });

  it("refuses prose with no object in it rather than guessing", () => {
    // A made-up reading here would be worse than a failure: the intent would
    // look resolved when nothing was read at all.
    expect(() => extractIntentJsonObject("I could not determine the content type."))
      .toThrowError(/did not return a JSON object/i);
  });

  it("refuses a truncated object instead of returning half of one", () => {
    // There is no closing brace to find, so there is nothing to salvage.
    expect(() => extractIntentJsonObject('{"contentTypeId":"video.launch"'))
      .toThrowError(/did not return a JSON object/i);
  });

  it("refuses an object that is present but malformed", () => {
    expect(() => extractIntentJsonObject('{"contentTypeId": }'))
      .toThrowError(/malformed JSON/i);
  });
});

describe("AiContentIntentInterpreter", () => {
  const request = {
    projectId: "prj_1",
    rawRequest: "Make a launch video for LinkedIn",
    contentTypes: CONTENT_TYPES,
    platforms: PLATFORMS,
  };

  it("returns a validated reading with the identity of the model that made it", async () => {
    const interpreter = new AiContentIntentInterpreter(
      providerReturning('```json\n{"contentTypeId":"video.launch"}\n```'),
    );

    const result = await interpreter.interpret(request);

    expect(result.contentTypeId).toBe("video.launch");
    expect(result.provider).toBe("ai-content-intent");
    expect(result.model).toBe("test-model");
  });

  it("sends the available content type ids, so the model cannot invent one", async () => {
    const provider = providerReturning("{}");
    const interpreter = new AiContentIntentInterpreter(provider);

    await interpreter.interpret(request);

    const sent = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMessage = sent.messages.find(
      (message: { role: string }) => message.role === "user",
    )?.content as string;
    expect(userMessage).toContain("video.launch");
    expect(userMessage).toContain("linkedin");
    // The request itself goes in verbatim: the model is reading the user's words,
    // not a summary of them.
    expect(userMessage).toContain("Make a launch video for LinkedIn");
    expect(sent.temperature).toBe(0);
  });

  it("refuses a reading that reaches for creative direction", async () => {
    const interpreter = new AiContentIntentInterpreter(
      providerReturning('{"contentTypeId":"video.launch","hook":"Watch this"}'),
    );

    await expect(interpreter.interpret(request)).rejects.toThrowError();
  });

  it("refuses a reading that names a content type outside the registry", async () => {
    const interpreter = new AiContentIntentInterpreter(
      providerReturning('{"contentTypeId":"video.podcast"}'),
    );

    await expect(interpreter.interpret(request)).rejects.toThrowError();
  });

  it("refuses a reading that invents a platform", async () => {
    const interpreter = new AiContentIntentInterpreter(
      providerReturning('{"contentTypeId":"video.launch","platforms":["myspace"]}'),
    );

    await expect(interpreter.interpret(request)).rejects.toThrowError();
  });
});
