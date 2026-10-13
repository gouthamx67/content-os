import {
  PLATFORMS,
  getPlatform,
  isKnownPlatform,
  type PlatformDefinition,
} from "../../../core/domain/platform";
import {
  CONTENT_CHANNELS,
  contentTypesForChannel,
  getContentType,
  type ContentChannel,
  type ContentTypeDefinition,
} from "../../../core/domain/content-type";
import type { CampaignErrorCode } from "../errors";
import { CampaignError } from "../errors";

export type ResolvedFormat = {
  channel: ContentChannel;
  platformId: string;
  platformName: string;
  contentTypeId: string;
  contentTypeName: string;
};

export type ResolveFormatInput = {
  platformId?: string | null;
  channel?: string | null;
  contentTypeId?: string | null;
  /**
   * Platform ids the project declared through its content intents. An empty list
   * means the project never wrote a plan down; for those, registry support is
   * the whole test, because refusing everything would be a rule the user cannot
   * see and cannot satisfy.
   */
  projectPlatforms: readonly string[];
};

function isContentChannel(value: string): value is ContentChannel {
  return (CONTENT_CHANNELS as readonly string[]).includes(value);
}

export function throwFormatError(
  code: CampaignErrorCode,
  message: string,
): never {
  throw new CampaignError(code, message);
}

/**
 * Resolves a deliverable's format from whatever the caller supplied.
 *
 * The order of checks is chosen to produce the most useful message: the platform
 * has to exist, it has to be one this project plans around, it has to carry the
 * channel, and the content type has to belong to that platform. Everything the
 * planner and the deliverable routes decide about format goes through here, so
 * "a TikTok video" and "a video for TikTok" cannot resolve differently.
 */
export function resolveFormat(input: ResolveFormatInput): ResolvedFormat {
  const platformId = input.platformId?.trim() || null;
  if (!platformId) {
    throwFormatError("CAMPAIGN_PLATFORM_UNKNOWN", "A platform is required");
  }

  const platform: PlatformDefinition | null = getPlatform(platformId);
  if (!platform) {
    throwFormatError("CAMPAIGN_PLATFORM_UNKNOWN", `Unknown platform: ${platformId}`);
  }

  if (
    input.projectPlatforms.length > 0 &&
    !input.projectPlatforms.includes(platform.id)
  ) {
    throwFormatError(
      "CAMPAIGN_PLATFORM_NOT_IN_PROJECT",
      `${platform.name} is not one of this project's platforms`,
    );
  }

  const requestedChannel =
    input.channel && isContentChannel(input.channel) ? input.channel : null;

  if (input.channel && !requestedChannel) {
    throwFormatError(
      "CAMPAIGN_CHANNEL_UNSUPPORTED",
      `Unknown content channel: ${String(input.channel)}`,
    );
  }

  const requestedTypeId = input.contentTypeId?.trim() || null;
  const contentType = requestedTypeId ? getContentType(requestedTypeId) : null;

  if (requestedTypeId && !contentType) {
    throwFormatError(
      "CAMPAIGN_CONTENT_TYPE_MISMATCH",
      `Unknown content type: ${requestedTypeId}`,
    );
  }

  const channel: ContentChannel | null =
    contentType?.channel ?? requestedChannel ?? null;

  if (!channel) {
    throwFormatError(
      "CAMPAIGN_CHANNEL_UNSUPPORTED",
      "A channel or content type is required",
    );
  }

  if (!platform.channels.includes(channel)) {
    throwFormatError(
      "CAMPAIGN_CHANNEL_UNSUPPORTED",
      `${platform.name} does not carry ${channel.toLowerCase()} content`,
    );
  }

  if (contentType) {
    if (contentType.channel !== channel) {
      throwFormatError(
        "CAMPAIGN_CONTENT_TYPE_MISMATCH",
        `${contentType.name} is ${contentType.channel.toLowerCase()} content`,
      );
    }
    if (!contentType.supportedPlatforms.includes(platform.id)) {
      throwFormatError(
        "CAMPAIGN_CONTENT_TYPE_MISMATCH",
        `${contentType.name} cannot be published to ${platform.name}`,
      );
    }

    return {
      channel,
      platformId: platform.id,
      platformName: platform.name,
      contentTypeId: contentType.id,
      contentTypeName: contentType.name,
    };
  }

  const fallback = defaultContentType(channel, platform.id);
  if (!fallback) {
    throwFormatError(
      "CAMPAIGN_CONTENT_TYPE_MISMATCH",
      `No ${channel.toLowerCase()} content type is available for ${platform.name}`,
    );
  }

  return {
    channel,
    platformId: platform.id,
    platformName: platform.name,
    contentTypeId: fallback.id,
    contentTypeName: fallback.name,
  };
}

function defaultContentType(
  channel: ContentChannel,
  platformId: string,
): ContentTypeDefinition | null {
  const candidates = contentTypesForChannel(channel).filter((type) =>
    type.supportedPlatforms.includes(platformId),
  );
  return candidates[0] ?? null;
}

export function platformDisplayName(platformId: string): string {
  return isKnownPlatform(platformId)
    ? (getPlatform(platformId)?.name ?? platformId)
    : platformId;
}

export function isResolvablePlatform(
  platformId: string,
  projectPlatforms: readonly string[],
): boolean {
  if (!isKnownPlatform(platformId)) return false;
  if (projectPlatforms.length === 0) return true;
  return projectPlatforms.includes(platformId);
}

/**
 * The platform ids a plan can legitimately commit to: the project's declared
 * platforms when it has any, otherwise every registered platform.
 */
export function allowedPlatforms(
  projectPlatforms: readonly string[],
): string[] {
  if (projectPlatforms.length === 0) {
    return PLATFORMS.map((platform) => platform.id);
  }
  return [...projectPlatforms].filter((id) => isKnownPlatform(id));
}
