import { describe, expect, it } from "vitest";
import { hashWriting, sha256Hex } from "./hash-writing";

describe("writing hashing", () => {
  it("hashes a value independently of key order", () => {
    expect(hashWriting({ a: 1, b: { c: 2, d: 3 } })).toBe(
      hashWriting({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("changes when the value changes", () => {
    expect(hashWriting({ a: 1 })).not.toBe(hashWriting({ a: 2 }));
  });

  it("matches the known sha256 of a string", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
