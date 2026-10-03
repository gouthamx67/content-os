/**
 * An image is embedded into the SVG as a data URL rather than a file name. The
 * rasterizer is a pure function of the SVG string, so every byte it needs must
 * already be inside that string; a path would reintroduce filesystem state and
 * make the same graph render differently on two machines.
 */
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function mimeTypeForOutput(format: "PNG" | "JPEG"): string {
  return format === "JPEG" ? "image/jpeg" : "image/png";
}
