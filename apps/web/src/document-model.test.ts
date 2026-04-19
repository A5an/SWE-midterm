import { describe, expect, it } from "vitest";

import {
  contentToEditorHtml,
  contentToPlainText,
  editorHtmlToContent,
  formatAutosaveLabel
} from "./document-model.ts";

describe("document model helpers", () => {
  it("upgrades plain text content into editor html", () => {
    expect(
      contentToEditorHtml({
        type: "doc",
        content: [
          {
            type: "paragraph",
            text: "First paragraph\n\nSecond paragraph"
          }
        ]
      })
    ).toBe("<p>First paragraph</p><p>Second paragraph</p>");
  });

  it("round-trips stored html content and derives preview text", () => {
    const content = editorHtmlToContent(
      "<h2>Sprint Goals</h2><p><strong>Ship</strong> autosave and dashboard list.</p>"
    );

    expect(content.content[0]?.text).toContain("<h2>Sprint Goals</h2>");
    expect(contentToPlainText(content)).toContain("Sprint Goals");
    expect(contentToPlainText(content)).toContain("Ship autosave and dashboard list.");
  });

  it("formats autosave labels for user-facing status text", () => {
    expect(formatAutosaveLabel({ kind: "dirty" })).toBe("Unsaved changes");
    expect(formatAutosaveLabel({ kind: "saving" })).toBe("Saving…");
    expect(formatAutosaveLabel({ kind: "error", message: "viewer access" })).toBe(
      "Autosave failed: viewer access"
    );
  });
});
