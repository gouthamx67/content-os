export type ScriptLine = {
  speaker: string | null;
  text: string;
};

const SPEAKER_LINE = /^([A-Z][A-Z0-9 _-]{0,30}):\s*(.+)$/;

/**
 * Splits a script into speaker turns.
 *
 * A line is treated as a turn only when it begins with an obvious speaker tag;
 * everything else is narration with no speaker. Nothing is inferred beyond what
 * the text says, so a script without tags stays as plain narration.
 */
export function parseScript(text: string): ScriptLine[] {
  return text
    .split(/\r?\n/)
    .map((raw) => raw.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = SPEAKER_LINE.exec(line);
      if (match?.[1] && match[2]) {
        return { speaker: match[1].trim(), text: match[2].trim() };
      }
      return { speaker: null, text: line };
    });
}

/** The spoken words only, joined for a voiceover track. */
export function scriptToVoiceover(text: string): string {
  return parseScript(text)
    .map((line) => line.text)
    .join(" ")
    .trim();
}
