import { stableStringify } from "../../video-rendering/serialization/stable-json";
import type { WritingContext, WritingRecipe } from "../domain/types";
import { hashWriting } from "../serialization/hash-writing";

/** Deterministic bytes for a context, so its hash is independent of key order. */
export function serializeWritingContext(context: WritingContext): string {
  return stableStringify(context);
}

export function parseWritingContext(snapshot: string): WritingContext {
  return JSON.parse(snapshot) as WritingContext;
}

export function writingContextSha256(context: WritingContext): string {
  return hashWriting(context);
}

export function serializeWritingRecipe(recipe: WritingRecipe): string {
  return stableStringify(recipe);
}

export function writingRecipeSha256(recipe: WritingRecipe): string {
  return hashWriting(recipe);
}
