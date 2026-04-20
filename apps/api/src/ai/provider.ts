import {
  buildAiPromptDefinition,
  type AiPromptContext,
  buildAiSuggestion,
  type SupportedAiSuggestionFeature
} from "./prompts.ts";

const DEFAULT_AI_PROVIDER = "demo";
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "http://127.0.0.1:1234/v1";
const DEFAULT_OPENAI_COMPATIBLE_API_KEY = "lm-studio";
const DEFAULT_OPENAI_COMPATIBLE_MODEL = "nvidia.nemotron-mini-4b-instruct";

interface OpenAiCompatibleStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

export interface AiSuggestionProvider {
  readonly model: string;
  streamSuggestion(
    feature: SupportedAiSuggestionFeature,
    selectionText: string,
    context: AiPromptContext,
    instructions: string | null,
    options?: {
      signal?: AbortSignal;
    }
  ): AsyncIterable<string>;
}

class DemoAiSuggestionProvider implements AiSuggestionProvider {
  readonly model = "demo-local-ai-v1";

  async *streamSuggestion(
    feature: SupportedAiSuggestionFeature,
    selectionText: string,
    _context: AiPromptContext,
    instructions: string | null
  ): AsyncIterable<string> {
    const suggestion = buildAiSuggestion(feature, selectionText, instructions);
    const chunks = suggestion.match(/\S+\s*/gu) ?? [suggestion];

    for (const chunk of chunks) {
      await new Promise((resolve) => {
        setTimeout(resolve, 110);
      });
      yield chunk;
    }
  }
}

class OpenAiCompatibleSuggestionProvider implements AiSuggestionProvider {
  readonly model: string;

  readonly #apiKey: string;

  readonly #baseUrl: string;

  public constructor(options: { apiKey: string; baseUrl: string; model: string }) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.model = options.model;
  }

  async *streamSuggestion(
    feature: SupportedAiSuggestionFeature,
    selectionText: string,
    context: AiPromptContext,
    instructions: string | null,
    options?: {
      signal?: AbortSignal;
    }
  ): AsyncIterable<string> {
    const prompt = buildAiPromptDefinition(feature, selectionText, instructions, context);
    const response = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        temperature: feature === "summarize" ? 0.2 : 0.3,
        messages: [
          {
            role: "system",
            content: prompt.system
          },
          {
            role: "user",
            content: prompt.user
          }
        ]
      }),
      signal: options?.signal
    });

    if (!response.ok) {
      const failureBody = await response.text();
      throw new Error(
        `OpenAI-compatible provider request failed with ${response.status} ${response.statusText}: ${failureBody || "empty body"}`
      );
    }

    if (!response.body) {
      throw new Error("OpenAI-compatible provider response did not include a stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parsed = extractSseDataFrames(buffer);
      buffer = parsed.remainder;

      for (const frame of parsed.frames) {
        const content = parseOpenAiCompatibleFrame(frame);
        if (content === null) {
          return;
        }
        if (content.length > 0) {
          yield content;
        }
      }
    }

    const trailing = extractSseDataFrames(`${buffer}\n\n`);
    for (const frame of trailing.frames) {
      const content = parseOpenAiCompatibleFrame(frame);
      if (content === null) {
        return;
      }
      if (content.length > 0) {
        yield content;
      }
    }
  }
}

const extractSseDataFrames = (buffer: string): { frames: string[]; remainder: string } => {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const frames = normalized.split("\n\n");

  return {
    frames: frames.slice(0, -1),
    remainder: frames.at(-1) ?? ""
  };
};

const parseOpenAiCompatibleFrame = (frame: string): string | null => {
  const payload = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");

  if (payload.length === 0) {
    return "";
  }

  if (payload === "[DONE]") {
    return null;
  }

  let parsed: OpenAiCompatibleStreamChunk;

  try {
    parsed = JSON.parse(payload) as OpenAiCompatibleStreamChunk;
  } catch {
    throw new Error("OpenAI-compatible provider returned malformed JSON stream data.");
  }

  if (parsed.error?.message) {
    throw new Error(parsed.error.message);
  }

  const content = parsed.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
};

const readEnvValue = (env: NodeJS.ProcessEnv, key: string): string | null => {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

export const createAiSuggestionProvider = (
  env: NodeJS.ProcessEnv = process.env
): AiSuggestionProvider => {
  const provider = readEnvValue(env, "AI_PROVIDER")?.toLowerCase() ?? DEFAULT_AI_PROVIDER;

  if (provider === "openai-compatible") {
    return new OpenAiCompatibleSuggestionProvider({
      apiKey: readEnvValue(env, "AI_PROVIDER_API_KEY") ?? DEFAULT_OPENAI_COMPATIBLE_API_KEY,
      baseUrl: readEnvValue(env, "AI_PROVIDER_BASE_URL") ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
      model: readEnvValue(env, "AI_MODEL") ?? DEFAULT_OPENAI_COMPATIBLE_MODEL
    });
  }

  return new DemoAiSuggestionProvider();
};

export const demoAiSuggestionProvider: AiSuggestionProvider = new DemoAiSuggestionProvider();
