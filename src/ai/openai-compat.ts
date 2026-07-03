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
    const maxAttempts = 8;
    let lastError = "";
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
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
          signal: AbortSignal.timeout(90_000),
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs(null, attempt)));
          continue;
        }
        throw new Error(`${this.name} API request failed: ${lastError}`);
      }

      if (response.status === 429 && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, this.retryDelayMs(response, attempt)));
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${this.name} API error ${response.status}: ${body}`);
      }

      const json = (await response.json()) as OpenAIResponse;
      return json.choices[0]?.message?.content ?? "";
    }
    throw new Error(`${this.name} API error: rate limited after retries`);
  }

  private retryDelayMs(response: Response | null, attempt: number): number {
    const header = Number(response?.headers.get("retry-after"));
    if (Number.isFinite(header) && header > 0) return header * 1000 + 500;
    return Math.min(2000 * 2 ** attempt, 20_000);
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
