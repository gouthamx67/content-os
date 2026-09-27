import type { ObservedElement } from "../../core/domain/browser";

/**
 * In-page observation extractor.
 *
 * This function is serialized into the page by `page.evaluate`. It is
 * first-party code with a fixed shape: planners never supply it, never
 * parameterize it with expressions, and cannot extend it. That is the
 * difference between this and the arbitrary `evaluate` the agent does not
 * expose.
 */

export interface ObservationExtraction {
  url: string;
  title: string;
  pageText: string;
  elements: ObservedElement[];
  dialogs: ObservedElement[];
  forms: ObservedElement[];
  links: ObservedElement[];
}

export function extractObservation(options: {
  maxText: number;
  maxElements: number;
}): ObservationExtraction {
  const maxText = options.maxText;
  const maxElements = options.maxElements;

  // Declared inside the function on purpose: page.evaluate ships only this
  // function's source, so module-scope constants would be undefined in the page.
  const interactiveSelector = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=checkbox]",
    "[role=switch]",
    "[role=textbox]",
    "[contenteditable=true]",
  ].join(",");

  function isHidden(element: Element): boolean {
    const html = element as HTMLElement;
    if (html.hidden) return true;
    if (element.getAttribute("aria-hidden") === "true") return true;
    const style = window.getComputedStyle(html);
    if (style.display === "none" || style.visibility === "hidden") return true;
    return false;
  }

  function roleOf(element: Element): string {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit.trim().toLowerCase();
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return element.hasAttribute("href") ? "link" : "generic";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return element.hasAttribute("multiple") || element.getAttribute("aria-multiselectable") === "true" ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "option") return "option";
    if (tag === "ul" || tag === "ol") return "list";
    if (tag === "li") return "listitem";
    if (tag === "form") return "form";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "table") return "table";
    if (tag === "tr") return "row";
    if (tag === "td" || tag === "th") return "cell";
    if (tag === "dialog") return "dialog";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "input") {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "file" || type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    return "generic";
  }

  function kindOf(element: Element, role: string): ObservedElement["kind"] {
    switch (role) {
      case "button":
        return "BUTTON";
      case "link":
        return "LINK";
      case "checkbox":
        return "CHECKBOX";
      case "radio":
        return "RADIO";
      case "combobox":
      case "listbox":
        return "SELECT";
      case "textbox":
      case "searchbox":
      case "spinbutton":
        return "TEXTBOX";
      case "dialog":
        return "DIALOG";
      case "form":
        return "FORM";
      case "heading":
        return "HEADING";
      case "menuitem":
        return "MENU_ITEM";
      case "tab":
        return "TAB";
      case "list":
        return "LIST";
      default:
        return "OTHER";
    }
  }

  /** Approximates the accessible name computation the browser performs. */
  function accessibleName(element: Element): string {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
    const id = element.getAttribute("id");
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim();
    }
    const wrapping = element.closest("label");
    if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
    const tag = element.tagName.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") {
      const type = (element.getAttribute("type") ?? "").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset") {
        return (element.getAttribute("value") ?? "").trim();
      }
      const placeholder = element.getAttribute("placeholder");
      if (placeholder && placeholder.trim()) return placeholder.trim();
      if (type === "file") return "Upload";
    }
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 200);
    const title = element.getAttribute("title");
    if (title && title.trim()) return title.trim();
    const alt = element.getAttribute("alt");
    if (alt && alt.trim()) return alt.trim();
    return "";
  }

  /**
   * Credential material never enters an observation: password field values are
   * reported as null, and the page text is scanned for obvious
   * `password=...`-style query leaks.
   */
  function valueOf(element: Element, role: string): string | null {
    const tag = element.tagName.toLowerCase();
    if (tag === "input") {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      if (type === "password") return null;
      if (type === "file") {
        const file = (element as HTMLInputElement).files?.[0];
        return file ? file.name : null;
      }
      if (type === "checkbox" || type === "radio") {
        return (element as HTMLInputElement).checked ? "true" : "false";
      }
      const value = (element as HTMLInputElement).value ?? "";
      return value ? value.slice(0, 200) : null;
    }
    if (tag === "textarea" || tag === "select") {
      const value = (element as HTMLTextAreaElement).value ?? "";
      return value ? value.slice(0, 200) : null;
    }
    if (role === "button" || role === "link") return null;
    return null;
  }

  function toElement(element: Element): ObservedElement {
    const role = roleOf(element);
    const href = element.tagName.toLowerCase() === "a" ? element.getAttribute("href") : null;
    return {
      role,
      name: accessibleName(element),
      kind: kindOf(element, role),
      value: valueOf(element, role),
      href: href === null ? null : href.slice(0, 300),
    };
  }

  const elements: ObservedElement[] = [];
  for (const node of Array.from(document.querySelectorAll(interactiveSelector))) {
    if (elements.length >= maxElements) break;
    if (isHidden(node)) continue;
    elements.push(toElement(node));
  }

  const dialogs: ObservedElement[] = [];
  for (const node of Array.from(document.querySelectorAll("dialog, [role=dialog], [role=alertdialog]"))) {
    if (dialogs.length >= 10) break;
    if (isHidden(node)) continue;
    dialogs.push(toElement(node));
  }

  const forms: ObservedElement[] = [];
  for (const node of Array.from(document.querySelectorAll("form"))) {
    if (forms.length >= 10) break;
    if (isHidden(node)) continue;
    forms.push(toElement(node));
  }

  const links: ObservedElement[] = [];
  for (const node of Array.from(document.querySelectorAll("a[href]"))) {
    if (links.length >= maxElements) break;
    if (isHidden(node)) continue;
    const element = toElement(node);
    if (element.name) links.push(element);
  }

  const headings: ObservedElement[] = [];
  for (const node of Array.from(document.querySelectorAll("h1, h2, [role=heading]"))) {
    if (headings.length >= 20) break;
    if (isHidden(node)) continue;
    headings.push(toElement(node));
  }
  for (const heading of headings) {
    if (elements.length >= maxElements) break;
    elements.push(heading);
  }

  let pageText = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
  if (pageText.length > maxText) pageText = `${pageText.slice(0, maxText - 1)}…`;

  return {
    url: window.location.href,
    title: document.title,
    pageText,
    elements,
    dialogs,
    forms,
    links,
  };
}
