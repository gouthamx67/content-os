import type { RendererContract } from "../../visual-motion-engine/export/renderer-contract";
import type {
  SceneGraphEffect,
  SceneGraphKeyframe,
  SceneGraphLayer,
} from "../../visual-motion-engine/serialization/scene-graph";
import type { MotionProperty } from "../../visual-motion-engine/domain/types";
import { RenderFeatureError } from "../errors";
import { RENDER_OUTPUT } from "../render-limits";
import {
  applyMotion,
  ffmpegNumber,
  keyframesToFfmpegExpr,
  type MotionExpression,
} from "./expressions";

export type CompilerAsset = {
  path: string;
  kind: "image" | "video";
  width?: number | null;
  height?: number | null;
};

export type CompileSceneOptions = {
  assets: Map<string, CompilerAsset>;
  fontFile?: string | null;
  textFiles?: Map<string, string>;
};

export type CompiledScene = {
  inputArgs: string[];
  filterComplex: string;
  outputLabel: string;
  outputArgs: string[];
  outputDurationSec: number;
  totalFrames: number;
};

const NEUTRAL: Record<MotionProperty, number> = {
  X: 0,
  Y: 0,
  SCALE: 1,
  ROTATION: 0,
  OPACITY: 1,
};

/**
 * Compiles a renderer contract into an FFmpeg invocation.
 *
 * One transparent canvas is the base; every visible layer becomes a stream that
 * is fitted, graded and transformed, then overlaid in z-order. Motion is not
 * evaluated per frame in JavaScript — each property is compiled to an FFmpeg
 * expression over `t`, so the interpolation happens inside the encoder at the
 * same time as the decode. That is what keeps a 5-second render from waiting on
 * a TypeScript loop.
 */
export function compileScene(
  contract: RendererContract,
  options: CompileSceneOptions,
): CompiledScene {
  const { width, height, frameRate, durationMs } = contract.composition.canvas;
  const durationSec = durationMs / 1000;
  const evenWidth = width - (width % 2);
  const evenHeight = height - (height % 2);

  const inputArgs: string[] = [
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${width}x${height}:r=${frameRate}:d=${durationSec}`,
  ];
  const filterParts: string[] = [];

  const layers = contract.composition.layers
    .slice()
    .sort((a, b) => {
      if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
      return a.id.localeCompare(b.id);
    });

  let baseLabel = "0:v";
  let inputIndex = 1;

  for (const layer of layers) {
    if (!layer.visible) continue;

    const segmentId = inputIndex;
    const layerLabel = `l${segmentId}`;

    const prepared = prepareLayer({
      layer,
      inputArgs,
      fontFile: options.fontFile ?? null,
      textFiles: options.textFiles ?? new Map(),
      assets: options.assets,
      frameRate,
      durationSec,
    });

    inputIndex += 1;

    if (!prepared) continue;

    const steps: string[] = prepared.source
      ? [prepared.source, ...prepared.transforms]
      : [...prepared.transforms];

    const effects = effectFilters(layer.effects);
    steps.push(...effects);

    const opacity = applyMotion(
      Math.min(1, Math.max(0, layer.opacity)),
      "OPACITY",
      motionFor(layer, "OPACITY", durationMs),
    );
    if (!opacity.constant) {
      steps.push(
        `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*(${opacity.expression.replace(
          /\bt\b/g,
          "T",
        )})'`,
      );
    } else if (opacity.value < 0.999) {
      steps.push(`colorchannelmixer=aa=${ffmpegNumber(opacity.value)}`);
    }

    const scale = applyMotion(layer.width, "SCALE", motionFor(layer, "SCALE", durationMs));
    const scaleHeight = applyMotion(
      layer.height,
      "SCALE",
      motionFor(layer, "SCALE", durationMs),
    );

    if (!scale.constant || !scaleHeight.constant) {
      steps.push(
        `scale=w='max(1,${scale.expression})':h='max(1,${scaleHeight.expression})':eval=frame`,
      );
    } else if (
      scale.value !== layer.width ||
      scaleHeight.value !== layer.height
    ) {
      steps.push(
        `scale=w='max(1,${ffmpegNumber(scale.value)})':h='max(1,${ffmpegNumber(
          scaleHeight.value,
        )})'`,
      );
    }

    const rotation = applyMotion(
      layer.rotation,
      "ROTATION",
      motionFor(layer, "ROTATION", durationMs),
    );
    if (!rotation.constant || normaliseAngle(rotation.value) !== 0) {
      steps.push(
        `rotate=angle='(${rotation.expression})*PI/180':ow=rotw(iw):oh=roth(ih):c=none`,
      );
    }

    filterParts.push(`[${segmentId}:v]${steps.join(",")}[${layerLabel}]`);

    const x = applyMotion(layer.x, "X", motionFor(layer, "X", durationMs));
    const y = applyMotion(layer.y, "Y", motionFor(layer, "Y", durationMs));
    const overlayX = `(${x.expression})+((${scale.expression})/2)-overlay_w/2`;
    const overlayY = `(${y.expression})+((${scaleHeight.expression})/2)-overlay_h/2`;

    const nextBase = `v${segmentId}`;
    filterParts.push(
      `[${baseLabel}][${layerLabel}]overlay=x='${overlayX}':y='${overlayY}':format=auto:shortest=0[${nextBase}]`,
    );
    baseLabel = nextBase;
  }

  if (evenWidth !== width || evenHeight !== height) {
    filterParts.push(
      `[${baseLabel}]scale=w=trunc(iw/2)*2:h=trunc(ih/2)*2,setsar=1[outv]`,
    );
  } else {
    filterParts.push(`[${baseLabel}]setsar=1[outv]`);
  }

  return {
    inputArgs,
    filterComplex: filterParts.join(";"),
    outputLabel: "outv",
    outputArgs: [
      "-map",
      "[outv]",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      RENDER_OUTPUT.pixelFormat,
      "-movflags",
      "+faststart",
      "-t",
      ffmpegNumber(durationSec),
      "-r",
      ffmpegNumber(frameRate),
    ],
    outputDurationSec: durationSec,
    totalFrames: Math.max(1, Math.round(durationSec * frameRate)),
  };
}

