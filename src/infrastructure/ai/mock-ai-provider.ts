import type {
  AIProvider,
  AIRequest,
  AIResponse,
} from "../../core/ports";

export class MockAIProvider implements AIProvider {
  async generate(request: AIRequest): Promise<AIResponse> {
    const lastMessage = request.messages.at(-1);

    return {
      model: request.model ?? "mock-model",
      text: JSON.stringify({
        message:
          "AI provider connection is ready. Real model integration comes later.",
        input: lastMessage?.content ?? "",
      }),
    };
  }
}