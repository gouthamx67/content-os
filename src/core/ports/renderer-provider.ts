export type RenderRequest = {
  projectId: string;

  artifactType: string;

  plan: Record<string, unknown>;

  width: number;
  height: number;

  durationSeconds?: number;
};

export type RenderResult = {
  uri: string;

  durationSeconds?: number;

  metadata?: Record<string, unknown>;
};

export interface RendererProvider {
  render(request: RenderRequest): Promise<RenderResult>;
}