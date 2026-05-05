import type { AIProvider, ChatMessage, ChatOptions } from "./provider.js";

interface OpenAIResponse {
  choices: Array<{ message: { content: string } }>;
}

export class OpenAICompatProvider implements AIProvider {
  constructor(
    public readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly defaultModel: string,
  ) {}

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: options?.model ?? this.defaultModel,
        messages,
        max_tokens: options?.maxTokens ?? 512,
        temperature: options?.temperature ?? 0.3,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${this.name} API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as OpenAIResponse;
    return json.choices[0]?.message?.content ?? "";
  }

  async validate(): Promise<{ ok: boolean; detail: string }> {
    try {
      const result = await this.chat(
        [{ role: "user", content: "Reply with exactly: ok" }],
        { maxTokens: 5 },
      );
      return { ok: true, detail: `Connected (model: ${this.defaultModel})` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: msg };
    }
  }
}
