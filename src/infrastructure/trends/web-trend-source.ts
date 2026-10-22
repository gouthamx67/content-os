import type { SafeHttpFetcher } from "../ingestion/safe-http";
import type {
  TrendArticle,
  TrendArticleSource,
} from "../../modules/strategy-engine/trend-source";

type Fetcher = Pick<SafeHttpFetcher, "fetch">;
type CacheEntry = { expiresAt: number; articles: TrendArticle[] };

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_ARTICLES = 10;
const GOOGLE_NEWS_SOURCES = [
  "socialmediatoday.com",
  "adweek.com",
  "digiday.com",
  "marketingweek.com",
  "buffer.com",
  "later.com",
  "sproutsocial.com",
  "hubspot.com",
  "hootsuite.com",
  "brandwatch.com",
  "thinkwithgoogle.com",
  "pewresearch.org",
];
const CLICKBAIT_TITLE = /\b(shocking|domination|you won'?t believe|top \d+ .*statistics)\b/i;
const SOCIAL_MARKETING_TERMS =
  /\b(social|creator|influencer|content|marketing|advertis\w*|campaign|instagram|tiktok|youtube|linkedin|facebook|meta|reddit|threads|ads?)\b/i;
const FETCH_OPTIONS = {
  maxBytes: 512 * 1024,
  maxRedirects: 2,
  timeoutMs: 8_000,
  headers: {
    accept: "application/rss+xml, application/json, text/xml;q=0.9, */*;q=0.8",
  },
} as const;

export class WebTrendSource implements TrendArticleSource {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly fetcher: Fetcher,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async latest(query: string, asOf: Date): Promise<TrendArticle[]> {
    const key = query.trim().toLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.articles;

    const results = await Promise.allSettled([
      this.fromGoogleNews(query),
      this.fromHackerNews(query, asOf),
    ]);
    const articles = results
      .flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      )
      .filter(
        (article) =>
          isUsableTrendArticle(article) &&
          isRelevantTrendArticle(article) &&
          isRecentTrendArticle(article, asOf),
      );

    if (articles.length === 0) {
      throw new Error("No public trend source returned a usable article");
    }

    const ranked = dedupe(articles)
      .sort((left, right) => timestamp(right.publishedAt) - timestamp(left.publishedAt))
      .slice(0, MAX_ARTICLES);

    this.cache.set(key, {
      expiresAt: this.now() + CACHE_TTL_MS,
      articles: ranked,
    });
    return ranked;
  }

  private async fromGoogleNews(query: string): Promise<TrendArticle[]> {
    const curated = await this.fetchGoogleNews(
      buildGoogleNewsQuery(query, true),
    );
    if (curated.length > 0) return curated;
    return this.fetchGoogleNews(buildGoogleNewsQuery(query, false));
  }

  private async fetchGoogleNews(query: string): Promise<TrendArticle[]> {
    const url =
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent(query) +
      "&hl=en-US&gl=US&ceid=US:en";
    const response = await this.fetcher.fetch(url, FETCH_OPTIONS);
    return parseGoogleNewsRss(new TextDecoder().decode(response.body));
  }

  private async fromHackerNews(
    query: string,
    asOf: Date,
  ): Promise<TrendArticle[]> {
    const since = Math.floor((asOf.getTime() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const url =
      "https://hn.algolia.com/api/v1/search_by_date?query=" +
      encodeURIComponent(query) +
      "&tags=story&hitsPerPage=8&numericFilters=" +
      encodeURIComponent(`created_at_i>${since}`);
    const response = await this.fetcher.fetch(url, FETCH_OPTIONS);
    return parseHackerNews(JSON.parse(new TextDecoder().decode(response.body)));
  }
}

export function buildGoogleNewsQuery(
  query: string,
  curated: boolean,
): string {
  const trimmed = query.trim();
  if (!curated) return `${trimmed} when:30d`;
  const sites = GOOGLE_NEWS_SOURCES.map((source) => `site:${source}`).join(
    " OR ",
  );
  return `(${sites}) ${trimmed} when:30d`;
}

export function isUsableTrendArticle(article: TrendArticle): boolean {
  return article.title.trim().length > 0 && !CLICKBAIT_TITLE.test(article.title);
}

export function isRelevantTrendArticle(article: TrendArticle): boolean {
  return SOCIAL_MARKETING_TERMS.test(`${article.title} ${article.summary}`);
}

export function isRecentTrendArticle(
  article: TrendArticle,
  asOf: Date,
  maxAgeDays = 45,
): boolean {
  if (!article.publishedAt) return false;
  const published = Date.parse(article.publishedAt);
  if (!Number.isFinite(published)) return false;
  return published >= asOf.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
}

export function parseGoogleNewsRss(xml: string): TrendArticle[] {
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  return items.flatMap((match) => {
    const block = match[1] ?? "";
    const title = cleanText(tagValue(block, "title"));
    const url = cleanText(tagValue(block, "link"));
    if (!title || !url) return [];
    const publishedAt = isoDate(tagValue(block, "pubDate"));
    const source = cleanText(tagValue(block, "source")) || "Google News";
    return [
      {
        title,
        url,
        source,
        publishedAt,
        summary: cleanText(tagValue(block, "description")).slice(0, 320),
      },
    ];
  });
}

export function parseHackerNews(payload: unknown): TrendArticle[] {
  if (!isRecord(payload) || !Array.isArray(payload["hits"])) return [];
  return payload["hits"].flatMap((hit) => {
    if (!isRecord(hit)) return [];
    const title = readString(hit["title"]);
    if (!title) return [];
    const objectId = readString(hit["objectID"]);
    const url =
      readString(hit["url"]) ??
      (objectId ? `https://news.ycombinator.com/item?id=${objectId}` : null);
    if (!url) return [];
    return [
      {
        title,
        url,
        source: "Hacker News",
        publishedAt: isoDate(readString(hit["created_at"]) ?? ""),
        summary: cleanText(readString(hit["story_text"]) ?? "").slice(0, 320),
      },
    ];
  });
}

function tagValue(block: string, tag: string): string {
  const match = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
    "i",
  ).exec(block);
  return match?.[1] ?? "";
}

function cleanText(value: string): string {
  return decodeEntities(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? safeCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) ? safeCodePoint(code) : "";
    });
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function isoDate(value: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dedupe(articles: TrendArticle[]): TrendArticle[] {
  const seen = new Set<string>();
  return articles.filter((article) => {
    const key = article.url.trim().replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
