/**
 * Copy is trimmed, never rewritten.
 *
 * The only transformation here is whitespace normalisation and then cutting:
 * whole sentences first, whole words if even the first sentence is too long. A
 * reader can always find every output sentence in the source, in the same order,
 * which is what makes an adaptation safe to publish and reviewable by a human.
 */

/** Collapses whitespace runs to single spaces and trims the ends. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

export type FitCopyArgs = {
  text: string;
  maxCharacters: number;
  maxWords: number;
};

export type FitCopyResult = {
  text: string;
  truncated: boolean;
  characterCount: number;
  wordCount: number;
};

/**
 * Splits into sentences, keeping the punctuation that ends each one.
 *
 * A trailing fragment with no terminal punctuation is still a unit — dropping it
 * would silently lose a line the author wrote.
 */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g);
  return (matches ?? []).map((sentence) => sentence.trim()).filter(Boolean);
}

function fits(candidate: string, maxCharacters: number, maxWords: number): boolean {
  return (
    candidate.length <= maxCharacters && countWords(candidate) <= maxWords
  );
}

/**
 * Cuts `text` down to a limit without inventing a word.
 *
 * Sentences are added while the running total fits. When the very first sentence
 * is already too long, the text is cut at a word boundary instead — still a
 * prefix, still nothing added, just not a complete thought.
 */
export function fitCopy(args: FitCopyArgs): FitCopyResult {
  const source = normalizeWhitespace(args.text);

  if (source.length === 0) {
    return { text: "", truncated: true, characterCount: 0, wordCount: 0 };
  }

  const sentences = splitSentences(source);
  const kept: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current.length === 0 ? sentence : `${current} ${sentence}`;
    if (!fits(candidate, args.maxCharacters, args.maxWords)) break;
    kept.push(sentence);
    current = candidate;
  }

  if (kept.length > 0) {
    return {
      text: current,
      truncated: current.length < source.length,
      characterCount: current.length,
      wordCount: countWords(current),
    };
  }

  const words = source.split(" ");
  const keptWords: string[] = [];
  let partial = "";

  for (const word of words) {
    const candidate = partial.length === 0 ? word : `${partial} ${word}`;
    if (!fits(candidate, args.maxCharacters, args.maxWords)) break;
    keptWords.push(word);
    partial = candidate;
  }

  return {
    text: partial,
    truncated: partial.length < source.length,
    characterCount: partial.length,
    wordCount: countWords(partial),
  };
}