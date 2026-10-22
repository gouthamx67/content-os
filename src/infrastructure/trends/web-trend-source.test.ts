import { describe, expect, it } from "vitest";
import type { SafeHttpFetcher } from "../ingestion/safe-http";
import {
  buildGoogleNewsQuery,
  isUsableTrendArticle,
  parseGoogleNewsRss,
  parseHackerNews,
  WebTrendSource,
} from "./web-trend-source";

const RSS = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title><![CDATA[Why short-form demos are changing SaaS launches]]></title>
    <link>https://news.example.com/demo-trend</link>
    <source url="https://example.com">Example News</source>
    <pubDate>Wed, 21 Oct 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Buyers want the product <b>doing the work</b>.</p>]]></description>
  </item>
  <item>
    <title>TOP 20 MARKETING STATISTICS 2026 REVEAL SHOCKING DOMINATION</title>
    <link>https://news.example.com/clickbait</link>
    <pubDate>Wed, 21 Oct 2026 12:00:00 GMT</pubDate>
    <description>Numbers without context.</description>
  </item>
  <item>
    <title>AI content is moving from volume to proof</title>
    <link>https://news.example.com/proof-trend</link>
    <pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate>
    <description>Marketing teams are asking for evidence.</description>
  </item>
</channel></rss>`;

const HN = JSON.stringify({
  hits: [
    {
      objectID: "1",
      title: "Show HN: A launch workflow that starts from a screenshot",
      url: "https://example.com/show-hn",
      created_at: "2026-10-22T08:00:00.000Z",
      story_text: "<p>I built this because launch content takes too long.</p>",
    },
    {
      objectID: "2",
      title: "Ask HN: How do you prove AI content is grounded?",
      url: null,
      created_at: "2026-10-19T08:00:00.000Z",
      story_text: null,
    },
  ],
});

function fetcher(): Pick<SafeHttpFetcher, "fetch"> {
  return {
    async fetch(url: string) {
      const body = url.includes("news.google.com") ? RSS : HN;
      return {
        url,
        statusCode: 200,
        contentType: url.includes("news.google.com")
          ? "application/rss+xml"
          : "application/json",
        body: new TextEncoder().encode(body),
      };
    },
  };
}

describe("parseGoogleNewsRss", () => {
  it("reads dated, attributed articles and strips HTML", () => {
    const articles = parseGoogleNewsRss(RSS);

    expect(articles).toHaveLength(3);
    expect(articles[0]).toMatchObject({
      title: "Why short-form demos are changing SaaS launches",
      url: "https://news.example.com/demo-trend",
      source: "Example News",
      publishedAt: "2026-10-21T10:00:00.000Z",
    });
    expect(articles[1]?.source).toBe("Google News");
    expect(articles[0]?.summary).toBe("Buyers want the product doing the work.");
  });
});

describe("buildGoogleNewsQuery", () => {
  it("prefers reputable publishers and bounds recency", () => {
    const query = buildGoogleNewsQuery("SaaS social media trends", true);

    expect(query).toContain("site:socialmediatoday.com");
    expect(query).toContain("site:adweek.com");
    expect(query).toContain("when:30d");
    expect(buildGoogleNewsQuery("SaaS social media trends", false)).toBe(
      "SaaS social media trends when:30d",
    );
  });

  it("filters clickbait titles before they reach the model", () => {
    expect(
      isUsableTrendArticle({
        title: "TOP 20 MARKETING STATISTICS 2026 REVEAL SHOCKING DOMINATION",
        url: "https://example.com/clickbait",
        source: "Example",
        publishedAt: null,
        summary: "",
      }),
    ).toBe(false);
    expect(
      isUsableTrendArticle({
        title: "YouTube shares data on how creators are using AI",
        url: "https://example.com/news",
        source: "Social Media Today",
        publishedAt: null,
        summary: "",
      }),
    ).toBe(true);
  });
});

describe("parseHackerNews", () => {
  it("falls back to the discussion URL when a story has no external link", () => {
    const articles = parseHackerNews(JSON.parse(HN));

    expect(articles).toHaveLength(2);
    expect(articles[0]?.summary).toBe(
      "I built this because launch content takes too long.",
    );
    expect(articles[1]?.url).toBe("https://news.ycombinator.com/item?id=2");
  });
});

describe("WebTrendSource", () => {
  it("combines both feeds, sorts by date and caches the query", async () => {
    let calls = 0;
    const base = fetcher();
    const source = new WebTrendSource(
      {
        async fetch(url, options) {
          calls += 1;
          return base.fetch(url, options);
        },
      },
      () => 1_000,
    );

    const first = await source.latest(
      "SaaS social media trends",
      new Date("2026-10-22T12:00:00.000Z"),
    );
    const second = await source.latest(
      "SaaS social media trends",
      new Date("2026-10-22T12:00:00.000Z"),
    );

    expect(first).toHaveLength(4);
    expect(first.some((article) => article.url.endsWith("/clickbait"))).toBe(
      false,
    );
    expect(first[0]?.publishedAt).toBe("2026-10-22T08:00:00.000Z");
    expect(second).toEqual(first);
    expect(calls).toBe(2);
  });
});
