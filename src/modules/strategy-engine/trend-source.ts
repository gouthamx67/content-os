export type TrendArticle = {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  summary: string;
};

export interface TrendArticleSource {
  latest(query: string, asOf: Date): Promise<TrendArticle[]>;
}
