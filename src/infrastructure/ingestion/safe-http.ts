import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, request, type Dispatcher } from "undici";
import { InputError } from "../../core/domain/input";

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
  ".test",
  ".invalid",
];

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const values = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255) ? values : null;
}

function isBlockedIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function mappedIpv4(address: string): string | null {
  const dotted = address.match(/(?:^::ffff:)(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (dotted) return dotted;
  if (address.toLowerCase().startsWith("::ffff:")) {
    const groups = address.slice("::ffff:".length).split(":");
    if (groups.length === 2 && groups.every((group) => /^[\da-f]{1,4}$/i.test(group))) {
      const high = Number.parseInt(groups[0] ?? "0", 16);
      const low = Number.parseInt(groups[1] ?? "0", 16);
      return [(high >> 8), high & 255, (low >> 8), low & 255].join(".");
    }
  }
  const expanded = address.match(/^(?:0:){5}ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i);
  if (expanded) {
    const high = Number.parseInt(expanded[1] ?? "0", 16);
    const low = Number.parseInt(expanded[2] ?? "0", 16);
    return [(high >> 8), high & 255, (low >> 8), low & 255].join(".");
  }
  return null;
}

function ipv6Value(address: string): bigint | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string): string[] | null => {
    if (!half) return [];
    const parts = half.split(":");
    const last = parts.at(-1);
    if (last?.includes(".")) {
      const bytes = ipv4Parts(last);
      if (!bytes) return null;
      parts[parts.length - 1] = ((bytes[0]! << 8) | bytes[1]!).toString(16);
      parts.push(((bytes[2]! << 8) | bytes[3]!).toString(16));
    }
    return parts.every((part) => /^[\da-f]{1,4}$/i.test(part)) ? parts : null;
  };

  const left = parseHalf(halves[0] ?? "");
  const right = halves.length === 2 ? parseHalf(halves[1] ?? "") : [];
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [
    ...left,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0000"),
    ...right,
  ];
  return groups.length === 8
    ? BigInt(`0x${groups.map((group) => group.padStart(4, "0")).join("")}`)
    : null;
}

function isIpv6Cidr(address: string, network: string, prefixBits: number): boolean {
  const value = ipv6Value(address);
  const networkValue = ipv6Value(network);
  if (value === null || networkValue === null) return true;
  const shift = BigInt(128 - prefixBits);
  return (value >> shift) === (networkValue >> shift);
}

export function isBlockedIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  const family = isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family !== 6) return true;

  const mapped = mappedIpv4(normalized);
  if (mapped) return isBlockedIpv4(mapped);
  return [
    ["::", 96],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 32],
    ["2001:2::", 48],
    ["2001:10::", 28],
    ["2001:20::", 28],
    ["2001:30::", 28],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
    ["5f00::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ].some(([network, prefix]) => isIpv6Cidr(normalized, String(network), Number(prefix)));
}

export function validateHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InputError("URL_BLOCKED", "URL is invalid");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    (isIP(hostname) !== 0 && isBlockedIpAddress(hostname))
  ) {
    throw new InputError("URL_BLOCKED", "Only public HTTP or HTTPS URLs are allowed");
  }
  return url;
}

function timeoutError(): Error {
  const error = new Error("Operation timed out");
  error.name = "TimeoutError";
  return error;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(timeoutError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(timeoutError());
    signal.addEventListener("abort", onAbort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function resolvePublic(hostname: string, signal: AbortSignal): Promise<void> {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(normalizedHostname) !== 0) {
    if (isBlockedIpAddress(normalizedHostname)) {
      throw new InputError("URL_BLOCKED", "URL resolves to a non-public address");
    }
    return;
  }
  let addresses: LookupAddress[];
  try {
    addresses = await abortable(lookup(normalizedHostname, { all: true, verbatim: true }), signal);
  } catch (error) {
    if (isTimeout(error)) throw new InputError("URL_TIMEOUT", "URL request timed out");
    throw new InputError("URL_BLOCKED", "URL hostname could not be resolved");
  }
  if (addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new InputError("URL_BLOCKED", "URL resolves to a non-public address");
  }
}

function createDispatcher(signal: AbortSignal): Dispatcher {
  return new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        void abortable(lookup(hostname, { all: true, verbatim: true }), signal)
          .then((addresses) => {
            if (addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
              callback(new Error("DNS resolved to a blocked address"), "", 0);
              return;
            }
            if (options.all) {
              callback(null, addresses);
              return;
            }
            const first = addresses[0];
            if (!first) {
              callback(new Error("DNS returned no addresses"), "", 0);
              return;
            }
            callback(null, first.address, first.family);
          })
          .catch((error: Error) => callback(error, "", 0));
      },
    },
  });
}

