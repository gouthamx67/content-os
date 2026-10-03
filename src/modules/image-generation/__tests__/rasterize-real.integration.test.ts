import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspectImage } from "../artifact/image-metadata";
import { ImageGenerationError } from "../errors";
import { localGraphicProvider } from "../providers/local-graphic-provider";
import { rasterizeSvg } from "../render/rasterize";
import { renderSvg } from "../render/svg-renderer";
import { sampleGraph } from "./fixtures";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

describe("real rasterization (sharp/libvips)", () => {
  it("rasterizes SVG text to a real PNG of the requested size", async () => {
    const result = await rasterizeSvg({
      svg: renderSvg(sampleGraph({ width: 320, height: 200 })),
      width: 320,
      height: 200,
      format: "PNG",
      transparent: false,
    });

    expect(result.bytes.subarray(0, 4)).toEqual(PNG_MAGIC);
    expect(result.mimeType).toBe("image/png");

    const image = await inspectImage(result.bytes);
    expect(image.format).toBe("png");
    expect(image.width).toBe(320);
    expect(image.height).toBe(200);
    expect(result.bytes.byteLength).toBeGreaterThan(100);
  });

  it("rasterizes to a real JPEG", async () => {
    const result = await localGraphicProvider.generate({
      graph: sampleGraph({ width: 256, height: 256 }),
      width: 256,
      height: 256,
      format: "JPEG",
      transparent: false,
      imageDataUrls: new Map(),
    });

    expect(result.bytes.subarray(0, 3)).toEqual(JPEG_MAGIC);
    expect(result.mimeType).toBe("image/jpeg");

    const image = await inspectImage(result.bytes);
    expect(image.format).toBe("jpeg");
    expect(image.width).toBe(256);
    expect(image.height).toBe(256);
    expect(result.providerVersion).toBe("local-graphic/1");
  });

  it("keeps a transparent background transparent in the PNG alpha channel", async () => {
    const result = await rasterizeSvg({
      svg: renderSvg(sampleGraph({ background: { kind: "TRANSPARENT" } })),
      width: 128,
      height: 128,
      format: "PNG",
      transparent: true,
    });

    const stats = await sharp(result.bytes).stats();
    const alpha = stats.channels[3];
    expect(alpha).toBeDefined();
    expect(alpha!.min).toBeLessThan(255);
    expect(alpha!.max).toBe(255);
  });

  it("refuses a transparent JPEG instead of flattening it silently", async () => {
    await expect(
      rasterizeSvg({
        svg: renderSvg(sampleGraph()),
        width: 64,
        height: 64,
        format: "JPEG",
        transparent: true,
      }),
    ).rejects.toBeInstanceOf(ImageGenerationError);
  });

  it("produces identical bytes for identical SVG input", async () => {
    const svg = renderSvg(sampleGraph({ width: 200, height: 200 }));
    const first = await rasterizeSvg({
      svg,
      width: 200,
      height: 200,
      format: "PNG",
      transparent: false,
    });
    const second = await rasterizeSvg({
      svg,
      width: 200,
      height: 200,
      format: "PNG",
      transparent: false,
    });

    expect(first.bytes.equals(second.bytes)).toBe(true);
  });
});
