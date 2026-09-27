import { brandEvidenceKey } from "../../lib/brand-normalization";
import type { BrandAssetRole } from "../../core/domain/brand";
import type {
  BrandAnalyzerInput,
  BrandAnalyzerResult,
  BrandEvidenceDraft,
} from "../../core/ports/brand-analyzer";
import { emptyBrandAnalyzerResult } from "../../core/ports/brand-analyzer";
import type { Asset } from "../../core/domain/asset";

const MAX_ASSETS = 12;

const CREATIVE_SOURCE_TYPES = ["IMAGE", "VIDEO", "AUDIO", "FIGMA"];

/**
 * Ordered most specific to least specific. A file named `logo-primary-dark.svg`
 * is a primary logo because of the tokens in that order, not because of where
 * it appeared in the asset list.
 */
const ASSET_ROLE_HINTS: { role: BrandAssetRole; test: RegExp; label: string }[] = [
  {
    role: "PRIMARY_LOGO",
    test: /(?:^|[-_.\s])(?:primary|main|full|horizontal)(?:[-_.\s]|$)/,
    label: "Primary logo",
  },
  { role: "WORDMARK", test: /wordmark|word-?mark|logotype/i, label: "Wordmark" },
  { role: "MARK", test: /(?:^|[-_.\s])(?:mark|symbol|glyph|monogram)(?:[-_.\s]|$)/i, label: "Mark" },
  { role: "FAVICON", test: /favicon|apple-touch-icon|icon[-_.\s]?(?:16|32|48|180)/i, label: "Favicon" },
  { role: "ICON", test: /icon/i, label: "Icon" },
  { role: "LOGO", test: /logo/i, label: "Logo" },
  { role: "PATTERN", test: /pattern/i, label: "Pattern" },
  { role: "TEXTURE", test: /texture|noise|grain/i, label: "Texture" },
  { role: "ILLUSTRATION", test: /illustrat/i, label: "Illustration" },
  { role: "PHOTOGRAPHY_STYLE", test: /photo|photograph|imagery|lifestyle/i, label: "Photography reference" },
];

export class CreativeBrandAnalyzer {
  readonly id = "brand-creative";

  supports(input: BrandAnalyzerInput): boolean {
    if (input.source) {
      return CREATIVE_SOURCE_TYPES.includes(input.source.type);
    }
    return input.existingAssets.length > 0;
  }

  async analyze(input: BrandAnalyzerInput): Promise<BrandAnalyzerResult> {
    const result = emptyBrandAnalyzerResult();
    const evidence: BrandEvidenceDraft[] = [];
    const anchorId = input.source?.id ?? null;

    for (const asset of input.existingAssets.slice(0, MAX_ASSETS)) {
      const classified = this.classify(asset);
      if (!classified) continue;
      const locator = `asset:${asset.id}`;
      const evidenceKeys: string[] = [];
      if (anchorId) {
        const key = brandEvidenceKey(anchorId, "IMAGE_REGION", locator);
        evidence.push({
          key,
          sourceId: anchorId,
          kind: "IMAGE_REGION",
          locator,
          excerpt: `asset ${asset.name} (${asset.type})`,
          metadata: { assetId: asset.id, assetType: asset.type },
        });
        evidenceKeys.push(key);
      }
      result.assets.push({
        assetId: asset.id,
        role: classified.role,
        label: classified.label,
        confidence: classified.confidence,
        origin: "EXTRACTED",
        basis: "RECOGNIZED_ASSET",
        evidenceKeys,
        notes: anchorId
          ? `Classified from asset name and type ${asset.type}`
          : `Classified from asset name and type ${asset.type}; no source owns this asset so the classification carries no evidence reference`,
      });
    }

    if (input.source) {
      result.notes.push(
        `Creative source ${input.source.type} contributes context; pixel-level visual classification stays out of deterministic analysis`,
      );
    }

    if (result.assets.length === 0) {
      result.notes.push("No uploaded asset was classified as a brand asset");
    }

    result.evidence = evidence;
    return result;
  }

  private classify(asset: Asset): {
    role: BrandAssetRole;
    label: string;
    confidence: "HIGH" | "MEDIUM";
  } | null {
    const hint = ASSET_ROLE_HINTS.find((entry) => entry.test.test(asset.name));
    if (asset.type === "LOGO") {
      return {
        role: hint?.role ?? "LOGO",
        label: hint?.label ?? "Logo",
        confidence: "HIGH",
      };
    }
    if (asset.type === "SCREENSHOT" || asset.type === "UI_CAPTURE") {
      return { role: "PHOTOGRAPHY_STYLE", label: "Product screenshot", confidence: "MEDIUM" };
    }
    if (!hint) return null;
    return { role: hint.role, label: hint.label, confidence: "MEDIUM" };
  }
}
