import type {
  GraphicDesignGraph,
  GraphicElement,
  GraphicStyle,
} from "../domain/types";
import { ImageGenerationError } from "../errors";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function attrs(style: GraphicStyle | undefined): string {
  if (!style) return "";
  const parts: string[] = [];
  if (style.opacity !== undefined) parts.push(`opacity="${style.opacity}"`);
  if (style.fill !== undefined) parts.push(`fill="${escapeXml(style.fill)}"`);
  if (style.stroke !== undefined) {
    parts.push(`stroke="${escapeXml(style.stroke)}"`);
    parts.push(`stroke-width="${style.strokeWidth ?? 1}"`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function textAnchor(style: GraphicStyle | undefined): "start" | "middle" | "end" {
  if (style?.align === "center") return "middle";
  if (style?.align === "right") return "end";
  return "start";
}

function textX(element: GraphicElement): number {
  if (element.style?.align === "center") return element.x + element.width / 2;
  if (element.style?.align === "right") return element.x + element.width;
  return element.x;
}

export function renderTextElement(element: GraphicElement): string {
  const style = element.style ?? {};
  const fontSize = style.fontSize ?? 24;
  const lineHeight = style.lineHeight ?? 1.2;
  const lines = (element.text ?? "").split("\n");
  const anchor = textAnchor(style);
  const x = textX(element);

  const tspans = lines
    .map((line, index) => {
      const dy = index === 0 ? fontSize : fontSize * lineHeight;
      return `<tspan x="${x}" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  const fontAttrs = [
    `font-size="${fontSize}"`,
    `font-family="${escapeXml(style.fontFamily ?? "sans-serif")}"`,
    `font-weight="${style.fontWeight ?? 400}"`,
    `text-anchor="${anchor}"`,
    style.letterSpacing !== undefined ? `letter-spacing="${style.letterSpacing}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<text x="${x}" y="${element.y}" ${fontAttrs} fill="${escapeXml(
    style.fill ?? "#FFFFFF",
  )}"${style.opacity !== undefined ? ` opacity="${style.opacity}"` : ""}>${tspans}</text>`;
}

export function renderImageElement(
  element: GraphicElement,
  dataUrl: string,
): string {
  return `<image href="${dataUrl}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" preserveAspectRatio="xMidYMid slice" />`;
}

export function renderElement(
  element: GraphicElement,
  imageDataUrls: ReadonlyMap<string, string>,
): string {
  switch (element.type) {
    case "BACKGROUND":
      return `<rect x="0" y="0" width="100%" height="100%"${attrs(element.style)} />`;
    case "RECT": {
      const radius = element.style?.radius;
      const rx = radius ? ` rx="${radius}" ry="${radius}"` : "";
      return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}"${rx}${attrs(
        element.style,
      )} />`;
    }
    case "CIRCLE": {
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      const r = Math.min(element.width, element.height) / 2;
      return `<circle cx="${cx}" cy="${cy}" r="${r}"${attrs(element.style)} />`;
    }
    case "TEXT":
      return renderTextElement(element);
    case "IMAGE": {
      const dataUrl = imageDataUrls.get(element.id);
      if (!dataUrl) {
        throw new ImageGenerationError(
          "IMAGE_SOURCE_NOT_FOUND",
          `Image element ${element.id} has no resolved source`,
          422,
        );
      }
      return renderImageElement(element, dataUrl);
    }
    default:
      throw new ImageGenerationError(
        "IMAGE_INVALID_REQUEST",
        `Unsupported element type: ${String(element.type)}`,
        500,
      );
  }
}

export function renderSvg(
  graph: GraphicDesignGraph,
  imageDataUrls: ReadonlyMap<string, string> = new Map(),
): string {
  const ordered = graph.elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.zIndex - b.element.zIndex || a.index - b.index)
    .map((entry) => entry.element);

  const background =
    graph.background.kind === "TRANSPARENT"
      ? ""
      : `<rect x="0" y="0" width="${graph.width}" height="${graph.height}" fill="${escapeXml(
          graph.background.color,
        )}" />`;

  const body = ordered
    .map((element) => renderElement(element, imageDataUrls))
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${graph.width}" height="${graph.height}" viewBox="0 0 ${graph.width} ${graph.height}">${background}${body}</svg>`;
}
