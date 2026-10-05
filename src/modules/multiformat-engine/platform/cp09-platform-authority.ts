import { getPlatform, isKnownPlatform } from "../../../core/domain/platform";
import type { ContentIntentRepository } from "../../../core/ports/content-intent-repository";
import type { ContentChannel } from "../../../core/domain/content-type";
import type { AdaptationKind } from "../domain/types";
import { AdaptationError } from "../errors";
import type { ResolvedPlatform } from "../limits";
import type { PlatformAuthority } from "./platform-authority";

/** Which CP09 channel a CP19 output has to travel on. */
const KIND_CHANNEL: Readonly<Record<AdaptationKind, ContentChannel>> = {
  COPY: "TEXT",
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
};

export type Cp09PlatformAuthorityDeps = {
  contentIntents: ContentIntentRepository;
};

/**
 * CP19's only route to platform knowledge is CP09's registry.
 *
 * Three checks, in the order that produces the most useful message: the platform
 * has to exist, it has to carry this kind of content, and it has to be one of
 * *this project's* platforms. The last check is the one that stops a destination
 * from another project's plan being applied here, and it reads the project's own
 * content intents rather than trusting the caller.
 *
 * A project that has never written an intent down has no declared platform set;
 * for those, registry support is the whole test, because refusing every
 * adaptation would be a rule the user cannot satisfy and cannot see.
 */
export class Cp09PlatformAuthority implements PlatformAuthority {
  private readonly contentIntents: ContentIntentRepository;

  constructor(deps: Cp09PlatformAuthorityDeps) {
    this.contentIntents = deps.contentIntents;
  }

  async assertSupported(args: {
    projectId: string;
    platformId: string;
    kind: AdaptationKind;
  }): Promise<ResolvedPlatform> {
    const platform = getPlatform(args.platformId);

    if (!platform) {
      throw new AdaptationError(
        "ADAPTATION_PLATFORM_UNKNOWN",
        `Unknown platform: ${args.platformId}`,
        422,
      );
    }

    const channel = KIND_CHANNEL[args.kind];
    if (!platform.channels.includes(channel)) {
      throw new AdaptationError(
        "ADAPTATION_PLATFORM_KIND_UNSUPPORTED",
        `${platform.name} does not carry ${channel.toLowerCase()} content`,
        422,
      );
    }

    const intents = await this.contentIntents.listForProject(args.projectId);
    if (intents.length > 0) {
      const declared = new Set(
        intents.flatMap((intent) => intent.platforms as readonly string[]),
      );
      if (!declared.has(platform.id)) {
        throw new AdaptationError(
          "ADAPTATION_PLATFORM_NOT_IN_PROJECT",
          `${platform.name} is not one of this project's platforms`,
          422,
        );
      }
    }

    return {
      id: platform.id,
      name: platform.name,
      channels: platform.channels,
      defaultAspectRatio: platform.defaultAspectRatio ?? null,
    };
  }

  displayName(platformId: string): string {
    return isKnownPlatform(platformId)
      ? (getPlatform(platformId)?.name ?? platformId)
      : platformId;
  }
}