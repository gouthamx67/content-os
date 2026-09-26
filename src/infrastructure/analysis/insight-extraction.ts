import {
  canonicalEntityKey,
  isDuplicateEntity,
  normalizeIntelligenceText,
  textCoversPhrase,
} from "../../core/domain/intelligence-canonical";
import { collapseWhitespace, isMeaningfulPhrase, truncate } from "./text";

/**
 * Deterministic extraction of the three narrative entity families that a source
 * states in prose rather than in a heading or a label:
 *
 * - a **Problem** is friction, pain, a limitation or a cost the source names;
 * - a **Benefit** is an outcome or value the source promises;
 * - a **Workflow** is a meaningful ordered run of product behavior.
 *
 * These are deliberately conservative. Nothing is invented: a candidate is only
 * emitted when a pattern in the source captures a concrete span, and that span
 * becomes the entity name and the evidence excerpt. A source that never names a
 * pain, an outcome or a sequence yields no entity of that family, which is the
 * correct answer rather than a fabricated one.
 *
 * Every family keeps an optional `section` so the analyzers can evidence the
 * candidate against the exact heading scope it came from, and an optional
 * `locator` for the same reason.
 */

export const MAX_INSIGHT_PROBLEMS = 15;
export const MAX_INSIGHT_BENEFITS = 15;
export const MAX_INSIGHT_WORKFLOWS = 8;

export interface ExtractedProblem {
  name: string;
  description: string;
  painKind: "TIME_COST" | "MANUAL_WORK" | "FRICTION" | "LIMITATION" | "FRAGILITY";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  excerpt: string;
  section: string | null;
  locator: string | null;
}

export interface ExtractedBenefit {
  name: string;
  description: string;
  outcomeKind: "TIME_SAVED" | "EFFORT_REDUCED" | "OUTCOME" | "CAPABILITY" | "PROTECTION";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  excerpt: string;
  section: string | null;
  locator: string | null;
}

export interface ExtractedWorkflow {
  name: string;
  steps: { action: string; description: string }[];
  excerpt: string;
  section: string | null;
  locator: string | null;
}

export interface ExtractedInsights {
  problems: ExtractedProblem[];
  benefits: ExtractedBenefit[];
  workflows: ExtractedWorkflow[];
}

export interface InsightCandidate {
  text: string;
  section: string | null;
  locator: string | null;
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?)\]"']+$/, "").trim();
}

const LEADING_ADVERBS = new Set([
  "manually",
  "automatically",
  "carefully",
  "constantly",
  "continually",
  "repeatedly",
  "cumbersomely",
  "redundantly",
  "tediously",
  "painfully",
  "tediously",
  "always",
  "often",
  "usually",
  "still",
  "then",
  "also",
  "just",
  "even",
  "very",
  "really",
  "quite",
  "too",
]);

const QUANTIFIERS = new Set([
  "every",
  "each",
  "all",
  "any",
  "many",
  "most",
  "multiple",
  "several",
  "tons",
  "lots",
  "countless",
  "numerous",
  "the",
  "a",
  "an",
  "their",
  "its",
  "our",
  "your",
  "his",
  "her",
  "new",
  "current",
  "existing",
  "same",
  "whole",
  "entire",
]);

const TRAILING_FUNCTION_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "so",
  "then",
  "for",
  "to",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "of",
  "as",
  "into",
  "onto",
  "per",
  "via",
  "that",
  "which",
  "while",
  "when",
  "than",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "can",
  "could",
  "will",
  "would",
  "should",
  "may",
  "might",
  "must",
  "it",
  "its",
  "their",
  "our",
  "your",
  "his",
  "her",
  "them",
  "they",
  "this",
  "these",
  "those",
  "also",
  "just",
  "even",
  "still",
  "very",
  "really",
  "quite",
  "too",
  "more",
  "most",
  "less",
  "least",
  "up",
  "out",
  "off",
  "over",
  "under",
  "about",
  "after",
  "before",
  "again",
  "once",
  // Quantifiers and pronouns only ever trail a bounded span ("... for every",
  // "... across each"), so leaving one behind produces a name that reads as
  // truncated rather than complete.
  "every",
  "each",
  "all",
  "any",
  "some",
  "many",
  "few",
  "both",
  "either",
  "neither",
  "such",
  "another",
  "other",
  "across",
  "between",
  "through",
  "among",
  "within",
  "without",
  "upon",
  "along",
  "besides",
  "beyond",
  "toward",
  "towards",
  "versus",
  "inside",
  "outside",
]);

