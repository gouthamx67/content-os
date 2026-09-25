import { describe, expect, it } from "vitest";
import * as yazl from "yazl";
import { validateZipArchive } from "./archive";

interface ZipEntry {
  path: string;
  content?: string;
  symlink?: boolean;
  preservePath?: boolean;
}

function createZip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    const replacements: Array<{ placeholder: string; path: string }> = [];

    for (const entry of entries) {
      const unsafe =
        !entry.preservePath &&
        entry.path !== "README.md" &&
        entry.path !== "src/index.ts" &&
        entry.path !== "one.txt" &&
        entry.path !== "link";
      const placeholder = unsafe ? "a".repeat(Buffer.byteLength(entry.path)) : entry.path;
      archive.addBuffer(Buffer.from(entry.content ?? ""), placeholder, {
        mode: entry.symlink ? 0o120777 : 0o100777,
      });
      if (placeholder !== entry.path) replacements.push({ placeholder, path: entry.path });
    }

    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => {
      const result = Buffer.concat(chunks);
      for (const replacement of replacements) {
        const placeholder = Buffer.from(replacement.placeholder);
        const path = Buffer.from(replacement.path);
        let offset = result.indexOf(placeholder);
        while (offset >= 0) {
          path.copy(result, offset);
          offset = result.indexOf(placeholder, offset + path.byteLength);
        }
      }
      resolve(new Uint8Array(result));
    });
    archive.end();
  });
}

describe("validateZipArchive", () => {
  it("inspects real ZIP entries without extracting them", async () => {
    const archive = await createZip([
      { path: "README.md", content: "# Demo" },
      { path: "src/index.ts", content: "export {};" },
    ]);

    const result = await validateZipArchive(archive, {
      maxArchiveBytes: 1024,
      maxEntryBytes: 1024,
      maxEntries: 10,
      maxExpandedBytes: 2048,
    });

    expect(result.entryCount).toBe(2);
    expect(result.expandedBytes).toBe(16);
    expect(result.files.map((file) => file.path)).toEqual(["README.md", "src/index.ts"]);
    expect(result.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
  });

  it.each([
    "../escape.txt",
    "/absolute.txt",
    "C:\\escape.txt",
    "safe/\0escape.txt",
    "safe%2F..%2Fescape.txt",
    "safe%5C..%5Cescape.txt",
    "safe%00escape.txt",
    "%2Fabsolute.txt",
    "C%3A/escape.txt",
  ])(
    "rejects unsafe archive path %s",
    async (path) => {
      const archive = await createZip([{ path, content: "escape" }]);

      await expect(
        validateZipArchive(archive, {
          maxArchiveBytes: 1024,
          maxEntryBytes: 1024,
          maxEntries: 10,
          maxExpandedBytes: 2048,
        }),
      ).rejects.toMatchObject({ code: "ARCHIVE_UNSAFE_PATH" });
    },
  );

  it.each([
    ["a/b", "a%2Fb"],
    ["file.txt", "file%2Etxt"],
  ])("rejects encoded duplicate paths %s and %s", async (first, second) => {
    const archive = await createZip([
      { path: first, content: "first", preservePath: true },
      { path: second, content: "second", preservePath: true },
    ]);

    await expect(
      validateZipArchive(archive, {
        maxArchiveBytes: 1024,
        maxEntryBytes: 1024,
        maxEntries: 10,
        maxExpandedBytes: 2048,
      }),
    ).rejects.toMatchObject({ code: "ARCHIVE_UNSAFE_PATH" });
  });

  it("rejects symbolic links", async () => {
    const archive = await createZip([{ path: "link", symlink: true }]);

    await expect(
      validateZipArchive(archive, {
        maxArchiveBytes: 1024,
        maxEntryBytes: 1024,
        maxEntries: 10,
        maxExpandedBytes: 2048,
      }),
    ).rejects.toMatchObject({ code: "ARCHIVE_UNSAFE_PATH" });
  });

  it.each([
    [{ maxEntries: 0 }, "ARCHIVE_TOO_LARGE"],
    [{ maxEntryBytes: 2 }, "ARCHIVE_TOO_LARGE"],
    [{ maxExpandedBytes: 2 }, "ARCHIVE_TOO_LARGE"],
    [{ maxArchiveBytes: 2 }, "ARCHIVE_TOO_LARGE"],
  ] as const)("enforces archive limits %#", async (override, code) => {
    const archive = await createZip([{ path: "one.txt", content: "one" }]);

    await expect(
      validateZipArchive(archive, {
        maxArchiveBytes: 1024,
        maxEntryBytes: 1024,
        maxEntries: 10,
        maxExpandedBytes: 2048,
        ...override,
      }),
    ).rejects.toMatchObject({ code });
  });

  it("rejects malformed archives", async () => {
    await expect(
      validateZipArchive(new Uint8Array([1, 2, 3, 4]), {
        maxArchiveBytes: 1024,
        maxEntryBytes: 1024,
        maxEntries: 10,
        maxExpandedBytes: 2048,
      }),
    ).rejects.toMatchObject({ code: "ARCHIVE_INVALID" });
  });
});
