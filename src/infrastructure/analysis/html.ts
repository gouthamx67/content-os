import { collapseWhitespace, decodeHtmlEntities, stripTags } from "./text";

export interface HtmlMeta {
  name: string;
  content: string;
}

export interface HtmlHeading {
  level: number;
  text: string;
}

export interface HtmlLink {
  href: string;
  text: string;
}

export interface HtmlImage {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface HtmlBlock {
  /** Heading this block sits under, in document order. */
  heading: string | null;
  kind: "HEADING" | "PARAGRAPH" | "LIST_ITEM";
  text: string;
}

export interface HtmlDocument {
  title: string | null;
  meta: HtmlMeta[];
  headings: HtmlHeading[];
  links: HtmlLink[];
  buttons: string[];
  paragraphs: string[];
  listItems: string[];
  images: HtmlImage[];
  colors: string[];
  fonts: string[];
  /**
   * Body blocks in the order they appeared, each tagged with the heading it
   * sits under. `paragraphs` and friends are flat for convenience; this keeps
   * the document's own structure, which is what narrative scope depends on.
   */
  blocks: HtmlBlock[];
}

const INTERESTING_TAGS = new Set([
  "title",
  "meta",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "a",
  "button",
  "img",
  "style",
]);

const BLOCK_TAGS = new Set([
  "title",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "a",
  "button",
  "style",
]);

function removeNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!doctype[^>]*>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template\s*>/gi, " ");
}