/**
 * Turns a captured clause into a stable entity name: sentence punctuation and
 * leading filler come off, trailing function words are trimmed, and the first
 * letter is capitalized. The result stays a faithful span of the source, so the
 * name can always be traced back to the evidence excerpt.
 */
function toEntityName(value: string): string {
  const tokens = stripTrailingPunctuation(collapseWhitespace(value))
    .split(" ")
    .filter((token) => token.length > 0);
  while (
    tokens.length > 1 &&
    (LEADING_ADVERBS.has(tokens[0].toLowerCase()) || QUANTIFIERS.has(tokens[0].toLowerCase()))
  ) {
    tokens.shift();
  }
  while (tokens.length > 1 && TRAILING_FUNCTION_WORDS.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }
  if (tokens.length === 0) return "";
  const joined = tokens.join(" ");
  return joined[0].toUpperCase() + joined.slice(1);
}

const PRONOUNS = new Set([
  "it",
  "they",
  "them",
  "we",
  "you",
  "i",
  "he",
  "she",
  "his",
  "her",
  "its",
  "their",
  "our",
  "your",
  "this",
  "that",
  "these",
  "those",
  "there",
  "here",
]);

/** A rule must capture a noun-bearing span, not a pronoun pointing at nothing. */
function isSelfContainedName(value: string): boolean {
  const normalized = normalizeIntelligenceText(value);
  if (normalized.length === 0) return false;
  const tokens = normalized.split(" ");
  if (tokens.length === 0) return true;
  if (PRONOUNS.has(tokens[0])) return false;
  return tokens.length >= 2;
}

/**
 * A captured phrase runs to the end of its clause, which means it can pick up
 * trailing function words ("... launch announcement for"). Greedy matching gets
 * the whole phrase; the trim in `toEntityName` takes the dangle back off.
 */
const SPAN_ALTERNATION =
  "(?:(?:by|with|through|via|from|of|for|to|in|on|across)\\s+)?(?:[A-Za-z][\\w'’-]*(?:[\\s-][A-Za-z][\\w'’-]*){0,6})";

interface ProblemRule extends MatchableRule {
  painKind: ExtractedProblem["painKind"];
  confidence: ExtractedProblem["confidence"];
}

interface BenefitRule extends MatchableRule {
  outcomeKind: ExtractedBenefit["outcomeKind"];
  confidence: ExtractedBenefit["confidence"];
}

