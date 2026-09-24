import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

type ScryptOptions = {
  N?: number;
  r?: number;
  p?: number;
  maxmem?: number;
};

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options?: ScryptOptions,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

const COST = 16384;

const BLOCK_SIZE = 8;

const PARALLELIZATION = 1;

function scryptMaxMem(N: number, r: number, p: number): number {
  return 128 * N * r * p + 1024 * 1024;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(
  password: string,
): Promise<string> {
  const salt = randomBytes(16);

  const derived = (await scrypt(
    password,
    salt,
    KEY_LENGTH,
    {
      N: COST,
      r: BLOCK_SIZE,
      p: PARALLELIZATION,
      maxmem: scryptMaxMem(COST, BLOCK_SIZE, PARALLELIZATION),
    },
  )) as Buffer;

  return [
    "scrypt",
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELIZATION),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join(":");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, cost, blockSize, parallelization, salt, hash] =
    parts;

  const N = Number(cost);

  const r = Number(blockSize);

  const p = Number(parallelization);

  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N <= 0 ||
    r <= 0 ||
    p <= 0
  ) {
    return false;
  }

  const expected = Buffer.from(hash, "base64");

  const derived = (await scrypt(
    password,
    Buffer.from(salt, "base64"),
    expected.length,
    {
      N,
      r,
      p,
      maxmem: scryptMaxMem(N, r, p),
    },
  )) as Buffer;

  return (
    expected.length === derived.length &&
    timingSafeEqual(expected, derived)
  );
}