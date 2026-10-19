import { describe, expect, it } from "vitest";
import {
  HttpError,
  isSameOrigin,
  parseJsonBody,
  wrapHttpError,
} from "./http";

describe("isSameOrigin", () => {
  it("allows a request without an Origin header (same-origin navigation, curl)", () => {
    expect(isSameOrigin(new Request("https://app.example.com/api/x"))).toBe(true);
  });

  it("allows a matching Origin", () => {
    const request = new Request("https://app.example.com/api/x", {
      headers: { origin: "https://app.example.com" },
    });
    expect(isSameOrigin(request)).toBe(true);
  });

  it("rejects a different Origin", () => {
    const request = new Request("https://app.example.com/api/x", {
      headers: { origin: "https://evil.example.com" },
    });
    expect(isSameOrigin(request)).toBe(false);
  });

  it("rejects a scheme mismatch", () => {
    const request = new Request("https://app.example.com/api/x", {
      headers: { origin: "http://app.example.com" },
    });
    expect(isSameOrigin(request)).toBe(false);
  });
});

describe("parseJsonBody", () => {
  it("parses an object body", async () => {
    const request = new Request("http://localhost/api/x", {
      method: "POST",
      body: JSON.stringify({ name: "value" }),
    });
    await expect(parseJsonBody(request)).resolves.toEqual({ name: "value" });
  });

  it("returns null for malformed JSON", async () => {
    const request = new Request("http://localhost/api/x", {
      method: "POST",
      body: "{not json",
    });
    await expect(parseJsonBody(request)).resolves.toBeNull();
  });

  it("returns null for a non-object body", async () => {
    const request = new Request("http://localhost/api/x", {
      method: "POST",
      body: "[1,2,3]",
    });
    await expect(parseJsonBody(request)).resolves.toBeNull();
  });

  it("refuses a declared oversized body without reading it", async () => {
    const request = new Request("http://localhost/api/x", {
      method: "POST",
      headers: { "content-length": String(7 * 1024 * 1024) },
      body: "{}",
    });
    await expect(parseJsonBody(request)).resolves.toBeNull();
  });
});

describe("wrapHttpError", () => {
  it("preserves an HttpError status and message", () => {
    const response = wrapHttpError(new HttpError(403, "Cross-origin request"));
    expect(response.status).toBe(403);
  });

  it("masks an unexpected error as a generic 500", async () => {
    const response = wrapHttpError(new Error("internal driver detail"));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).not.toContain("driver");
  });
});
