import type { AiFeatureType } from "@swe-midterm/contracts";

export type SupportedAiSuggestionFeature = Extract<AiFeatureType, "rewrite" | "summarize">;

export interface AiPromptDefinition {
  system: string;
  user: string;
}

export interface AiPromptContext {
  after: string;
  before: string;
}

const cleanWhitespace = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();

export const buildRewriteSuggestion = (text: string, instructions: string | null): string => {
  const withoutFiller = cleanWhitespace(
    text.replace(/\b(really|very|just|actually|basically|perhaps)\b/giu, "")
  );
  if (withoutFiller.length === 0) {
    return "Rewrite unavailable because the selected text is empty.";
  }

  const rewritten = withoutFiller
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => sentence.trim().length > 0)
    .map((sentence) => sentence.trim())
    .map((sentence) => sentence[0].toUpperCase() + sentence.slice(1))
    .join(" ");

  return instructions && instructions.trim().length > 0
    ? `${rewritten}\n\nAdditional focus: ${cleanWhitespace(instructions)}.`
    : rewritten;
};

export const buildSummarySuggestion = (text: string): string => {
  const cleaned = cleanWhitespace(text);
  if (cleaned.length === 0) {
    return "Summary unavailable because the selected text is empty.";
  }

  const words = cleaned.split(/\s+/u);
  const summary = words.slice(0, Math.min(words.length, 18)).join(" ");
  const suffix = words.length > 18 ? "..." : ".";
  return `Summary: ${summary}${suffix}`;
};

export const buildAiSuggestion = (
  feature: SupportedAiSuggestionFeature,
  selectionText: string,
  instructions: string | null
): string =>
  feature === "rewrite"
    ? buildRewriteSuggestion(selectionText, instructions)
    : buildSummarySuggestion(selectionText);

export const buildAiPromptDefinition = (
  feature: SupportedAiSuggestionFeature,
  selectionText: string,
  instructions: string | null,
  context: AiPromptContext
): AiPromptDefinition => {
  const trimmedSelection = selectionText.trim();
  const trimmedInstructions = instructions?.trim() || "";
  const trimmedBefore = context.before.trim();
  const trimmedAfter = context.after.trim();
  const contextLines = [
    "Surrounding document context:",
    `Before selection: ${trimmedBefore.length > 0 ? trimmedBefore : "(none)"}`,
    `After selection: ${trimmedAfter.length > 0 ? trimmedAfter : "(none)"}`
  ];

  if (feature === "rewrite") {
    return {
      system:
        "You rewrite selected text inside a collaborative document editor. Return only the rewritten text. Do not add commentary, markdown fences, or labels unless the input already requires them.",
      user: [
        "Task: Rewrite the selected text to improve clarity and concision while preserving meaning.",
        trimmedInstructions.length > 0 ? `Extra instructions: ${trimmedInstructions}` : null,
        ...contextLines,
        "Return only the final rewritten text.",
        "",
        "Selected text:",
        trimmedSelection
      ]
        .filter((part): part is string => part !== null)
        .join("\n")
    };
  }

  return {
    system:
      "You summarize selected text inside a collaborative document editor. Return only the summary text. Do not add commentary, markdown fences, or labels unless the user explicitly asks for them.",
    user: [
      "Task: Produce a concise summary of the selected text.",
      "Preserve the original factual meaning.",
      trimmedInstructions.length > 0 ? `Extra instructions: ${trimmedInstructions}` : null,
      ...contextLines,
      "Return only the summary text.",
      "",
      "Selected text:",
      trimmedSelection
    ]
      .filter((part): part is string => part !== null)
      .join("\n")
  };
};
