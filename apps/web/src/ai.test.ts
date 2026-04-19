import assert from "node:assert/strict";
import {
  applySuggestionToDocument,
  buildAiRequestContext,
  describeSelection,
  normalizeEditorSelection
} from "./ai.ts";

const selected = normalizeEditorSelection("alpha beta gamma", 6, 10);
assert.deepEqual(selected, {
  start: 6,
  end: 10,
  text: "beta"
});

const fallback = normalizeEditorSelection("entire doc", 4, 4);
assert.deepEqual(fallback, {
  start: 0,
  end: 10,
  text: "entire doc"
});

assert.equal(
  applySuggestionToDocument("alpha beta gamma", selected, "delta"),
  "alpha delta gamma"
);
assert.deepEqual(buildAiRequestContext("alpha beta gamma", selected, 3), {
  before: "ha ",
  after: " ga"
});
assert.equal(describeSelection(selected), "Selection 6-10 (4 chars)");
assert.equal(describeSelection(fallback), "Entire document (10 chars)");

console.log("frontend-ai: helper selection/apply tests passed");
