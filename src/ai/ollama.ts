import { OpenAICompatProvider } from "./openai-compat.js";

export class OllamaProvider extends OpenAICompatProvider {
  constructor(model: string = "llama3.2") {
    const baseUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
    super("ollama", `${baseUrl}/v1`, "", model);
  }

  override async validate(): Promise<{ ok: boolean; detail: string }> {
    const baseUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
    try {
      const response = await fetch(`${baseUrl}/api/tags`);
      if (!response.ok) {
        return { ok: false, detail: `Ollama returned ${response.status}` };
      }
      const json = (await response.json()) as { models?: Array<{ name: string }> };
      const models = json.models?.map((m) => m.name).join(", ") ?? "none";
      return { ok: true, detail: `Connected (available models: ${models})` };
    } catch {
      return { ok: false, detail: `Cannot reach Ollama at ${baseUrl}. Is it running?` };
    }
  }
}
