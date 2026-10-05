import type { AdaptationKind } from "../domain/types";
import type { ResolvedPlatform } from "../limits";

/**
 * CP19 asks CP09 whether a platform is real and whether it carries this kind of
 * content. It never answers that question itself: a second opinion about
 * platforms in this codebase would be a second source of truth.
 */
export interface PlatformAuthority {
  /**
   * Resolves a platform for one adaptation.
   *
   * Implementations reject an unknown platform, a platform that cannot carry this
   * kind of content, and a platform that is not part of this project's own
   * platform set — so a platform copied out of another project never becomes a
   * destination here.
   */
  assertSupported(args: {
    projectId: string;
    platformId: string;
    kind: AdaptationKind;
  }): Promise<ResolvedPlatform>;

  /** The display name CP09 owns, for the UI. */
  displayName(platformId: string): string;
}