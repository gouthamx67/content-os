"use client";

interface Props {
  audioUrl: string | null;
  videoUrl: string | null;
}

/**
 * Plays the mixed audio, and the final media once it exists.
 *
 * Both elements point at the streaming routes rather than a storage key, so
 * authorization is enforced the same way it is for every other read.
 */
export function AudioPreview({ audioUrl, videoUrl }: Props) {
  return (
    <div
      data-testid="audio-preview"
      className="grid gap-4 rounded-xl border border-[#202329] bg-[#101216] p-4 md:grid-cols-2"
    >
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-[#62666f]">Mix</p>
        {audioUrl ? (
          <audio
            data-testid="audio-player"
            controls
            src={audioUrl}
            className="w-full"
          />
        ) : (
          <p className="text-xs text-[#62666f]">No mix yet.</p>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-[#62666f]">
          Final media
        </p>
        {videoUrl ? (
          <video
            data-testid="final-video"
            controls
            src={videoUrl}
            className="w-full rounded-md border border-[#202329]"
          />
        ) : (
          <p className="text-xs text-[#62666f]">No final media yet.</p>
        )}
      </div>
    </div>
  );
}
