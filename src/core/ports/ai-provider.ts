export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AIRequest = {
  messages: AIMessage[];

  model?: string;

  temperature?: number;

  metadata?: Record<string, unknown>;
};

export type AIResponse = {
  text: string;

  model: string;

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

export interface AIProvider {
  generate(request: AIRequest): Promise<AIResponse>;
}