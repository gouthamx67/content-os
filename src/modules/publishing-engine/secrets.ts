import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * The only place provider credentials exist in plaintext.
 *
 * Tokens are sealed with AES-256-GCM under `PUBLISHING_SECRET_KEY` (base64 of
 * exactly 32 bytes) before they touch a database column, and the sealed value
 * carries its version so a future format can be introduced without ambiguity.
 * Opening a tampered envelope throws instead of returning bytes.
 */
export class SecretsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsUnavailableError";
  }
}

const ENVELOPE_VERSION = "v1";

export class PublishingSecretBox {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new SecretsUnavailableError(
        "Publishing secret key must be exactly 32 bytes",
      );
    }
    this.key = key;
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      ENVELOPE_VERSION,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  open(envelope: string): string {
    const parts = envelope.split(".");
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
      throw new SecretsUnavailableError("Malformed credential envelope");
    }
    try {
      const iv = Buffer.from(parts[1]!, "base64url");
      const tag = Buffer.from(parts[2]!, "base64url");
      const ciphertext = Buffer.from(parts[3]!, "base64url");
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new SecretsUnavailableError(
        "Credential envelope failed authentication",
      );
    }
  }
}

/**
 * Signs the OAuth `state` cookie. The payload binds the nonce to the user,
 * project and provider that started the flow, so a callback from somewhere
 * else cannot attach an account to the wrong project.
 */
export class OAuthStateSigner {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new SecretsUnavailableError(
        "Publishing secret key must be exactly 32 bytes",
      );
    }
    this.key = key;
  }

  sign(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const mac = createHmac("sha256", this.key).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  verify(token: string): Record<string, unknown> | null {
    const separator = token.lastIndexOf(".");
    if (separator <= 0) return null;
    const body = token.slice(0, separator);
    const mac = token.slice(separator + 1);
    const expected = createHmac("sha256", this.key).update(body).digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(mac, "base64url");
    } catch {
      return null;
    }
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return null;
    }
    try {
      const payload: unknown = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      );
      if (typeof payload !== "object" || payload === null) return null;
      return payload as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export type PublishingCrypto = {
  box: PublishingSecretBox;
  stateSigner: OAuthStateSigner;
};

export type PublishingCryptoLoad = {
  crypto: PublishingCrypto | null;
  problem: string | null;
};

/**
 * Reads the key once at wiring time. A missing key leaves publishing
 * unavailable (routes report it) rather than crashing the whole server; a
 * present-but-invalid key reports exactly what is wrong.
 */
export function loadPublishingCrypto(
  env: Record<string, string | undefined> = process.env,
): PublishingCryptoLoad {
  const raw = env["PUBLISHING_SECRET_KEY"];
  if (!raw || raw.trim().length === 0) {
    return {
      crypto: null,
      problem: "PUBLISHING_SECRET_KEY is not configured",
    };
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    return {
      crypto: null,
      problem: "PUBLISHING_SECRET_KEY must be base64 of exactly 32 bytes",
    };
  }
  return {
    crypto: {
      box: new PublishingSecretBox(key),
      stateSigner: new OAuthStateSigner(key),
    },
    problem: null,
  };
}
