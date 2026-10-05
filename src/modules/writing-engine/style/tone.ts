import type { WritingTone } from "../domain/types";

/** A short steer the local provider reads when shaping a line. */
export function toneDirective(tone: WritingTone): string {
  switch (tone) {
    case "BRAND":
      return "Match the brand's own voice and vocabulary.";
    case "PROFESSIONAL":
      return "Be clear, precise and unhurried.";
    case "FRIENDLY":
      return "Sound like a person talking to a peer.";
    case "PLAYFUL":
      return "Allow a light, confident turn of phrase.";
    case "BOLD":
      return "Lead with the strongest true statement.";
    case "MINIMAL":
      return "Cut every word that is not doing work.";
    case "TECHNICAL":
      return "Name the mechanism, not the feeling.";
    case "CONVERSATIONAL":
      return "Write the way someone would say it out loud.";
  }
}

const HYPE = /\b(revolutionary|game[- ]changing|cutting[- ]edge|world[- ]class|unleash|supercharge|effortless)\b/gi;

/** Strips the loudest hype regardless of tone, so no tone can smuggle it back in. */
export function stripHype(text: string): string {
  return text.replace(HYPE, "").replace(/\s{2,}/g, " ").trim();
}
