import { describe, expect, it } from "vitest";
import { ImageGenerationError } from "../errors";
import {
  escapeXml,
  renderElement,
  renderSvg,
  renderTextElement,
} from "../render/svg-renderer";
import { sampleGraph } from "./fixtures";

describe("escapeXml", () => {
  it("escapes every XML-significant character", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;",
    );
  });

  it("neutralises a script tag in text content", () => {
    const svg = renderTextElement({
      id: "t",
      type: "TEXT",
      x: 0,
      y: 20,
      width: 100,
      height: 30,
      zIndex: 1,
      text: "<script>alert(1)</script>",
    });

    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("renderSvg", () => {
  it("draws a colour background and escaped text", () => {
    const svg = renderSvg(sampleGraph());
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#0B0C0F"');
    expect(svg).toContain("Hello &lt;world&gt; &amp; &quot;you&quot;");
    expect(svg).not.toContain("<world>");
  });

  it("omits the background rect for a transparent design", () => {
    const svg = renderSvg(
      sampleGraph({ background: { kind: "TRANSPARENT" } }),
    );
    expect(svg).not.toContain("<rect");
  });

  it("orders elements by zIndex, not array order", () => {
    const svg = renderSvg(
      sampleGraph({
        elements: [
          {
            id: "back",
            type: "RECT",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            zIndex: 5,
            style: { fill: "#111111" },
          },
          {
            id: "front",
            type: "RECT",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            zIndex: 1,
            style: { fill: "#222222" },
          },
        ],
      }),
    );

    expect(svg.indexOf("#222222")).toBeLessThan(svg.indexOf("#111111"));
  });

  it("refuses an image element with no resolved source", () => {
    expect(() =>
      renderElement(
        {
          id: "img",
          type: "IMAGE",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          zIndex: 0,
          assetRef: "product:1",
        },
        new Map(),
      ),
    ).toThrowError(ImageGenerationError);
  });
});
