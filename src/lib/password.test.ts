import { describe, expect, it } from "vitest";
import {
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from "./password";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe(
      "user@example.com",
    );
  });
});

describe("hashPassword", () => {
  it("produces a hashed value that does not contain the password", async () => {
    const stored = await hashPassword("hunter2-secret");

    expect(stored).toContain("scrypt:");

    expect(stored).not.toContain("hunter2-secret");
  });

  it("salts, so the same password hashes differently", async () => {
    const first = await hashPassword("same-password");

    const second = await hashPassword("same-password");

    expect(first).not.toBe(second);
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    const stored = await hashPassword("correct-horse");

    await expect(
      verifyPassword("correct-horse", stored),
    ).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const stored = await hashPassword("correct-horse");

    await expect(
      verifyPassword("wrong-password", stored),
    ).resolves.toBe(false);
  });

  it("rejects a tampered stored hash", async () => {
    const stored = await hashPassword("correct-horse");

    const tampered = stored.replace(/scrypt:/, "scrypt:16386:");

    await expect(
      verifyPassword("correct-horse", tampered),
    ).resolves.toBe(false);
  });

  it("rejects a malformed stored value without throwing", async () => {
    await expect(
      verifyPassword("anything", "not-a-hash"),
    ).resolves.toBe(false);

    await expect(
      verifyPassword("anything", ""),
    ).resolves.toBe(false);
  });
});