export interface PublicFetchOptions {
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export interface PublicFetchResult {
  url: string;
  statusCode: number;
  contentType: string | null;
  body: Uint8Array;
}

function isRedirect(statusCode: number): boolean {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function headerValue(headers: Dispatcher.ResponseData["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code)
  );
}

async function discardBody(response: Dispatcher.ResponseData, signal: AbortSignal): Promise<void> {
  try {
    await response.body.dump();
    if (signal.aborted) throw timeoutError();
  } catch (error) {
    if (error instanceof InputError) throw error;
    if (isTimeout(error) || signal.aborted) {
      throw new InputError("URL_TIMEOUT", "URL request timed out");
    }
    throw new InputError("URL_BLOCKED", "URL response could not be read safely");
  }
}

export class SafeHttpFetcher {
  async fetch(initialUrl: string, options: PublicFetchOptions): Promise<PublicFetchResult> {
    let current = validateHttpUrl(initialUrl);
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), options.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal;
    const dispatcher = createDispatcher(signal);

    try {
      for (let redirectCount = 0; redirectCount <= options.maxRedirects; redirectCount += 1) {
        await resolvePublic(current.hostname, signal);
        let response: Dispatcher.ResponseData;
        try {
          response = await request(current, {
            dispatcher,
            method: "GET",
            headers: {
              accept: "*/*",
              "user-agent": "ContentOS-InputFetcher/1.0",
              ...options.headers,
            },
            signal,
          });
        } catch (error) {
          if (error instanceof InputError) throw error;
          if (isTimeout(error)) throw new InputError("URL_TIMEOUT", "URL request timed out");
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          if (message.includes("blocked address")) {
            throw new InputError("URL_BLOCKED", "URL resolves to a non-public address");
          }
          throw new InputError("URL_BLOCKED", "URL could not be fetched safely");
        }

        if (isRedirect(response.statusCode)) {
          const location = headerValue(response.headers, "location");
          await discardBody(response, signal);
          if (!location || redirectCount === options.maxRedirects) {
            throw new InputError("URL_BLOCKED", "URL redirected too many times or omitted a location");
          }
          try {
            current = validateHttpUrl(new URL(location, current).href);
          } catch (error) {
            if (error instanceof InputError) throw error;
            throw new InputError("URL_BLOCKED", "URL redirected to an invalid address");
          }
          continue;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          await discardBody(response, signal);
          throw new InputError("URL_BLOCKED", `URL returned HTTP ${response.statusCode}`);
        }
        const declaredLength = Number(headerValue(response.headers, "content-length") ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
          await discardBody(response, signal);
          throw new InputError("URL_TOO_LARGE", "URL response exceeds the size limit");
        }

        let body = new Uint8Array(Math.min(options.maxBytes, 64 * 1024));
        let size = 0;
        try {
          for await (const chunk of response.body) {
            const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
            const required = size + bytes.byteLength;
            if (required > options.maxBytes) {
              response.body.destroy();
              throw new InputError("URL_TOO_LARGE", "URL response exceeds the size limit");
            }
            if (required > body.length) {
              const next = new Uint8Array(Math.min(options.maxBytes, Math.max(required, body.length * 2)));
              next.set(body.subarray(0, size));
              body = next;
            }
            body.set(bytes, size);
            size = required;
          }
          if (signal.aborted) throw timeoutError();
        } catch (error) {
          if (error instanceof InputError) throw error;
          if (isTimeout(error)) throw new InputError("URL_TIMEOUT", "URL request timed out");
          throw new InputError("URL_BLOCKED", "URL response could not be read safely");
        }

        body = size === body.length ? body : body.slice(0, size);
        return {
          url: current.href,
          statusCode: response.statusCode,
          contentType: headerValue(response.headers, "content-type")?.split(";", 1)[0]?.trim() ?? null,
          body,
        };
      }
      throw new InputError("URL_BLOCKED", "URL redirected too many times");
    } finally {
      clearTimeout(timer);
      await dispatcher.close();
    }
  }
}