type PrepareLayerArgs = {
  layer: SceneGraphLayer;
  inputArgs: string[];
  fontFile: string | null;
  textFiles: Map<string, string>;
  assets: Map<string, CompilerAsset>;
  frameRate: number;
  durationSec: number;
};

function prepareLayer(args: PrepareLayerArgs): { source: string; transforms: string[] } | null {
  const { layer, inputArgs, frameRate, durationSec } = args;

  if (layer.type === "GROUP") {
    throw new RenderFeatureError(
      "GROUP_LAYER_UNSUPPORTED",
      `Layer "${layer.name}" is a group; group compositing is not supported`,
    );
  }

  if (layer.type === "TEXT") {
    if (!args.fontFile) {
      throw new RenderFeatureError(
        "NO_FONT_AVAILABLE",
        "A text layer needs a font file and none was found",
      );
    }
    const textFile = args.textFiles.get(layer.id);
    if (!textFile) {
      throw new RenderFeatureError(
        "TEXT_SOURCE_MISSING",
        `Text layer "${layer.name}" has no prepared text file`,
      );
    }

    const boxWidth = dimension(layer.width);
    const boxHeight = dimension(layer.height);
    const fontSize = Math.max(8, Math.round(boxHeight * 0.5));

    inputArgs.push(
      "-f",
      "lavfi",
      "-i",
      `color=c=black@0.0:s=${boxWidth}x${boxHeight}:r=${frameRate}:d=${durationSec}`,
    );

    return {
      source: "format=rgba",
      transforms: [
        `drawtext=fontfile=${escapeFilterPath(args.fontFile)}:textfile=${escapeFilterPath(
          textFile,
        )}:fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2`,
      ],
    };
  }

  if (layer.type === "SHAPE") {
    const boxWidth = dimension(layer.width);
    const boxHeight = dimension(layer.height);

    inputArgs.push(
      "-f",
      "lavfi",
      "-i",
      `color=c=0x22262e:s=${boxWidth}x${boxHeight}:r=${frameRate}:d=${durationSec}`,
    );

    return { source: "format=rgba", transforms: [] };
  }

  // MEDIA
  if (!layer.assetRef) {
    throw new RenderFeatureError(
      "MEDIA_ASSET_MISSING",
      `Media layer "${layer.name}" has no asset reference`,
    );
  }

  const asset = args.assets.get(layer.id);
  if (!asset) {
    throw new RenderFeatureError(
      "MEDIA_ASSET_UNRESOLVED",
      `Media layer "${layer.name}" could not be resolved to a local file`,
    );
  }

  if (asset.kind === "image") {
    inputArgs.push(
      "-loop",
      "1",
      "-framerate",
      ffmpegNumber(frameRate),
      "-t",
      ffmpegNumber(durationSec),
      "-i",
      asset.path,
    );
  } else {
    inputArgs.push("-i", asset.path);
  }

  const boxWidth = dimension(layer.width);
  const boxHeight = dimension(layer.height);
  const transforms: string[] = ["format=rgba", "setsar=1"];

  if (asset.kind === "video") {
    transforms.push(
      "setpts=PTS-STARTPTS",
      `fps=${ffmpegNumber(frameRate)}`,
      `trim=duration=${ffmpegNumber(durationSec)}`,
      "setpts=PTS-STARTPTS",
    );
  }

  if (layer.fit === "CONTAIN") {
    transforms.push(
      `scale=${boxWidth}:${boxHeight}:force_original_aspect_ratio=decrease`,
      `pad=${boxWidth}:${boxHeight}:(ow-iw)/2:(oh-ih)/2`,
    );
  } else if (layer.fit === "COVER") {
    transforms.push(
      `scale=${boxWidth}:${boxHeight}:force_original_aspect_ratio=increase`,
      `crop=${boxWidth}:${boxHeight}`,
    );
  } else {
    transforms.push(`scale=${boxWidth}:${boxHeight}`);
  }

  return { source: "", transforms };
}

