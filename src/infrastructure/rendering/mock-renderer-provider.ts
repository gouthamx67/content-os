import type {
  RenderRequest,
  RenderResult,
  RendererProvider,
} from "../../core/ports";

export class MockRendererProvider implements RendererProvider {
  async render(
    request: RenderRequest,
  ): Promise<RenderResult> {
    return {
      uri: `mock://render/${request.projectId}/${request.artifactType}`,
      durationSeconds: request.durationSeconds,
      metadata: {
        renderer: "mock",
        status: "placeholder",
      },
    };
  }
}