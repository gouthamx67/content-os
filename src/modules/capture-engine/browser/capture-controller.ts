export type BrowserCaptureMode = "CAMERA" | "MICROPHONE" | "SCREEN";

export interface BrowserCapture {
  blob: Blob;
  durationMs: number;
  width?: number;
  height?: number;
}

/**
 * A recording in progress.
 *
 * The handle is returned before the recording ends on purpose: a caller that
 * only received the capture once it finished would have no way to stop it, and
 * `stop` is the only thing standing between a user and a camera that stays on.
 */
export interface ActiveCapture {
  recorder: MediaRecorder;
  stream: MediaStream;
  /** Resolves once stopped, with the bytes and the measured duration. */
  capture: Promise<BrowserCapture>;
  stop: () => void;
}

function pickMimeType(mode: BrowserCaptureMode): string {
  const candidates =
    mode === "MICROPHONE"
      ? [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/mp4",
          "audio/mpeg",
        ]
      : [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp9",
          "video/webm",
          "video/mp4",
        ];

  for (const candidate of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(candidate)
    ) {
      return candidate;
    }
  }

  return "";
}

export function isCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof MediaRecorder !== "undefined"
  );
}

async function requestStream(mode: BrowserCaptureMode): Promise<MediaStream> {
  if (!isCaptureSupported()) {
    throw new Error("This browser cannot capture media");
  }

  // The narrowest constraint the mode needs: asking for a camera in microphone
  // mode prompts for video the user did not agree to record.
  switch (mode) {
    case "CAMERA":
      return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    case "MICROPHONE":
      return navigator.mediaDevices.getUserMedia({ audio: true });
    case "SCREEN":
      return navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
  }
}

export function stopTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * Starts a recording and hands back a handle immediately.
 *
 * The returned `capture` promise settles only after the recorder stops; the
 * `stop` function is what makes that happen. Tracks are always released in
 * `onstop`, so a stopped recording cannot leave a camera light on.
 */
export async function beginCapture(
  mode: BrowserCaptureMode,
): Promise<ActiveCapture> {
  const stream = await requestStream(mode);
  const mimeType = pickMimeType(mode);

  let recorder: MediaRecorder;

  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (error) {
    stopTracks(stream);
    throw error;
  }

  const chunks: BlobPart[] = [];
  const startedAt = performance.now();

  const capture = new Promise<BrowserCapture>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      stopTracks(stream);
      reject(new Error("MediaRecorder failed"));
    };

    recorder.onstop = () => {
      // Released before the blob is assembled: if building the blob throws, the
      // tracks are already stopped rather than left running by the failure.
      stopTracks(stream);

      const track = stream.getVideoTracks()[0] ?? stream.getAudioTracks()[0];
      const settings = track?.getSettings();

      const durationMs = Math.max(1, Math.round(performance.now() - startedAt));

      resolve({
        blob: new Blob(chunks, {
          type: recorder.mimeType || mimeType || "video/webm",
        }),
        durationMs,
        width: settings?.width,
        height: settings?.height,
      });
    };
  });

  recorder.start();

  return {
    recorder,
    stream,
    capture,
    stop: () => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      } else {
        stopTracks(stream);
      }
    },
  };
}

/** One-shot capture for callers that stop on their own schedule. */
export async function captureStream(
  mode: BrowserCaptureMode,
): Promise<BrowserCapture> {
  const active = await beginCapture(mode);
  return active.capture;
}

export function stopCapture(recorder: MediaRecorder): void {
  if (recorder.state !== "inactive") {
    recorder.stop();
  }
}
