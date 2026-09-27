import { describe, expect, it } from "vitest";
import { BrowserError } from "../../core/domain/browser";
import {
  DEFAULT_BROWSER_NAVIGATION_POLICY,
  assertPublicResolution,
  checkBrowserUrl,
  hasAllowedUploadExtension,
  isAllowedUpload,
  isPubliclyRoutableUrl,
  type BrowserNavigationPolicy,
} from "./navigation-policy";

const publicPolicy: BrowserNavigationPolicy = { ...DEFAULT_BROWSER_NAVIGATION_POLICY, targetClass: "PUBLIC" };
const localPolicy: BrowserNavigationPolicy = { ...DEFAULT_BROWSER_NAVIGATION_POLICY, targetClass: "CONTROLLED_LOCAL" };

const blockedSchemes = [
  "file:///etc/passwd",
  "file:///root/.ssh/id_rsa",
  "javascript:alert(document.cookie)",
  "data:text/html,<h1>hi</h1>",
  "blob:https://example.com/abc",
  "about:blank",
  "chrome://settings",
  "view-source:https://example.com",
  "ws://example.com/socket",
  "ftp://example.com/file",
  "jar:http://example.com/a.jar!/b",
];

const blockedPrivateHosts = [
  "http://127.0.0.1:8080/admin",
  "http://127.0.0.1/",
  "https://localhost/admin",
  "http://[::1]:9000/",
  "http://10.0.0.5/internal",
  "http://172.16.4.4/",
  "http://192.168.1.1/router",
  "http://169.254.169.254/latest/meta-data/",
  "http://0.0.0.0/",
  "http://metadata.google.internal/computeMetadata/v1/",
  "http://service.internal/config",
  "http://printer.local/status",
  "http://box.lan/",
  "http://[fd00::1]/",
  "http://[fe80::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://2130706433/",
];

describe("browser navigation policy", () => {
  it("allows ordinary public http(s) destinations", () => {
    expect(checkBrowserUrl("https://example.com/docs", publicPolicy).host).toBe("example.com");
    expect(checkBrowserUrl("http://example.com", publicPolicy).url.protocol).toBe("http:");
    expect(isPubliclyRoutableUrl("https://news.ycombinator.com")).toBe(true);
  });

  it("blocks every non-HTTP scheme", () => {
    for (const url of blockedSchemes) {
      expect(() => checkBrowserUrl(url, publicPolicy), url).toThrow(BrowserError);
      expect(() => checkBrowserUrl(url, localPolicy), url).toThrow(BrowserError);
    }
  });

  it("blocks loopback, private, link-local and metadata addresses for public targets", () => {
    for (const url of blockedPrivateHosts) {
      expect(() => checkBrowserUrl(url, publicPolicy), url).toThrow(/non-public|internal hostname/);
    }
  });

  it("rejects embedded credentials", () => {
    expect(() => checkBrowserUrl("https://user:pass@example.com/", publicPolicy)).toThrow(/credentials/);
    expect(() => checkBrowserUrl("https://user@example.com/", publicPolicy)).toThrow(/credentials/);
  });

  it("permits loopback only for explicitly controlled local targets", () => {
    expect(checkBrowserUrl("http://127.0.0.1:4321/dashboard", localPolicy).isLoopback).toBe(true);
    expect(checkBrowserUrl("http://localhost:4321/", localPolicy).isLoopback).toBe(true);
    expect(checkBrowserUrl("http://[::1]:4321/", localPolicy).isLoopback).toBe(true);
    expect(isPubliclyRoutableUrl("http://127.0.0.1:4321/")).toBe(false);
  });

  it("still refuses non-loopback hosts for controlled local targets", () => {
    for (const url of [
      "http://10.0.0.5/",
      "http://192.168.0.10/",
      "http://169.254.169.254/",
      "https://example.com/",
    ]) {
      expect(() => checkBrowserUrl(url, localPolicy), url).toThrow(/loopback|non-public|internal/);
    }
  });

  it("normalizes trailing dots and case when matching hostnames", () => {
    expect(() => checkBrowserUrl("http://LOCALHOST./", publicPolicy)).toThrow();
    expect(() => checkBrowserUrl("http://Printer.Local./", publicPolicy)).toThrow();
  });

  it("rejects malformed and oversized URLs", () => {
    expect(() => checkBrowserUrl("not a url", publicPolicy)).toThrow();
    expect(() => checkBrowserUrl(`https://example.com/${"a".repeat(3000)}`, publicPolicy)).toThrow(/length/);
  });

  it("refuses public hostnames that resolve into private space", async () => {
    await expect(assertPublicResolution("localhost", publicPolicy)).rejects.toThrow(BrowserError);
    await expect(assertPublicResolution("nonexistent-host-for-tests.invalid", publicPolicy)).rejects.toThrow(
      /could not be resolved/,
    );
  });

  it("skips DNS enforcement for controlled local targets", async () => {
    await expect(assertPublicResolution("localhost", localPolicy)).resolves.toBeUndefined();
  });
});

describe("upload policy", () => {
  it("accepts safe types within the size limit", () => {
    expect(isAllowedUpload("image/png", 1_024, 10_000)).toBe(true);
    expect(isAllowedUpload("application/pdf", 9_999, 10_000)).toBe(true);
    expect(isAllowedUpload("text/plain; charset=utf-8", 10, 10_000)).toBe(true);
  });

  it("rejects executables, scripts and oversized files", () => {
    expect(isAllowedUpload("application/x-msdownload", 10, 10_000)).toBe(false);
    expect(isAllowedUpload("application/x-sh", 10, 10_000)).toBe(false);
    expect(isAllowedUpload("image/png", 10_001, 10_000)).toBe(false);
    expect(isAllowedUpload("image/png", 0, 10_000)).toBe(false);
  });

  it("enforces an extension allowlist", () => {
    for (const name of ["logo.png", "notes.txt", "data.json", "report.pdf"]) {
      expect(hasAllowedUploadExtension(name), name).toBe(true);
    }
    for (const name of ["payload.exe", "run.sh", "payload.js", "noextension", "archive.zip"]) {
      expect(hasAllowedUploadExtension(name), name).toBe(false);
    }
  });
});
