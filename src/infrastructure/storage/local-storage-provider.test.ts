import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "./local-storage-provider";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "content-os-storage-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("LocalStorageProvider", () => {
  it("stores bytes atomically under a deterministic key", async () => {
    const root = await temporaryDirectory();
    const storage = new LocalStorageProvider(root);
    const key = "projects/project-1/inputs/hash/original";

    const stored = await storage.put(key, new TextEncoder().encode("first"), "text/plain");
    await storage.put(key, new TextEncoder().encode("second"), "text/plain");

    expect(stored.key).toBe(key);
    expect(stored.uri).toBe(`content-os-storage://local/${key}`);
    expect(stored.size).toBe(5);
    expect(await readFile(join(root, key), "utf8")).toBe("second");
    expect(await storage.getUrl(key)).toBe(stored.uri);
  });

  it.each(["../escape", "/absolute", "safe/../../escape", "C:\\escape", "safe/\0escape", ""])(
    "rejects unsafe storage key %s",
    async (key) => {
      const storage = new LocalStorageProvider(await temporaryDirectory());
      await expect(storage.put(key, new Uint8Array([1]))).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    },
  );

  it("rejects a path whose parent is a symbolic link", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await symlink(outside, join(root, "escape"), "dir");
    const storage = new LocalStorageProvider(root);

    await expect(storage.put("escape/file.txt", new Uint8Array([1]))).rejects.toMatchObject({
      code: "STORAGE_FAILED",
    });
  });

  it("deletes missing objects idempotently", async () => {
    const storage = new LocalStorageProvider(await temporaryDirectory());
    await expect(storage.delete("projects/missing/original")).resolves.toBeUndefined();
  });
});