const PAIN_RULES: ProblemRule[] = [
  {
    painKind: "TIME_COST",
    confidence: "HIGH",
    // "spends hours manually adapting X", "wastes days rewriting Y"
    pattern: new RegExp(
      `\\b(?:spend|spends|spent|waste|wastes|wasted|burn|burns|burnt|lose|loses|lost)\\b[^.!?]{0,20}?\\b(?:hours?|days?|weeks?|months?|minutes?)\\b\\s+(?:of\\s+)?(?:on\\s+)?(${SPAN_ALTERNATION})`,
      "i",
    ),
    resolve: (match) => match[1] ?? null,
  },
  {
    painKind: "FRICTION",
    confidence: "HIGH",
    // "struggle to X", "painful to X", "painfully slow to X", "tedious to X"
    pattern: new RegExp(
      `\\b(?:struggle|struggles|struggling|painful|painfully|frustrating|frustratingly|tedious|tediously|annoying|hard|difficult|challenging|slow|slowly|tedium|nightmare|headache|painful)\\b[^.!?]{0,20}?\\b(?:to|with|when|for|about)\\s+(${SPAN_ALTERNATION})`,
      "i",
    ),
    resolve: (match) => match[1] ?? null,
  },
  {
    painKind: "LIMITATION",
    confidence: "HIGH",
    // "can't ship without X", "unable to X", "impossible to X"
    pattern: new RegExp(
      `\\b(?:can'?t|cannot|can not|unable to|fails? to|impossible to|no way to|nothing stops?)\\b[^.!?]{0,24}?\\b(?:without|when|unless|to)\\b\\s*(${SPAN_ALTERNATION})`,
      "i",
    ),
    resolve: (match) => match[1] ?? null,
  },
  {
    painKind: "FRAGILITY",
    confidence: "MEDIUM",
    // "lose track of the context", "drift between tools", "duplicated effort"
    pattern: new RegExp(
      `\\b(?:lose|loses|lost|forget|forgets|drop|drops|miss|misses|duplicate|duplicated|repeat|repeated|rework|fragment|fragmented|scattered|scatter)\\b[^.!?]{0,20}?\\b(?:context|history|track|state|version|consistency|effort|work|time|updates|changes|feedback|files|data|progress|thread|info(?:rmation)?|silos?)\\b`,
      "i",
    ),
    resolve: (match) => {
      const span = match[0];
      return toEntityName(span);
    },
  },
  {
    painKind: "MANUAL_WORK",
    confidence: "MEDIUM",
    // "manually adapting every launch post", "by hand, one file at a time"
    pattern: new RegExp(
      `\\b(?:manually|by hand|hand[- ]crafted|one[- ]by[- ]one|piece by piece)\\b[^.!?]{0,40}?(${SPAN_ALTERNATION})`,
      "i",
    ),
    resolve: (match) => match[1] ?? null,
  },
  {
    painKind: "MANUAL_WORK",
    confidence: "MEDIUM",
    // "copy-paste ... between tools", "duplicated across ..."
    pattern: new RegExp(
      `\\b(?:copy[- ]?(?:and[- ]?|n[- ])?paste|duplicate|duplicated|re-?enter|re-?entering|transcribe|transcribing)\\b[^.!?]{0,20}?\\b(?:between|across|into|from|to|every|each)\\b\\s+(${SPAN_ALTERNATION})`,
      "i",
    ),
    resolve: (match) => match[1] ?? null,
  },
];

