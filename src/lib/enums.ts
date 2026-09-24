import type { AssetType } from "../core/domain/asset";
import type { SourceType } from "../core/domain/source";

export const SOURCE_TYPES: SourceType[] = [
  "WEBSITE",
  "WEB_APP",
  "GITHUB",
  "GITLAB",
  "LOCAL_PROJECT",
  "ZIP",
  "DOCUMENT",
  "PDF",
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "FIGMA",
  "TEXT",
  "OTHER",
];

export const ASSET_TYPES: AssetType[] = [
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "DOCUMENT",
  "LOGO",
  "SCREENSHOT",
  "UI_CAPTURE",
  "OTHER",
];

export function isSourceType(
  value: unknown,
): value is SourceType {
  return (
    typeof value === "string" &&
    SOURCE_TYPES.includes(value as SourceType)
  );
}

export function isAssetType(
  value: unknown,
): value is AssetType {
  return (
    typeof value === "string" &&
    ASSET_TYPES.includes(value as AssetType)
  );
}