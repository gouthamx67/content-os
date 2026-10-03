/**
 * Render failures are typed because the API has to distinguish "the caller asked
 * for something impossible" (400/422) from "the renderer broke" (500). A code is
 * carried alongside the message so a log line or an error row can be grouped
 * without parsing English.
 */
export class RenderError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "RenderError";
    this.code = code;
    this.status = status;
  }
}

/** The request is well-formed but describes a render this engine cannot do. */
export class RenderFeatureError extends RenderError {
  constructor(code: string, message: string) {
    super(code, message, 422);
    this.name = "RenderFeatureError";
  }
}

/** The stored scene snapshot is not a valid renderer contract. */
export class RenderContractError extends RenderError {
  constructor(message: string) {
    super("INVALID_RENDERER_CONTRACT", message, 400);
    this.name = "RenderContractError";
  }
}

/** A job was cancelled while FFmpeg was running. */
export class RenderCancelledError extends Error {
  readonly code = "RENDER_CANCELLED";

  constructor(message = "Render was cancelled") {
    super(message);
    this.name = "RenderCancelledError";
  }
}

/** FFmpeg itself failed; the message is sanitized before it is stored. */
export class RenderExecutionError extends RenderError {
  constructor(message: string) {
    super("RENDER_FAILED", message, 500);
    this.name = "RenderExecutionError";
  }
}