const NEGATION_PREFIX = /\b(?:no|not|never|without|isn'?t|aren'?t|wasn'?t|don'?t|doesn'?t|didn'?t|cannot|can'?t|un)\b/;

const BENEFIT_RULES: BenefitRule[] = [
  {
    outcomeKind: "CAPABILITY",
    confidence: "HIGH",
    // "so you can create a campaign", "so teams can generate content"
    pattern: new RegExp(
      `\\bso\\s+(?:that\\s+)?(?:you|your team|teams?|users?|marketers?|creators?|writers?|developers?|companies|users|they|we|our team|you can|you\\'ll)\\s+can\\s+(?:still\\s+|also\\s+|now\\s+)?(${SPAN_ALTERNATION})`,
      "i",
    ),
    resolve: (match) => match[1] ?? null,
  },
  {
    outcomeKind: "CAPABILITY",
    confidence: "HIGH",
    // "lets you create", "enables you to ship"
    pattern: new RegExp(
      `\\b(?:lets?|lets|allow(?:s)?|enabl(?:e|es|ing)|empower(?:s)?|help(?:s)?)\\b\\s+(?:you|teams?|users?|you to|you to be able to|teams? to|users? to|us|our team)\\s+(?:to\\s+)?(?:${SPAN_ALTERNATION})`,
      "i",
    ),
    resolve: (match) => match[1] ?? null,
  },
  {
    outcomeKind: "TIME_SAVED",
    confidence: "HIGH",
    // "reduces review time", "cuts hours from every launch"
    pattern: new RegExp(
      `\\b(?:reduc(?:e|es|ing|ed)|cut(?:s|ting)?|trim(?:s|ming)?|shorten(?:s|ing)?|lower(?:s|ing)?|shrink(?:s|ing)?|save(?:s|d|ing)?|halve(?:s|d)?|drop(?:s|ping)?)\\b\\s+(?:${SPAN_ALTERNATION})`,
      "i",
    ),
    resolve: (match) => match[1] ?? null,
  },
  {
    outcomeKind: "OUTCOME",
    confidence: "MEDIUM",
    // "goes from hours to minutes", "without rewriting by hand"
    pattern: new RegExp(
      `\\b(?:go(?:es)?|come(?:s)?|moves?|went|moving)\\s+from\\s+${SPAN_ALTERNATION}\\s+to\\s+${SPAN_ALTERNATION}`,
      "i",
    ),
    resolve: (match) => {
      const value = match[0].replace(/^\S+\s+/, "");
      return toEntityName(value);
    },
  },
  {
    outcomeKind: "PROTECTION",
    confidence: "MEDIUM",
    // "no more rewriting", "without the rework"
    pattern: new RegExp(
      `\\b(?:no more|without|never|free(?:s)? (?:you|your team|teams?|users?) from|avoids?|prevents?|eliminates?|kills?)\\b\\s+(?:the\\s+|any\\s+|more\\s+|re-?)?${SPAN_ALTERNATION}`,
      "i",
    ),
    resolve: (match) => match[1] ?? null,
  },
  {
    outcomeKind: "OUTCOME",
    confidence: "LOW",
    // "in minutes instead of hours", "in one place instead of five"
    pattern: new RegExp(
      `\\bin\\s+${SPAN_ALTERNATION}\\s+instead\\s+of\\s+${SPAN_ALTERNATION}`,
      "i",
    ),
    resolve: (match) => toEntityName(match[0]),
  },
];

const STEP_WORD = "[A-Za-z][\\w'’-]*";
/**
 * A step runs until a connector, so an interior "and"/"then" ends the step
 * rather than being swallowed as part of the previous one.
 */
const STEP_SEGMENT = `(?:${STEP_WORD}(?:\\s+(?!and\\b|then\\b)${STEP_WORD}){0,3})`;

/**
 * Ordered alternatives matter here: the longer, more explicit connectors come
 * first so a regex engine cannot settle for the short `,\s*` and leave a
 * dangling "and" at the head of the next step.
 */
const CONNECTOR =
  "(?:,\\s*(?:and|then)\\s+|\\s+then\\s+|\\s+and\\s+|\\s*(?:→|->|=>)\\s*|;\\s*(?:and\\s+)?|,\\s*)";

function stepSegments(minimum: number, maximum = 5): RegExp {
  return new RegExp(
    `${STEP_SEGMENT}(?:${CONNECTOR}${STEP_SEGMENT}){${minimum - 1},${maximum - 1}}`,
    "i",
  );
}

/** Ordered behavior words: a step almost always starts with a verb. */
const ORDERING_VERBS = new Set([
  "add",
  "approve",
  "assemble",
  "build",
  "capture",
  "check",
  "collect",
  "compose",
  "configure",
  "confirm",
  "connect",
  "convert",
  "copy",
  "create",
  "customize",
  "define",
  "delete",
  "deliver",
  "deploy",
  "design",
  "dispatch",
  "draft",
  "edit",
  "export",
  "extract",
  "finalize",
  "find",
  "gather",
  "generate",
  "import",
  "insert",
  "integrate",
  "launch",
  "link",
  "load",
  "manage",
  "map",
  "measure",
  "monitor",
  "obtain",
  "plan",
  "prepare",
  "preview",
  "produce",
  "publish",
  "read",
  "record",
  "refresh",
  "register",
  "reject",
  "release",
  "render",
  "replace",
  "report",
  "research",
  "retrieve",
  "review",
  "revise",
  "run",
  "save",
  "scan",
  "schedule",
  "search",
  "select",
  "send",
  "set",
  "set up",
  "share",
  "ship",
  "sign",
  "store",
  "submit",
  "sync",
  "tag",
  "target",
  "track",
  "transform",
  "translate",
  "trigger",
  "update",
  "upload",
  "validate",
  "verify",
  "view",
  "write",
]);

/**
 * How many sequential steps make a real workflow rather than a stray comma
 * list. A connector chain is explicit intent, so two steps are enough; a bare
 * comma list is weaker evidence, so it needs three.
 */
const MIN_CONNECTOR_STEPS = 2;
const MIN_LIST_STEPS = 3;

const ORDERED_LIST = /^\s*(?:step\s*)?\d+[.)]\s+(.+)$/i;

