import { describe, expect, it } from "vitest";

import {
  applySuggestionToDocument,
  buildAiRequestContext,
  describeSelection,
  normalizeEditorSelection
} from "./ai.ts";

describe("ai helpers", () => {
  it("normalizes explicit selections", () => {
    const selected = normalizeEditorSelection("alpha beta gamma", 6, 10);

    expect(selected).toEqual({
      start: 6,
      end: 10,
      text: "beta"
    });
  });

  it("falls back to the entire document when no range is selected", () => {
    const fallback = normalizeEditorSelection("entire doc", 4, 4);

    expect(fallback).toEqual({
      start: 0,
      end: 10,
      text: "entire doc"
    });
  });

  it("applies suggestions and builds nearby context", () => {
    const selected = normalizeEditorSelection("alpha beta gamma", 6, 10);

    expect(applySuggestionToDocument("alpha beta gamma", selected, "delta")).toBe(
      "alpha delta gamma"
    );
    expect(buildAiRequestContext("alpha beta gamma", selected, 3)).toEqual({
      before: "ha ",
      after: " ga"
    });
    expect(describeSelection(selected)).toBe("Selection 6-10 (4 chars)");
  });
});
