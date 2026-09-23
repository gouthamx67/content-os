export type PublishRequest = {
  artifactId: string;

  platform: string;

  metadata?: Record<string, unknown>;
};

export type PublishResult = {
  success: boolean;

  externalId?: string;

  url?: string;

  metadata?: Record<string, unknown>;
};

export interface PublishingProvider {
  publish(
    request: PublishRequest,
  ): Promise<PublishResult>;
}