const ARROW_CHAIN = stepSegments(MIN_CONNECTOR_STEPS);

const CONNECTOR_CHAIN = stepSegments(MIN_CONNECTOR_STEPS);

const COMMA_LIST = stepSegments(MIN_LIST_STEPS);

const LIST_INTRO_WORDS =
  /\b(?:workflow|process|steps?|pipeline|flow|sequence|lifecycle|life cycle|usage|journey|happy path|the loop|how it works|how you use|how we use|how they use|how to)\b/i;

const CONTEXTUAL_LIST = [
  /^\s*(?:so|then|and|but|now)\b/i,
  /\b(?:so|then|and|but|now|after that|next|first|last|finally)\b\s*[,:]?\s*$/i,
  /\b(?:user|users|their|they|you|our|we|him|her|it)\b/i,
  /\b(?:with|using|via|for|to|from)\b\s*$/i,
  /\b(?:because|since|if|when|while|before|after|once|as|so that|although|though)\b/i,
];

function looksLikeContextualList(sentence: string): boolean {
  return CONTEXTUAL_LIST.some((pattern) => pattern.test(sentence));
}

const NOISE_SEGMENT = new RegExp(
  `^(?:it|this|that|these|those|there|here|they|we|you|he|she|and|or|but|so|then|also|not|now|which|who|what|when|where|why|how|is|are|was|were|be|been|being|do|does|did|has|have|had|can|could|will|would|should|may|might|must|if|to|of|in|on|at|by|for|with|from|as|its|their|our|your|one|two|three|four|five|six|seven|eight|nine|ten|all|any|each|every|more|most|other|another|such|than|into|over|under|about|after|before|while|because|since|you'll|it's|don't|can't|we're|they're|you're|isn't|aren't|won't|shouldn't|up|out|down|off|again|further|once|just|only|also|very|really|too|still|yet|so|because)$`,
  "i",
);

function segmentTokens(segment: string): string[] {
  return normalizeIntelligenceText(segment).split(" ").filter((token) => token.length > 0);
}

function isRealStep(segment: string): boolean {
  const tokens = segmentTokens(segment);
  if (tokens.length < 2 || tokens.length > 8) return false;
  if (NOISE_SEGMENT.test(tokens[0] ?? "")) return false;
  if (tokens.every((token) => NOISE_SEGMENT.test(token))) return false;
  return true;
}

function stepVerb(segment: string): string | null {
  const tokens = segmentTokens(segment);
  for (const token of tokens.slice(0, 2)) {
    if (ORDERING_VERBS.has(token)) return segment.trim().split(" ")[0] ?? token;
  }
  return null;
}

/**
 * A workflow name has to be readable on its own, so a bare verb chain is only
 * trusted when the steps read as an ordered run of actions. A heading or a
 * nearby flow keyword supplies a better name when the source offers one.
 */
function isOrderedActionRun(steps: string[]): boolean {
  const verbs = steps.map(stepVerb);
  const matched = verbs.filter((verb): verb is string => verb !== null);
  return matched.length >= steps.length - 1 && matched.length >= MIN_LIST_STEPS;
}