function motionFor(
  layer: SceneGraphLayer,
  property: MotionProperty,
  durationMs: number,
): MotionExpression {
  const keyframes = layer.keyframes.filter(
    (keyframe: SceneGraphKeyframe) => keyframe.property === property,
  );

  if (keyframes.length === 0) {
    return { expression: ffmpegNumber(NEUTRAL[property]), constant: true, value: NEUTRAL[property] };
  }

  return keyframesToFfmpegExpr(keyframes, durationMs);
}

function effectFilters(effects: readonly SceneGraphEffect[]): string[] {
  const filters: string[] = [];

  for (const effect of effects) {
    if (!effect.enabled) continue;

    switch (effect.type) {
      case "BLUR":
        if (effect.amount > 0) filters.push(`gblur=sigma=${ffmpegNumber(effect.amount)}`);
        break;
      case "BRIGHTNESS":
        if (effect.amount !== 1) {
          filters.push(`eq=brightness=${ffmpegNumber(effect.amount - 1)}`);
        }
        break;
      case "CONTRAST":
        if (effect.amount !== 1) filters.push(`eq=contrast=${ffmpegNumber(effect.amount)}`);
        break;
      case "SATURATION":
        if (effect.amount !== 1) filters.push(`eq=saturation=${ffmpegNumber(effect.amount)}`);
        break;
      case "GRAYSCALE":
        if (effect.amount > 0) {
          filters.push(`hue=s=${ffmpegNumber(1 - Math.min(1, effect.amount))}`);
        }
        break;
    }
  }

  return filters;
}

function dimension(value: number): number {
  return Math.max(1, Math.round(value));
}

function normaliseAngle(value: number): number {
  const wrapped = value % 360;
  return wrapped === 0 ? 0 : wrapped;
}

/**
 * Escapes a filesystem path for a filter argument. The paths the compiler emits
 * are inside a work directory it created, but escaping keeps a future caller
 * from smuggling graph syntax through a path.
 */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/,/g, "\\,");
}
