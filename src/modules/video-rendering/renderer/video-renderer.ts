import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RendererContract } from "../../visual-motion-engine/export/renderer-contract";
import { defaultFontFile, getFfmpegVersion } from "../ffmpeg/capabilities";
import {
  compileScene,
  type CompilerAsset,
} from "../ffmpeg/compile-scene";
import { runFfmpeg, type FfmpegProgress } from "../ffmpeg/ffmpeg-runner";
import type { RenderAssetResolver } from "../assets/render-asset-resolver";

export type RenderVideoInput = {
  renderJobId: string;
  projectId: string;
  contract: RendererContract;
  assets: RenderAssetResolver;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  fontFile?: string | null;
  workDirRoot?: string;
};

export type RenderVideoResult = {
  outputPath: string;
  ffmpegVersion: string;
  dispose: () => Promise<void>;
};

/**
 * Renders one contract to an MP4 in a private work directory.
 *
 * The work directory is the isolation boundary: media is materialised there,
 * text is written there, FFmpeg writes there, and the whole directory is
 * removed once the artifact has been copied into render storage. Nothing in the
 * directory is ever named after user input.
 */
export async function renderVideo(input: RenderVideoInput): Promise<RenderVideoResult> {
  const workDir = await mkdtemp(
    path.join(input.workDirRoot ?? tmpdir(), `content-os-render-${safe(input.renderJobId)}-`),
  );

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await rm(workDir, { recursive: true, force: true });
  };

  try {
    const textFiles = new Map<string, string>();
    const layers = input.contract.composition.layers;

    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index]!;
      if (layer.type !== "TEXT" || !layer.visible) continue;
      const target = path.join(workDir, `text-${index}.txt`);
      await writeFile(target, (layer.textContent ?? "").replace(/\r\n?/g, "\n"));
      textFiles.set(layer.id, target);
    }

    const assets = new Map<string, CompilerAsset>();
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index]!;
      if (layer.type !== "MEDIA" || !layer.visible || !layer.assetRef) continue;
      assets.set(
        layer.id,
        await input.assets.resolve(input.projectId, layer.assetRef, workDir, index),
      );
    }

    const fontFile = input.fontFile ?? defaultFontFile();
    const compiled = compileScene(input.contract, {
      assets,
      fontFile,
      textFiles,
    });

    const outputPath = path.join(workDir, "output.mp4");
    const ffmpegVersion = await getFfmpegVersion();

    await runFfmpeg(
      [
        ...compiled.inputArgs,
        "-filter_complex",
        compiled.filterComplex,
        ...compiled.outputArgs,
        outputPath,
      ],
      {
        totalDurationMs: input.contract.composition.canvas.durationMs,
        onProgress: (progress: FfmpegProgress) => {
          input.onProgress?.(progress.percent);
        },
        signal: input.signal,
      },
    );

    return { outputPath, ffmpegVersion, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}
