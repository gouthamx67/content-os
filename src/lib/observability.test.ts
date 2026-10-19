import { describe, expect, it } from "vitest";
import {
  logEvent,
  redactSecrets,
  requestIdFrom,
  sanitizeError,
} from "./observability";

describe("redactSecrets", () => {
  it("redacts a bearer token", () => {
    expect(
      redactSecrets("Authorization: Bearer abc.def.ghi"),
    ).not.toContain("abc.def.ghi");
  });

  it("redacts key=value secrets regardless of case", () => {
    const redacted = redactSecrets("client_secret=super-secret-value");
    expect(redacted).not.toContain("super-secret-value");
    expect(redacted).toContain("[redacted]");
  });

  it("redacts a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactSecrets(`token ${jwt}`)).not.toContain(jwt);
  });

  it("redacts a long base64 blob", () => {
    const blob = Buffer.alloc(64).toString("base64");
    expect(redactSecrets(`value=${blob}`)).not.toContain(blob);
  });

  it("leaves an ordinary message untouched", () => {
    expect(redactSecrets("render job 42 failed")).toBe(
      "render job 42 failed",
    );
  });
});

describe("sanitizeError", () => {
  it("drops the stack and keeps a bounded message", () => {
    const error = new Error("x".repeat(2000));
    const sanitized = sanitizeError(error);
    expect(sanitized.name).toBe("Error");
    expect(sanitized.message.length).toBeLessThanOrEqual(500);
    expect(sanitized).not.toHaveProperty("stack");
  });

  it("carries a string code through", () => {
    const error = Object.assign(new Error("boom"), { code: "WORKER_LEASE_EXPIRED" });
    expect(sanitizeError(error).code).toBe("WORKER_LEASE_EXPIRED");
  });

  it("names a non-Error value UnknownError", () => {
    expect(sanitizeError("just a string").name).toBe("UnknownError");
  });
});

describe("logEvent", () => {
  it("writes one redacted JSON line to the matching console channel", () => {
    const captured: string[] = [];
    const original = console.error;
    console.error = (line: string) => {
      captured.push(line);
    };
    try {
      logEvent("error", "worker.crash", {
        token: "Bearer abc.def.ghi",
        jobId: "job_1",
      });
    } finally {
      console.error = original;
    }

    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]!) as Record<string, unknown>;
    expect(parsed["level"]).toBe("error");
    expect(parsed["event"]).toBe("worker.crash");
    expect(parsed["jobId"]).toBe("job_1");
    expect(JSON.stringify(parsed)).not.toContain("abc.def.ghi");
  });
});

describe("requestIdFrom", () => {
  it("accepts a well-formed inbound id", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-request-id": "0123456789abcdef" },
    });
    expect(requestIdFrom(request)).toBe("0123456789abcdef");
  });

  it("generates one when the header is absent or malformed", () => {
    const none = new Request("http://localhost/");
    expect(requestIdFrom(none)).toMatch(/^req_/);

    const bad = new Request("http://localhost/", {
      headers: { "x-request-id": "bad id with spaces" },
    });
    expect(requestIdFrom(bad)).toMatch(/^req_/);
  });
});
