import { ContentIntentError } from "../../core/domain/content-intent";
import type { ContentIntentInterpretationRequest } from "../../core/ports/content-intent-interpreter";

export const CONTENT_INTENT_SYSTEM_PROMPT = [
  "You resolve what a user asked for. You do not decide what to make creatively.",
  "Return only a JSON object using the allowed fields and nothing else.",
  "contentTypeId must be one of the provided content type ids, or omitted when the request does not identify an asset.",
  "Never invent a platform, a duration, an aspect ratio, a language, a content type or a quantity that the user did not imply.",
  "You must not return a hook, story, angle, scene, script, treatment, audience persona or call to action: those are decided by later checkpoints.",
  "If the request is vague, return only the fields you are sure about and leave the rest out.",
].join(" ");

export function extractIntentJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Models often wrap JSON in prose; retry with the outermost braces.
  }

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ContentIntentError(
      "INTENT_AI_INVALID_OUTPUT",
      "Intent model did not return a JSON object",
    );
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (cause) {
    throw new ContentIntentError(
      "INTENT_AI_INVALID_OUTPUT",
      `Intent model returned malformed JSON: ${
        cause instanceof Error ? cause.message : "unparseable"
      }`,
    );
  }
}

export function buildContentIntentPrompt(
  request: ContentIntentInterpretationRequest,
): string {
  return [
    "Task: resolve the content request below into the fields it actually states.",
    "",
    "User request:",
    request.rawRequest,
    "",
    "Available content types (use these ids exactly):",
    request.contentTypes
      .map(
        (contentType) =>
          `- ${contentType.id} (${contentType.channel}) ${contentType.name}: ${contentType.description}`,
      )
      .join("\n") || "- (none)",
    "",
    "Available platforms (use these ids exactly):",
    request.platforms
      .map((platform) => `- ${platform.id} (${platform.name}): ${platform.channels.join(", ")}`)
      .join("\n") || "- (none)",
    "",
    "Project context:",
    request.projectContext ?? "- (none)",
    "",
    "Brand context:",
    request.brandContext ?? "- (none)",
    "",
    "Product intelligence:",
    request.intelligenceSummary ?? "- (none)",
    "",
    "Response shape (omit any field the request does not state):",
    "{",
    '  "contentTypeId": "<content type id>",',
    '  "purpose": "<purpose>",',
    '  "platforms": ["<platform id>"],',
    '  "durationSeconds": <integer>,',
    '  "aspectRatio": "16:9|9:16|1:1|4:5|4:3",',
    '  "language": "<language code>",',
    '  "tone": "<tone>",',
    '  "style": "<style>",',
    '  "quantity": <integer>,',
    '  "notes": ["<short note>"]',
    "}",
  ].join("\n");
}
