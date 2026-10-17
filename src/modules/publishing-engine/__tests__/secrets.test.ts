import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  OAuthStateSigner,
  PublishingSecretBox,
  SecretsUnavailableError,
  loadPublishingCrypto,
} from "../secrets";

function key(): Buffer {
  return Buffer.alloc(32, 9);
}

describe("PublishingSecretBox", () => {
  it("round-trips a token through the v1 envelope", () => {
    const box = new PublishingSecretBox(key());
    const sealed = box.seal("access-token-123");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("access-token-123");
    expect(box.open(sealed)).toBe("access-token-123");
  });

  it("produces a different ciphertext for the same plaintext", () => {
    const box = new PublishingSecretBox(key());
    expect(box.seal("token")).not.toBe(box.seal("token"));
  });

  it("rejects a tampered envelope instead of returning bytes", () => {
    const box = new PublishingSecretBox(key());
    const sealed = box.seal("token");
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] = flipped[0]! ^ 0xff;
    parts[3] = flipped.toString("base64url");
    expect(() => box.open(parts.join("."))).toThrow(SecretsUnavailableError);
  });

  it("rejects a malformed or unknown-version envelope", () => {
    const box = new PublishingSecretBox(key());
    expect(() => box.open("v2.a.b.c")).toThrow(SecretsUnavailableError);
    expect(() => box.open("nonsense")).toThrow(SecretsUnavailableError);
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => new PublishingSecretBox(randomBytes(16))).toThrow(
      SecretsUnavailableError,
    );
  });
});

describe("OAuthStateSigner", () => {
  it("verifies a signed payload", () => {
    const signer = new OAuthStateSigner(key());
    const token = signer.sign({ nonce: "abc", projectId: "p1", userId: "u1" });
    expect(signer.verify(token)).toMatchObject({ nonce: "abc", projectId: "p1" });
  });

  it("rejects payloads signed with a different key or tampered with", () => {
    const signer = new OAuthStateSigner(key());
    const other = new OAuthStateSigner(Buffer.alloc(32, 8));
    const token = signer.sign({ projectId: "p1" });
    expect(other.verify(token)).toBeNull();

    const [body, mac] = token.split(".");
    const tampered = `${body}.${mac!.slice(0, -1)}x`;
    expect(signer.verify(tampered)).toBeNull();
    expect(signer.verify("no-separator")).toBeNull();
  });
});

describe("loadPublishingCrypto", () => {
  it("reports a missing key as unavailable without throwing", () => {
    const load = loadPublishingCrypto({});
    expect(load.crypto).toBeNull();
    expect(load.problem).toContain("PUBLISHING_SECRET_KEY");
  });

  it("reports a present-but-wrong-length key with the exact problem", () => {
    const load = loadPublishingCrypto({
      PUBLISHING_SECRET_KEY: Buffer.alloc(16, 1).toString("base64"),
    });
    expect(load.crypto).toBeNull();
    expect(load.problem).toContain("32 bytes");
  });

  it("returns a working box and signer for a valid key", () => {
    const load = loadPublishingCrypto({
      PUBLISHING_SECRET_KEY: key().toString("base64"),
    });
    expect(load.problem).toBeNull();
    const sealed = load.crypto!.box.seal("hello");
    expect(load.crypto!.box.open(sealed)).toBe("hello");
    const token = load.crypto!.stateSigner.sign({ a: 1 });
    expect(load.crypto!.stateSigner.verify(token)).toEqual({ a: 1 });
  });
});