function workflowNameFromSteps(steps: string[]): string {
  const verbs: string[] = [];
  for (const step of steps) {
    const verb = stepVerb(step);
    if (verb && !verbs.includes(verb)) verbs.push(verb);
  }
  if (verbs.length === 0) return "";
  const joined = verbs.map((verb) => verb[0].toUpperCase() + verb.slice(1));
  return joined.join(" \u2192 ");
}

interface WorkflowRule {
  pattern: RegExp;
  minimum: number;
  context: "heading" | "connector" | "list" | "arrow";
}

function splitSteps(raw: string): string[] {
  return raw
    .split(new RegExp(`\\s*(?:${CONNECTOR})\\s*`, "i"))
    .map((part) => stripTrailingPunctuation(collapseWhitespace(part)))
    .filter((part) => part.length > 0);
}

const WORKFLOW_RULES: WorkflowRule[] = [
  { pattern: ARROW_CHAIN, minimum: MIN_CONNECTOR_STEPS, context: "arrow" as const },
  { pattern: CONNECTOR_CHAIN, minimum: MIN_CONNECTOR_STEPS, context: "connector" as const },
  { pattern: COMMA_LIST, minimum: MIN_LIST_STEPS, context: "list" as const },
];

function candidateSectionIsFlowish(section: string | null): boolean {
  return section !== null && LIST_INTRO_WORDS.test(section);
}

function workflowFromText(
  candidate: InsightCandidate,
  known: Set<string>,
): ExtractedWorkflow | null {
  const sentence = candidate.text;
  let steps: string[] = [];

  const orderedMatch = ORDERED_LIST.exec(sentence);
  if (orderedMatch) {
    const rest = sentence.replace(orderedMatch[0] ?? "", " ");
    const match = ARROW_CHAIN.exec(rest) ?? COMMA_LIST.exec(rest);
    if (match) steps = splitSteps(match[0]);
  } else {
    for (const rule of WORKFLOW_RULES) {
      const match = rule.pattern.exec(sentence);
      if (!match) continue;
      const segments = splitSteps(match[0]);
      if (segments.length < rule.minimum) continue;
      if (rule.context === "list" && !looksLikeContextualList(sentence)) continue;
      if (rule.context !== "heading" && !isOrderedActionRun(segments)) continue;
      steps = segments;
      break;
    }
  }

  if (steps.length < MIN_CONNECTOR_STEPS) return null;
  if (steps.length > 6) return null;
  const usable = steps.filter(isRealStep);
  if (usable.length < Math.max(MIN_LIST_STEPS, steps.length - 1)) return null;
  if (new Set(usable.map(normalizeIntelligenceText)).size !== usable.length) return null;

  const derivedName = workflowNameFromSteps(usable);
  const name = candidateSectionIsFlowish(candidate.section)
    ? (candidate.section ?? derivedName)
    : derivedName || (candidate.section ?? "");
  if (!isMeaningfulPhrase(name, 3, 200)) return null;
  if (name.length < 4) return null;
  if (known.has(canonicalEntityKey("WORKFLOW", name))) return null;

  return {
    name: truncate(name, 200),
    steps: usable.map((action) => ({ action: truncate(action, 200), description: "" })),
    excerpt: truncate(sentence, 400),
    section: candidate.section,
    locator: candidate.locator,
  };
}

interface MatchableRule {
  pattern: RegExp;
  resolve: (match: RegExpExecArray) => string | null;
}

function matchesRule<TRule extends MatchableRule>(
  sentence: string,
  rules: readonly TRule[],
): { name: string; rule: TRule } | null {
  for (const rule of rules) {
    const match = rule.pattern.exec(sentence);
    if (!match) continue;
    const raw = rule.resolve(match);
    if (!raw) continue;
    const name = toEntityName(raw);
    if (!isSelfContainedName(name)) continue;
    return { name, rule };
  }
  return null;
}

