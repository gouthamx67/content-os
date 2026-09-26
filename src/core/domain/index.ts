export * from "./project";
export * from "./content";
export * from "./generation";
export * from "./auth";
export * from "./workspace";
export * from "./input";
export * from "./intelligence";

/**
 * CP05 and CP06 both name an `Evidence` shape. The intelligence one wins the
 * unqualified name because it is the current domain; the earlier creative
 * evidence type stays reachable under an explicit alias.
 */
export type { Evidence } from "./intelligence";
export type { Evidence as ProjectEvidence } from "./project";
