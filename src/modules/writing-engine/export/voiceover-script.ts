import type { WritingVariantRecord } from "../domain/types";
import { scriptToVoiceover } from "../script/parse-script";

/**
 * The voiceover script for a writing document.
 *
 * CP18 emits text for a voice track; it does not synthesize audio. Speaker tags
 * are stripped so a TTS engine later reads the words, not the labels.
 */
export function toVoiceoverScript(variant: WritingVariantRecord | null): string {
  if (!variant) return "";
  return scriptToVoiceover(variant.text);
}