function parseAttributes(raw: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (!attributes.has(name)) attributes.set(name, value);
  }
  return attributes;
}

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;
const FONT_FAMILY = /font-family\s*:\s*([^;}"']{2,80})/gi;

function collectDesignTokens(html: string): { colors: string[]; fonts: string[] } {
  const colors = new Set<string>();
  const fonts = new Set<string>();
  for (const match of html.matchAll(HEX_COLOR)) {
    const value = match[0].toLowerCase();
    if (value.length === 4 || value.length === 7 || value.length === 9) colors.add(value);
  }
  for (const match of html.matchAll(FONT_FAMILY)) {
    const value = collapseWhitespace(match[1].replace(/["']/g, ""));
    if (value.length > 1 && value.length <= 80) fonts.add(value);
  }
  return { colors: [...colors], fonts: [...fonts] };
}

const INLINE_TAGS = new Set([
  "b",
  "i",
  "em",
  "strong",
  "span",
  "small",
  "code",
  "time",
  "label",
  "sup",
  "sub",
  "u",
  "s",
  "br",
  "wbr",
]);

const TAG_AT = /<\/?([a-zA-Z][a-zA-Z0-9]*)/;

/**
 * Finds the next tag that must end the current element. Inline markup is
 * skipped so that `<a>Start <b>free</b> trial</a>` keeps its full text, while
 * unterminated elements such as `<h1>Broken<p>next` stop at the block tag
 * instead of swallowing the rest of the document.
 */
function nextBlockBoundary(html: string, fromIndex: number): number {
  let cursor = fromIndex;
  while (cursor < html.length) {
    const open = html.indexOf("<", cursor);
    if (open === -1) return -1;
    const match = TAG_AT.exec(html.slice(open, open + 32));
    if (!match) {
      cursor = open + 1;
      continue;
    }
    if (!INLINE_TAGS.has(match[1].toLowerCase())) return open;
    cursor = open + 1;
  }
  return -1;
}

function readInnerText(html: string, tag: string, fromIndex: number): { text: string; end: number } {
  const closeTag = `</${tag}`;
  const closeIndex = html.toLowerCase().indexOf(closeTag, fromIndex);
  const boundaryIndex = nextBlockBoundary(html, fromIndex);

  if (closeIndex === -1) {
    if (boundaryIndex === -1) return { text: html.slice(fromIndex), end: html.length };
    return { text: html.slice(fromIndex, boundaryIndex), end: boundaryIndex };
  }
  if (boundaryIndex !== -1 && boundaryIndex < closeIndex) {
    return { text: html.slice(fromIndex, boundaryIndex), end: boundaryIndex };
  }
  return { text: html.slice(fromIndex, closeIndex), end: closeIndex };
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1_000_000 ? parsed : null;
}

export function parseHtmlDocument(html: string): HtmlDocument {
  const source = removeNonContent(html);
  const document: HtmlDocument = {
    title: null,
    meta: [],
    headings: [],
    links: [],
    buttons: [],
    paragraphs: [],
    listItems: [],
    images: [],
    colors: [],
    fonts: [],
    blocks: [],
  };

  const pattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let currentHeading: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    if (!INTERESTING_TAGS.has(tag)) continue;
    if (closing) continue;
    const attributes = parseAttributes(match[3] ?? "");
    const selfClosing = match[4] === "/";

    if (tag === "meta") {
      const name =
        attributes.get("name") ??
        attributes.get("property") ??
        attributes.get("itemprop") ??
        attributes.get("http-equiv");
      const content = attributes.get("content");
      if (name && content) {
        document.meta.push({ name: name.toLowerCase(), content: collapseWhitespace(content) });
      }
      continue;
    }

    if (tag === "img") {
      document.images.push({
        src: attributes.get("src") ?? attributes.get("data-src") ?? "",
        alt: collapseWhitespace(attributes.get("alt") ?? ""),
        width: toNumber(attributes.get("width")),
        height: toNumber(attributes.get("height")),
      });
      continue;
    }

    if (selfClosing) continue;

    if (tag === "style") {
      const inner = readInnerText(source, "style", match.index + match[0].length);
      pattern.lastIndex = inner.end;
      continue;
    }

    if (tag === "a") {
      const inner = readInnerText(source, "a", match.index + match[0].length);
      const text = collapseWhitespace(stripTags(inner.text));
      if (text.length > 0) {
        document.links.push({ href: attributes.get("href") ?? "", text });
      }
      pattern.lastIndex = inner.end;
      continue;
    }

    if (tag === "title") {
      const inner = readInnerText(source, "title", match.index + match[0].length);
      document.title = collapseWhitespace(stripTags(inner.text)) || null;
      pattern.lastIndex = inner.end;
      continue;
    }

    if (tag === "button") {
      const inner = readInnerText(source, "button", match.index + match[0].length);
      const text = collapseWhitespace(stripTags(inner.text));
      if (text.length > 0) document.buttons.push(text);
      pattern.lastIndex = inner.end;
      continue;
    }

    if (BLOCK_TAGS.has(tag)) {
      const inner = readInnerText(source, tag, match.index + match[0].length);
      const text = collapseWhitespace(stripTags(inner.text));
      const level = /^h([1-6])$/.exec(tag);
      if (level && text.length > 0) {
        document.headings.push({ level: Number(level[1]), text });
        if (Number(level[1]) <= 2) currentHeading = text;
        document.blocks.push({ heading: currentHeading, kind: "HEADING", text });
      } else if (tag === "p" && text.length > 0) {
        document.paragraphs.push(text);
        document.blocks.push({ heading: currentHeading, kind: "PARAGRAPH", text });
      } else if (tag === "li" && text.length > 0) {
        document.listItems.push(text);
        document.blocks.push({ heading: currentHeading, kind: "LIST_ITEM", text });
      }
      pattern.lastIndex = inner.end;
    }
  }

  const tokens = collectDesignTokens(source);
  document.colors = tokens.colors;
  document.fonts = tokens.fonts;
  return document;
}

export function findMeta(document: HtmlDocument, ...names: string[]): string | null {
  for (const name of names) {
    const entry = document.meta.find((item) => item.name === name);
    if (entry && entry.content.length > 0) return decodeHtmlEntities(entry.content);
  }
  return null;
}
