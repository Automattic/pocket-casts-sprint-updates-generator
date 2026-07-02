import type { AIProvider, ChatMessage, ChatOptions } from "./provider.js";

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  constructor(private readonly defaultModel: string = "claude-sonnet-5") {}

  private getApiKey(): string {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error("ANTHROPIC_API_KEY not set. Get one at console.anthropic.com");
    }
    return key;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? 1024,
      messages: nonSystemMsgs.map((m) => ({ role: m.role, content: m.content })),
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.getApiKey(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }

    const json = (await response.json()) as AnthropicResponse;
    const textBlock = json.content.find((c) => c.type === "text");
    return textBlock?.text ?? "";
  }

  async validate(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.chat(
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
