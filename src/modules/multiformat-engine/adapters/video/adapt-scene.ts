import type { RendererContract } from "../../../visual-motion-engine/export/renderer-contract";
import { VISUAL_RENDERER_CONTRACT_VERSION } from "../../../visual-motion-engine/export/renderer-contract";
import type { SceneGraphLayer } from "../../../visual-motion-engine/serialization/scene-graph";
import type { VisualCompositionSourceSnapshot } from "../../domain/types";
import { AdaptationError } from "../../errors";

export type AdaptSceneArgs = {
  projectId: string;
  snapshot: VisualCompositionSourceSnapshot;
  targetWidth: number;
  targetHeight: number;
};

/**
 * Re-frames a whole composition for a new output shape.
 *
 * Every layer and every keyframe survives — a format change must not quietly
 * remove the animation — but the geometry is re-laid-out for the target canvas:
 * horizontal positions and widths follow the horizontal ratio, vertical positions
 * and heights follow the vertical one, and an `X` or `Y` keyframe is scaled by the
 * same factor as the property it animates.
 *
 * Multiplicative properties are left alone on purpose. `SCALE`, `ROTATION` and
 * `OPACITY` are ratios, not pixels: multiplying a scale keyframe by the canvas
 * ratio would turn "grow to 120%" into "grow to 144%" and quietly change what the
 * motion means.
 *
 * The result is a CP14 renderer contract, so CP15 encodes it with exactly the
 * pipeline it uses for a composition rendered in place — no second renderer.
 */
export function adaptSceneGraph(args: AdaptSceneArgs): RendererContract {
  const { snapshot } = args;

  if (snapshot.width <= 0 || snapshot.height <= 0) {
    throw new AdaptationError(
      "ADAPTATION_VIDEO_COMPOSITION_INVALID",
      "The composition has no usable canvas",
      422,
    );
  }

  if (!Array.isArray(snapshot.layers) || snapshot.layers.length === 0) {
    throw new AdaptationError(
      "ADAPTATION_VIDEO_COMPOSITION_INVALID",
      "The composition has no layers to adapt",
      422,
    );
  }

  if (
    !Number.isFinite(args.targetWidth) ||
    !Number.isFinite(args.targetHeight) ||
    args.targetWidth <= 0 ||
    args.targetHeight <= 0
  ) {
    throw new AdaptationError(
      "ADAPTATION_VIDEO_COMPOSITION_INVALID",
      "The target format has no usable canvas",
      422,
    );
  }

  const scaleX = args.targetWidth / snapshot.width;
  const scaleY = args.targetHeight / snapshot.height;

  const layers: SceneGraphLayer[] = snapshot.layers.map((layer) => ({
    ...layer,
    x: layer.x * scaleX,
    y: layer.y * scaleY,
    width: layer.width * scaleX,
    height: layer.height * scaleY,
    cropX: layer.cropX * scaleX,
    cropY: layer.cropY * scaleY,
    cropWidth: layer.cropWidth === null ? null : layer.cropWidth * scaleX,
    cropHeight:
      layer.cropHeight === null ? null : layer.cropHeight * scaleY,
    keyframes: layer.keyframes.map((keyframe) => {
      if (keyframe.property === "X") {
        return {
          ...keyframe,
          fromValue: keyframe.fromValue * scaleX,
          toValue: keyframe.toValue * scaleX,
        };
      }

      if (keyframe.property === "Y") {
        return {
          ...keyframe,
          fromValue: keyframe.fromValue * scaleY,
          toValue: keyframe.toValue * scaleY,
        };
      }

      return keyframe;
    }),
  }));

  return {
    contractVersion: VISUAL_RENDERER_CONTRACT_VERSION,
    composition: {
      id: snapshot.compositionId,
      projectId: args.projectId,
      canvas: {
        width: args.targetWidth,
        height: args.targetHeight,
        frameRate: snapshot.frameRate,
        durationMs: snapshot.durationMs,
      },
      layers,
    },
  };
}