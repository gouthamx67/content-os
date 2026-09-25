import type { InputBundle } from "./input";
import type { Source } from "./source";

export function createInputBundle(projectId: string, sources: readonly Source[]): InputBundle {
  if (sources.some((source) => source.projectId !== projectId)) {
    throw new Error("Input bundle contains a source from another project");
  }

  const versions = new Map<string, string[]>();
  const unversioned: Source[] = [];
  for (const source of sources) {
    if (source.status === "READY" && source.contentHash) {
      const sourceIds = versions.get(source.contentHash) ?? [];
      sourceIds.push(source.id);
      versions.set(source.contentHash, sourceIds);
    } else {
      unversioned.push(source);
    }
  }

  return {
    projectId,
    inputs: [...sources],
    versions: [...versions].map(([contentHash, sourceIds]) => ({ contentHash, sourceIds })),
    unversioned,
  };
}
