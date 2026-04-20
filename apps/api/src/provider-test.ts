import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { AiPromptContext } from "./ai/prompts.ts";
import { createAiSuggestionProvider } from "./ai/provider.ts";

const collectSuggestion = async (
  provider: ReturnType<typeof createAiSuggestionProvider>,
  feature: "rewrite" | "summarize",
  selectionText: string,
  context: AiPromptContext,
  instructions: string | null
): Promise<string> => {
  let output = "";

  for await (const chunk of provider.streamSuggestion(feature, selectionText, context, instructions)) {
    output += chunk;
  }

  return output;
};

const testDemoProvider = async (): Promise<void> => {
  const provider = createAiSuggestionProvider({});
  const output = await collectSuggestion(
    provider,
    "rewrite",
    "this is really just a test sentence.",
    {
      before: "Previous sentence.",
      after: "Following sentence."
    },
    "Keep it formal"
  );

  assert.match(output, /Additional focus: Keep it formal\./u);
  console.log("provider: demo fallback streams local suggestion chunks");
};

const testOpenAiCompatibleProvider = async (): Promise<void> => {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.end();
      return;
    }

    assert.equal(request.headers.authorization, "Bearer lm-studio");

    const rawBody = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];

      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      request.on("error", reject);
    });

    const body = JSON.parse(rawBody) as {
      messages: Array<{ content: string; role: string }>;
      model: string;
      stream: boolean;
    };

    assert.equal(body.model, "nvidia.nemotron-mini-4b-instruct");
    assert.equal(body.stream, true);
    assert.equal(body.messages[0]?.role, "system");
    assert.equal(body.messages[1]?.role, "user");
    assert.match(body.messages[1]?.content ?? "", /Before selection: Earlier context/u);
    assert.match(body.messages[1]?.content ?? "", /After selection: Later context/u);
    assert.match(body.messages[1]?.content ?? "", /Selected text:/u);

    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.write(
      'data: {"choices":[{"delta":{"content":"Streaming "}}]}\n\n'
    );
    response.write(
      'data: {"choices":[{"delta":{"content":"provider output"}}]}\n\n'
    );
    response.write("data: [DONE]\n\n");
    response.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  try {
    const address = server.address() as AddressInfo;
    const provider = createAiSuggestionProvider({
      AI_PROVIDER: "openai-compatible",
      AI_PROVIDER_API_KEY: "lm-studio",
      AI_PROVIDER_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      AI_MODEL: "nvidia.nemotron-mini-4b-instruct"
    } as NodeJS.ProcessEnv);

    const output = await collectSuggestion(
      provider,
      "summarize",
      "Original content",
      {
        before: "Earlier context",
        after: "Later context"
      },
      null
    );
    assert.equal(output, "Streaming provider output");
    console.log("provider: openai-compatible LM Studio adapter streams completion chunks");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
};

const main = async (): Promise<void> => {
  await testDemoProvider();
  await testOpenAiCompatibleProvider();
  console.log("AI provider tests passed.");
};

main().catch((error) => {
  console.error("AI provider tests failed:", error);
  process.exit(1);
});
