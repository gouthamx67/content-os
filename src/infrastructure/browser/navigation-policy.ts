import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { BrowserError, type BrowserTargetClass } from "../../core/domain/browser";
import { isBlockedIpAddress } from "../ingestion/safe-http";

/**
 * Browser navigation policy.
 *
 * The agent drives a real browser, so an untrusted plan could otherwise point
 * Chromium at internal infrastructure and hand the response back through
 * READ_TEXT. This module is the single choke point: every top-level
 * navigation, sub-navigation, and subresource request is checked here before
 * the network sees it.
 *
 * Two target classes exist:
 *  - PUBLIC: the default. Only public HTTP(S) destinations are reachable.
 *    Loopback, private, link-local, and cloud metadata space is refused, as
 *    are non-HTTP schemes.
 *  - CONTROLLED_LOCAL: explicitly opted in by the operator, used by the test
 *    fixture and by local development apps. It permits only loopback
 *    (127.0.0.0/8, ::1, localhost) — never private LAN ranges, never
 *    link-local, never cloud metadata.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Subresource schemes browsers fetch that must never be followed. */
const DANGEROUS_SCHEME_PATTERN = /^(?:file|javascript|data|blob|about|chrome|chrome-extension|devtools|view-source|ws|wss|ftp|mailto|tel|jar|res):/i;

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
  ".test",
  ".invalid",
  ".localdomain",
];

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface BrowserNavigationPolicy {
  targetClass: BrowserTargetClass;
  /** Hard ceiling on redirects followed per navigation. */
  maxRedirects: number;
  /** When false, subresources are not intercepted (still subject to checks). */
  blockSubresources: boolean;
}

export const DEFAULT_BROWSER_NAVIGATION_POLICY: BrowserNavigationPolicy = {
  targetClass: "PUBLIC",
  maxRedirects: 5,
  blockSubresources: true,
};

function blocked(message: string): BrowserError {
  return new BrowserError("NAVIGATION_BLOCKED", message);
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (LOOPBACK_HOSTNAMES.has(normalized)) return true;
  if (isIP(normalized) !== 0) return isLoopbackAddress(normalized);
  return false;
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (isIP(normalized) === 4) {
    return (Number(normalized.split(".")[0]) === 127);
  }
  if (isIP(normalized) !== 6) return false;
  if (normalized === "::1") return true;
  const mapped = normalized.match(/(?:^::ffff:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? Number(mapped.split(".")[0]) === 127 : false;
}

export interface ParsedBrowserUrl {
  url: URL;
  host: string;
  isLoopback: boolean;
}

/**
 * Shape-level policy: scheme, credentials, host suffixes, and literal IP
 * ranges. No DNS. Safe to call synchronously on every request.
 */
export function checkBrowserUrl(rawUrl: string, policy: BrowserNavigationPolicy): ParsedBrowserUrl {
  if (rawUrl.length > 2048) {
    throw blocked("URL exceeds the maximum length");
  }
  if (DANGEROUS_SCHEME_PATTERN.test(rawUrl.trim())) {
    throw blocked(`Refusing to navigate to a non-HTTP scheme: ${rawUrl.slice(0, 32)}`);
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw blocked("URL is not a valid absolute URL");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw blocked(`Refusing to navigate using protocol ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw blocked("Refusing to navigate to a URL containing credentials");
  }

  const host = normalizeHostname(url.hostname);
  if (host.length === 0) {
    throw blocked("URL has no hostname");
  }
  if (DANGEROUS_SCHEME_PATTERN.test(host)) {
    throw blocked("URL hostname uses a forbidden scheme");
  }

  const literalIp = isIP(host) !== 0;
  const isLoopback = isLoopbackHost(host);

  if (policy.targetClass === "CONTROLLED_LOCAL") {
    if (!isLoopback) {
      throw blocked(
        `CONTROLLED_LOCAL targets may only reach loopback, refused ${host}`,
      );
    }
    return { url, host, isLoopback: true };
  }

  // PUBLIC: nothing loopback-adjacent may be reached, by name or literal.
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw blocked(`Refusing to navigate to an internal hostname: ${host}`);
  }
  if (literalIp && (isLoopback || isBlockedIpAddress(host))) {
    throw blocked(`Refusing to navigate to a non-public address: ${host}`);
  }

  return { url, host, isLoopback };
}

/**
 * DNS-level policy for PUBLIC targets. A public hostname that resolves into
 * private or loopback space is a rebinding vector, so it is refused before the
 * request is issued. CONTROLLED_LOCAL targets skip this: they are loopback
 * names by definition.
 */
export async function assertPublicResolution(host: string, policy: BrowserNavigationPolicy): Promise<void> {
  if (policy.targetClass !== "PUBLIC") return;
  if (isIP(host) !== 0) return;

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw blocked(`Hostname could not be resolved: ${host}`);
  }
  if (addresses.length === 0) {
    throw blocked(`Hostname resolved to no addresses: ${host}`);
  }
  if (addresses.some((entry) => isBlockedIpAddress(entry.address) || isLoopbackAddress(entry.address))) {
    throw blocked(`Hostname resolves to a non-public address: ${host}`);
  }
}

export function isPubliclyRoutableUrl(rawUrl: string): boolean {
  try {
    checkBrowserUrl(rawUrl, DEFAULT_BROWSER_NAVIGATION_POLICY);
    return true;
  } catch {
    return false;
  }
}

/** Schemes an upload may target, enforced against the declared MIME type. */
const ALLOWED_UPLOAD_MIME_PREFIXES = ["image/", "text/", "application/pdf", "application/json"];

export function isAllowedUpload(mimeType: string, sizeBytes: number, maxBytes: number): boolean {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) return false;
  const normalized = mimeType.toLowerCase().split(";", 1)[0] ?? "";
  return ALLOWED_UPLOAD_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * The single source of truth for upload types. Extension and MIME are one entry
 * so a resolver cannot declare a MIME type that disagrees with the file name and
 * slip past the two independent checks below.
 */
const ALLOWED_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".json": "application/json",
};

function uploadExtension(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  const extension = lower.slice(dot);
  return Object.hasOwn(ALLOWED_UPLOAD_TYPES, extension) ? extension : null;
}

export function hasAllowedUploadExtension(fileName: string): boolean {
  return uploadExtension(fileName) !== null;
}

/** MIME type for an allowed upload file name, or null when the name is refused. */
export function uploadMimeTypeFor(fileName: string): string | null {
  const extension = uploadExtension(fileName);
  return extension === null ? null : ALLOWED_UPLOAD_TYPES[extension] ?? null;
}
