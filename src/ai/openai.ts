import { OpenAICompatProvider } from "./openai-compat.js";

export class OpenAIProvider extends OpenAICompatProvider {
  constructor(model: string = "gpt-4o-mini") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not set. Get one at platform.openai.com");
    }
    super("openai", "https://api.openai.com/v1", apiKey, model);
  }
}
