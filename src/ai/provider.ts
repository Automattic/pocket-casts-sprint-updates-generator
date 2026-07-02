export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIProvider {
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  validate(): Promise<{ ok: boolean; detail: string }>;
}

export type ProviderName = "groq" | "openai" | "ollama" | "anthropic";

export const PROVIDER_DEFAULTS: Record<ProviderName, { envKey: string; defaultModel: string; label: string }> = {
  groq: { envKey: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile", label: "Groq (free)" },
  openai: { envKey: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini", label: "OpenAI" },
  ollama: { envKey: "", defaultModel: "llama3.2", label: "Ollama (local)" },
  anthropic: { envKey: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-5", label: "Anthropic" },
};

export async function createProvider(name: ProviderName, model?: string): Promise<AIProvider> {
  const defaults = PROVIDER_DEFAULTS[name];
  const resolvedModel = model ?? defaults.defaultModel;

  switch (name) {
    case "groq": {
      const { GroqProvider } = await import("./groq.js");
      return new GroqProvider(resolvedModel);
    }
    case "openai": {
      const { OpenAIProvider } = await import("./openai.js");
      return new OpenAIProvider(resolvedModel);
    }
    case "ollama": {
      const { OllamaProvider } = await import("./ollama.js");
      return new OllamaProvider(resolvedModel);
    }
    case "anthropic": {
      const { AnthropicProvider } = await import("./anthropic.js");
      return new AnthropicProvider(resolvedModel);
    }
    default:
      throw new Error(`Unknown AI provider: ${name}`);
  }
}
