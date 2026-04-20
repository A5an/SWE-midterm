import { buildAiSuggestion, type SupportedAiSuggestionFeature } from "./prompts.ts";

export interface AiSuggestionProvider {
  readonly model: string;
  generateSuggestion(
    feature: SupportedAiSuggestionFeature,
    selectionText: string,
    instructions: string | null
  ): string;
}

class DemoAiSuggestionProvider implements AiSuggestionProvider {
  readonly model = "demo-local-ai-v1";

  generateSuggestion(
    feature: SupportedAiSuggestionFeature,
    selectionText: string,
    instructions: string | null
  ): string {
    return buildAiSuggestion(feature, selectionText, instructions);
  }
}

export const demoAiSuggestionProvider: AiSuggestionProvider = new DemoAiSuggestionProvider();