function dedupeByName<T extends { name: string }>(items: T[], limit: number): T[] {
  const kept: T[] = [];
  for (const item of items) {
    if (kept.some((existing) => isDuplicateEntity(item.name, existing.name))) continue;
    kept.push(item);
    if (kept.length >= limit) break;
  }
  return kept;
}

function isNegated(sentence: string): boolean {
  return NEGATION_PREFIX.test(sentence.trimStart());
}

export function extractProblems(
  candidates: readonly InsightCandidate[],
  knownNames: readonly string[] = [],
  limit = MAX_INSIGHT_PROBLEMS,
): ExtractedProblem[] {
  const found: ExtractedProblem[] = [];
  for (const candidate of candidates) {
    if (found.length >= limit) break;
    const sentence = candidate.text;
    if (NEGATION_PREFIX.test(sentence.trimStart())) continue;
    const matched = matchesRule(sentence, PAIN_RULES);
    if (!matched) continue;
    if (knownNames.some((name) => isDuplicateEntity(matched.name, name))) continue;
    found.push({
      name: truncate(matched.name, 200),
      description: truncate(sentence, 400),
      painKind: matched.rule.painKind,
      confidence: matched.rule.confidence,
      excerpt: truncate(sentence, 400),
      section: candidate.section,
      locator: candidate.locator,
    });
  }
  return dedupeByName(found, limit);
}

export function extractBenefits(
  candidates: readonly InsightCandidate[],
  knownNames: readonly string[] = [],
  limit = MAX_INSIGHT_BENEFITS,
): ExtractedBenefit[] {
  const found: ExtractedBenefit[] = [];
  for (const candidate of candidates) {
    if (found.length >= limit) break;
    const sentence = candidate.text;
    const matched = matchesRule(sentence, BENEFIT_RULES);
    if (!matched) continue;
    if (isNegated(sentence) && matched.rule.outcomeKind === "OUTCOME") continue;
    if (knownNames.some((name) => isDuplicateEntity(matched.name, name))) continue;
    found.push({
      name: truncate(matched.name, 200),
      description: truncate(sentence, 400),
      outcomeKind: matched.rule.outcomeKind,
      confidence: matched.rule.confidence,
      excerpt: truncate(sentence, 400),
      section: candidate.section,
      locator: candidate.locator,
    });
  }
  return dedupeByName(found, limit);
}

export function extractWorkflows(
  candidates: readonly InsightCandidate[],
  limit = MAX_INSIGHT_WORKFLOWS,
): ExtractedWorkflow[] {
  const known = new Set<string>();
  const found: ExtractedWorkflow[] = [];
  for (const candidate of candidates) {
    if (found.length >= limit) break;
    const workflow = workflowFromText(candidate, known);
    if (!workflow) continue;
    known.add(canonicalEntityKey("WORKFLOW", workflow.name));
    found.push(workflow);
  }
  return found;
}

export function extractInsights(
  candidates: readonly InsightCandidate[],
  options: { featureNames?: readonly string[]; limits?: Partial<Record<"problems" | "benefits" | "workflows", number>> } = {},
): ExtractedInsights {
  const featureNames = options.featureNames ?? [];
  return {
    problems: extractProblems(candidates, featureNames, options.limits?.problems),
    benefits: extractBenefits(candidates, featureNames, options.limits?.benefits),
    workflows: extractWorkflows(candidates, options.limits?.workflows),
  };
}

/**
 * Feature linkage. A step, a problem clause or a benefit clause is *about* a
 * feature when the feature phrase is present in it, and the same section is
 * treated as a weaker but genuine signal because a source that states a pain
 * next to the capability that answers it is making a deliberate pairing.
 */

export function linksToFeature(
  haystack: string,
  featureName: string,
  section: string | null,
  featureSection: string | null,
): boolean {
  if (textCoversPhrase(haystack, featureName)) return true;
  if (section !== null && featureSection !== null && section === featureSection) return true;
  return false;
}
