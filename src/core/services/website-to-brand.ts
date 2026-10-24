import {
  PlaywrightWebsiteRenderer,
  type RenderedWebsite,
} from "@/infrastructure/ingestion/website-renderer";
import { WebsiteBrandAnalyzer } from "@/infrastructure/brand/website-brand-analyzer";
import type {
  BrandAnalyzerInput,
  BrandAnalyzerResult,
} from "@/core/ports/brand-analyzer";

/** Options for fetching + analyzing a website */
export interface WebsiteToBrandOptions {
  renderTimeoutMs?: number;
  maxBytes?: number;
}

/** Simplified brand profile for video generation */
export interface WebsiteBrandProfile {
  primaryColor: string;
  secondaryColor: string | null;
  textColor: string;
  fontFamily: string;
  tone: "casual" | "corporate" | "playful" | "minimal" | "unknown";
  hasLogo: boolean;
}

/** Fetch a website and extract simplified brand profile */
export async function fetchWebsiteBrandProfile(
  url: string,
  options: WebsiteToBrandOptions = {}
): Promise<{
  profile: WebsiteBrandProfile | null;
  error?: string;
}> {
  try {
    const renderer = new PlaywrightWebsiteRenderer();
    const rendered: RenderedWebsite | null = await renderer.render(url, {
      timeoutMs: options.renderTimeoutMs ?? 30_000,
      maxBytes: options.maxBytes ?? 1_000_000,
    });

    if (!rendered) {
      return { profile: null, error: "Failed to render website" };
    }

    const analyzer = new WebsiteBrandAnalyzer();
    const input: BrandAnalyzerInput = {
      projectId: "",
      source: {
        id: "",
        type: "WEBSITE",
        name: url,
        metadata: null,
        uri: null,
        mimeType: null,
        sizeBytes: null,
        status: "READY",
        contentHash: null,
        errorCode: null,
        errorMessage: null,
        storageKey: null,
        metadata: null,
        updatedAt: null,
        createdAt: null,
      },
      bytes: null,
      text: null,
      html: rendered.html,
      existingAssetIds: [],
      existingAssets: [],
      signal: undefined,
    };

    const result = await analyzer.analyze(input);

    // Extract colors from analysis results
    const primaryColor = result.colors.length > 0
      ? result.colors[0].hex
      : "#1a1a2e";
    const secondaryColor = result.colors.length > 1
      ? result.colors[1].hex
      : null;

    // Extract text color from colors or use a contrasting default
    const textColorCandidates = result.colors
      .filter((c) => c.role === "TEXT")
      .map((c) => c.hex);
    const textColor = textColorCandidates.length > 0
      ? textColorCandidates[0]
      : "#ffffff";

    // Extract font family from analysis results
    const fontFamily = result.fonts.length > 0
      ? result.fonts[0].family
      : "system-ui";

    // Extract tone from voice signals, mapping to known tones
    let tone: "casual" | "corporate" | "playful" | "minimal" | "unknown" = "unknown";
    if (result.voiceSignals.length > 0) {
      const kind = result.voiceSignals[0].kind;
      // Map voice tone kinds to brand tone values
      const toneMap: Record<string, "casual" | "corporate" | "playful" | "minimal" | "unknown"> = {
        confident: "corporate",
        assertive: "corporate",
        bold: "corporate",
        decisive: "corporate",
        unapologetic: "corporate",
        authoritative: "corporate",
        commanding: "corporate",
        friendly: "casual",
        warm: "casual",
        welcoming: "casual",
        approachable: "casual",
        caring: "casual",
        human: "casual",
        empathetic: "casual",
        playful: "playful",
        witty: "playful",
        humorous: "playful",
        cheeky: "playful",
        clever: "playful",
        professional: "corporate",
        formal: "corporate",
        polished: "corporate",
        credible: "corporate",
        reliable: "corporate",
        enterprise: "corporate",
        technical: "corporate",
        engineer: "corporate",
        precise: "corporate",
        developer: "corporate",
        devFocused: "corporate",
        minimal: "minimal",
        concise: "minimal",
        direct: "minimal",
        plain: "minimal",
        toThePoint: "minimal",
        efficient: "minimal",
        innovative: "playful",
        forward: "playful",
        visionary: "playful",
        cuttingEdge: "playful",
        modern: "playful",
        nextGen: "playful",
        future: "playful",
        calm: "casual",
        clear: "casual",
        steady: "casual",
        thoughtful: "casual",
        measured: "casual",
      };
      tone = toneMap[kind] ?? "unknown";
    }

    // Determine if the website has a logo from the analyzer's extracted cues
    const hasLogo = result.assets.some(
      (a: any) => /logo|wordmark|logomark/i.test(a.label)
    ) || result.colors.length > 0;

    const profile = {
      primaryColor: primaryColor,
      secondaryColor: secondaryColor,
      textColor: textColor,
      fontFamily: fontFamily,
      tone: tone,
      hasLogo: hasLogo,
    } as WebsiteBrandProfile;

    return { profile, error: undefined };
  } catch (error) {
    return { profile: null, error: (error as Error).message };
  }
}

/** Map brand profile to video params matching StoryboardVideoPlan */
export function brandProfileToVideoParams(profile: WebsiteBrandProfile) {
  return {
    backgroundColor: profile.primaryColor,
    textColor: profile.textColor,
    fontFamily: profile.fontFamily,
    tone: profile.tone,
  };
}

/** Build storyboard plan from brand profile - returns StoryboardVideoPlan */
export function buildStoryboardVideoPlanFromBrand({
  projectId,
  brandProfile,
  videoParams,
}: {
  projectId: string;
  brandProfile: WebsiteBrandProfile;
  videoParams: ReturnType<typeof brandProfileToVideoParams>;
}): {
  composition: {
    name: string;
    width: number;
    height: number;
    frameRate: number;
    durationMs: number;
  };
  layers: Array<{
    name: string;
    type: "TEXT" | "MEDIA" | "SHAPE";
    textContent?: string | null;
    assetRef?: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    opacity?: number | null;
    fit?: "COVER" | null;
  }>;
} {
  const { backgroundColor, textColor, fontFamily, tone } = videoParams;
  const width = 1080;
  const height = 1920;

  const layers = [
    {
      name: "Background",
      type: "MEDIA",
      assetRef: null,
      x: 0,
      y: 0,
      width,
      height,
      zIndex: 1,
      fit: "COVER",
    },
    {
      name: "Title",
      type: "TEXT",
      textContent: "New idea from the web",
      x: 80,
      y: 80,
      width: 920,
      height: 110,
      zIndex: 4,
      opacity: 0.9,
    },
  ];

  return {
    composition: {
      name: `${tone} video`,
      width,
      height,
      frameRate: 30,
      durationMs: 30_000,
    },
    layers,
  };
}