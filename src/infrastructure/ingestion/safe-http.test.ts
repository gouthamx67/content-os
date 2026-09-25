import { describe, expect, it } from "vitest";
import { isBlockedIpAddress, validateHttpUrl } from "./safe-http";

describe("URL security", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "192.88.99.1",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2001:30::1",
    "3fff::1",
    "5f00::1",
    "::ffff:127.0.0.1",
    "0:0:0:0:0:ffff:7f00:1",
  ])("blocks non-public address %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])("allows public address %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(false);
  });

  it.each([
    "file:///etc/passwd",
    "ftp://example.com/file",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "https://localhost/",
    "https://service.local/",
    "https://127.0.0.1/",
    "https://[::1]/",
  ])("rejects unsafe URL %s", (value) => {
    expect(() => validateHttpUrl(value)).toThrowError(
      expect.objectContaining({ code: "URL_BLOCKED" }),
    );
  });

  it("accepts credential-free public HTTP URLs", () => {
    expect(validateHttpUrl("https://example.com/path?q=1").href).toBe("https://example.com/path?q=1");
    expect(() => validateHttpUrl("https://user:pass@example.com/")).toThrowError(
      expect.objectContaining({ code: "URL_BLOCKED" }),
    );
  });
});
