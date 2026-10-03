import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artifactStorageKey, LocalRenderStorage } from "../render-storage";
import { RenderExecutionError } from "../../errors";

let root: string;
let storage: LocalRenderStorage;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cp15-storage-"));
  storage = new LocalRenderStorage(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalRenderStorage", () => {
  it("round-trips bytes and reports an accurate checksum", async () => {
    const stored = await storage.putBytes("project/job.mp4", Buffer.from("hello"));

    expect(stored.byteSize).toBe(5);
    expect(stored.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await storage.exists("project/job.mp4")).toBe(true);
    expect(await storage.exists("project/missing.mp4")).toBe(false);

    await storage.delete("project/job.mp4");
    expect(await storage.exists("project/job.mp4")).toBe(false);
  });

  it("rejects parent-directory traversal", async () => {
    await expect(
      storage.putBytes("../escape.mp4", Buffer.from("x")),
    ).rejects.toBeInstanceOf(RenderExecutionError);
  });

  it("rejects absolute paths", async () => {
    await expect(
      storage.putBytes("/tmp/escape.mp4", Buffer.from("x")),
    ).rejects.toBeInstanceOf(RenderExecutionError);
  });

  it("rejects backslashes and null bytes", async () => {
    await expect(
      storage.putBytes("a\\b.mp4", Buffer.from("x")),
    ).rejects.toBeInstanceOf(RenderExecutionError);
    await expect(
      storage.putBytes("a\0b.mp4", Buffer.from("x")),
    ).rejects.toBeInstanceOf(RenderExecutionError);
  });
});

describe("artifactStorageKey", () => {
  it("nests the artifact under a sanitized project id", () => {
    expect(artifactStorageKey("project_1", "render_2")).toBe(
      "project_1/render_2.mp4",
    );
  });

  it("neutralizes separators in ids", () => {
    expect(artifactStorageKey("p/1", "a/b")).toBe("p_1/a_b.mp4");
  });
});
