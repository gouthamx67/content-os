/**
 * Platforms are destinations, not creative choices. A content type says which
 * destinations it can be produced for; this registry says where those
 * destinations live and what they default to, so "a TikTok video" and "a video
 * for TikTok" resolve to the same place without a service hardcoding it.
 */

import type { ContentChannel } from "./content-type";

export type PlatformDefinition = {
  id: string;
  name: string;

  channels: ContentChannel[];

  defaultAspectRatio?: string;

  defaultLanguage?: string;
};

export const PLATFORMS: readonly PlatformDefinition[] = [
  {
    id: "youtube",
    name: "YouTube",
    channels: ["VIDEO", "IMAGE", "TEXT"],
    defaultAspectRatio: "16:9",
  },
  {
    id: "youtube_short",
    name: "YouTube Short",
    channels: ["VIDEO", "IMAGE", "TEXT"],
    defaultAspectRatio: "9:16",
  },
  {
    id: "tiktok",
    name: "TikTok",
    channels: ["VIDEO", "IMAGE", "TEXT"],
    defaultAspectRatio: "9:16",
  },
  {
    id: "instagram",
    name: "Instagram",
    channels: ["VIDEO", "IMAGE", "TEXT"],
    defaultAspectRatio: "4:5",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    channels: ["VIDEO", "IMAGE", "TEXT"],
    defaultAspectRatio: "1:1",
  },
  {
    id: "x",
    name: "X",
    channels: ["VIDEO", "IMAGE", "TEXT"],
    defaultAspectRatio: "16:9",
  },
  {
    id: "product_hunt",
    name: "Product Hunt",
    channels: ["VIDEO", "IMAGE", "TEXT", "CAMPAIGN"],
  },
  {
    id: "website",
    name: "Website",
    channels: ["VIDEO", "IMAGE", "TEXT"],
    defaultAspectRatio: "16:9",
  },
  {
    id: "email",
    name: "Email",
    channels: ["TEXT", "IMAGE", "CAMPAIGN"],
  },
  {
    id: "podcast",
    name: "Podcast",
    channels: ["AUDIO"],
  },
];

export function getPlatform(
  id: string,
): PlatformDefinition | null {
  return PLATFORMS.find((platform) => platform.id === id) ?? null;
}

export function isKnownPlatform(id: string): boolean {
  return PLATFORMS.some((platform) => platform.id === id);
}

/**
 * Platform ids that only ever appear as delivery surfaces of a content type
 * rather than as a destination a request can name.
 */
export const SHORT_FORM_VIDEO_PLATFORMS: readonly string[] = [
  "tiktok",
  "instagram",
  "youtube_short",
];

export const TEXT_FIRST_PLATFORMS: readonly string[] = [
  "linkedin",
  "x",
  "product_hunt",
];
