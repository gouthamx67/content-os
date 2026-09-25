import type { InputKind, InputLimits, JsonObject, NormalizedInput } from "./input";

export interface AcquiredInput {
  kind: InputKind;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  metadata: JsonObject;
}

export interface InputProvider {
  acquire(
    input: NormalizedInput,
    limits: InputLimits,
    signal?: AbortSignal,
  ): Promise<AcquiredInput>;
}
