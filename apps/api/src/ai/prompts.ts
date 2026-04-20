import type { AiFeatureType } from "@swe-midterm/contracts";

export type SupportedAiSuggestionFeature = Extract<AiFeatureType, "rewrite" | "summarize">;

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
