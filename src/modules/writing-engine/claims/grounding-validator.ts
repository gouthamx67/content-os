import { numbersIn } from "../../../core/services/copy-claims";
import type { ClaimStatus, WritingContext, WritingFact } from "../domain/types";
import { matchProhibitedClaim } from "./prohibited-claim-patterns";
import { resolveFactSourceIds } from "./source-resolver";

export type GroundingVerdict = {
  status: ClaimStatus;
  sourceIds: string[];
  reasoning: string;
};

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
  "have", "in", "into", "is", "it", "its", "of", "on", "or", "that", "the",
  "their", "them", "they", "this", "to", "with", "you", "your", "our", "we",
  "can", "will", "so", "than", "then", "when", "how", "what", "which", "who",
  "product", "products", "feature", "features", "tool", "tools", "platform",
  "teams", "team", "users", "user", "people", "things", "thing", "really",
  "very", "just", "more", "most", "every", "each", "also", "get", "gets",
  "make", "makes", "made", "use", "uses", "using", "one", "all", "new",
]);

export function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

export function normalizeClaimText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function overlapCount(a: readonly string[], b: readonly string[]): number {
  const set = new Set(b);
  let count = 0;
  const seen = new Set<string>();
  for (const token of a) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (set.has(token)) count += 1;
  }
  return count;
}

/** Facts whose own text substantially overlaps the claim. */
export function factsSupporting(
  claimText: string,
  context: WritingContext,
): WritingFact[] {
  const normalizedClaim = normalizeClaimText(claimText);
  if (!normalizedClaim) return [];
  const claimTokens = significantTokens(claimText);
  const supporting: WritingFact[] = [];

  for (const fact of context.facts) {
    const normalizedFact = normalizeClaimText(fact.text);
    if (!normalizedFact) continue;

    if (
      normalizedFact === normalizedClaim ||
      (normalizedFact.length >= 10 && normalizedClaim.includes(normalizedFact))
    ) {
      supporting.push(fact);
      continue;
    }

    const factTokens = significantTokens(fact.text);
    if (factTokens.length === 0 || claimTokens.length === 0) continue;

    const shared = overlapCount(claimTokens, factTokens);
    const ratio = shared / Math.min(claimTokens.length, factTokens.length);
    if (shared >= 2 && ratio >= 0.5) supporting.push(fact);
  }

  return supporting;
}

function numbersSupportedByFacts(claimText: string, facts: readonly WritingFact[]): boolean {
  const wanted = numbersIn(claimText).map((value) => value.replace(",", "."));
  if (wanted.length === 0) return true;

  const available = new Set<string>();
  for (const fact of facts) {
    for (const value of numbersIn(fact.text)) {
      available.add(value.replace(",", "."));
    }
  }

  return wanted.every((value) => available.has(value));
}

/**
 * Decides whether the project's own material supports a claim.
 *
 * A prohibited shape (a guarantee, a superlative, a measured speed-up) is only
 * grounded when a project fact contains the matched phrase verbatim. A number is
 * only grounded when the supporting facts contain it. When nothing supports the
 * claim the verdict is UNSUPPORTED; when a fact matched but its provenance did
 * not resolve to a real Source it is REVIEW.
 */
export function groundClaim(
  claimText: string,
  context: WritingContext,
): GroundingVerdict {
  const trimmed = claimText.trim();
  if (!trimmed) {
    return { status: "UNSUPPORTED", sourceIds: [], reasoning: "empty claim" };
  }

  const supporting = factsSupporting(trimmed, context);

  const prohibited = matchProhibitedClaim(trimmed);
  if (prohibited) {
    const allowed = supporting.some((fact) =>
      fact.text.toLowerCase().includes(prohibited.match.toLowerCase()),
    );
    if (!allowed) {
      return {
        status: "UNSUPPORTED",
        sourceIds: [],
        reasoning: `prohibited claim shape: ${prohibited.id}`,
      };
    }
  }

  if (!numbersSupportedByFacts(trimmed, supporting)) {
    return {
      status: "UNSUPPORTED",
      sourceIds: [],
      reasoning: "claim states a number the project does not record",
    };
  }

  if (supporting.length === 0) {
    return {
      status: "UNSUPPORTED",
      sourceIds: [],
      reasoning: "no project fact supports this statement",
    };
  }

  const sourceIds = new Set<string>();
  for (const fact of supporting) {
    for (const id of resolveFactSourceIds(fact, context)) sourceIds.add(id);
  }

  if (sourceIds.size === 0) {
    return {
      status: "REVIEW",
      sourceIds: [],
      reasoning: "supporting fact has no resolvable source id",
    };
  }

  return {
    status: "GROUNDED",
    sourceIds: [...sourceIds],
    reasoning: `supported by ${supporting.map((fact) => fact.entityId).join(", ")}`,
  };
}
