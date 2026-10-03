import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalImageStorage } from "../storage/image-storage";
import { makeTempImageStorage } from "./helpers";

let storage: LocalImageStorage;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const temp = await makeTempImageStorage();
  storage = temp.storage;
  cleanup = temp.cleanup;
});

afterAll(async () => {
  await cleanup();
});

describe("LocalImageStorage", () => {
  it("puts real bytes and reads them back unchanged", async () => {
    const bytes = Buffer.from("real-png-bytes");
    const stored = await storage.putBytes("proj_1/job_1/output.png", bytes);

    expect(stored.storageKey).toBe("proj_1/job_1/output.png");
    expect(stored.byteSize).toBe(bytes.byteLength);
    expect(stored.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await storage.exists(stored.storageKey)).toBe(true);

    const readBack = await readFile(storage.absolutePath(stored.storageKey));
    expect(readBack.equals(bytes)).toBe(true);
  });

  it("reports a missing key rather than throwing", async () => {
    expect(await storage.exists("proj_1/nope.png")).toBe(false);
  });

  it("deletes an artifact", async () => {
    await storage.putBytes("proj_1/gone.png", Buffer.from("x"));
    expect(await storage.exists("proj_1/gone.png")).toBe(true);
    await storage.delete("proj_1/gone.png");
    expect(await storage.exists("proj_1/gone.png")).toBe(false);
  });

  it("refuses a traversal key on write", async () => {
    await expect(
      storage.putBytes("../escape.png", Buffer.from("x")),
    ).rejects.toThrow(/Invalid image storage key/i);
  });

  it("refuses an absolute key on read", () => {
    expect(() => storage.read("/etc/passwd")).toThrow(
      /Invalid image storage key/i,
    );
  });

  it("refuses a backslash key", async () => {
    await expect(
      storage.putBytes("proj_1\\escape.png", Buffer.from("x")),
    ).rejects.toThrow(/Invalid image storage key/i);
  });
});
