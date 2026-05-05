import { OpenAICompatProvider } from "./openai-compat.js";

export class GroqProvider extends OpenAICompatProvider {
  constructor(model: string = "llama-3.3-70b-versatile") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY not set. Get one free at console.groq.com");
    }
    super("groq", "https://api.groq.com/openai/v1", apiKey, model);
  }
}
