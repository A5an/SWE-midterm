import type { DocumentContent } from "@swe-midterm/contracts";

export interface AutosaveStateSnapshot {
  kind: "idle" | "dirty" | "saving" | "saved" | "error";
  savedAt?: string;
  message?: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const stripMarkup = (value: string): string =>
  value
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();

const looksLikeHtml = (value: string): boolean => /<\/?[a-z][\s\S]*>/iu.test(value);

export const contentToStoredMarkup = (content: DocumentContent): string =>
  content.content.map((block) => block.text).join("\n\n");

export const contentToEditorHtml = (content: DocumentContent): string => {
  const storedMarkup = contentToStoredMarkup(content).trim();

  if (storedMarkup.length === 0) {
    return "<p><br></p>";
  }

  if (looksLikeHtml(storedMarkup)) {
    return storedMarkup;
  }

  return storedMarkup
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
};

export const editorHtmlToContent = (html: string): DocumentContent => {
  const normalizedHtml = html.trim().length > 0 ? html.trim() : "<p><br></p>";

  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        text: normalizedHtml
      }
    ]
  };
};

export const htmlToPlainText = (html: string): string => {
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = html;
    return (container.textContent || "").replace(/\s+\n/gu, "\n").trim();
  }

  return stripMarkup(html);
};

export const contentToPlainText = (content: DocumentContent): string =>
  htmlToPlainText(contentToEditorHtml(content));

export const contentToPreview = (content: DocumentContent, maxLength = 140): string => {
  const preview = contentToPlainText(content);

  if (preview.length <= maxLength) {
    return preview;
  }

  return `${preview.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

export const formatAutosaveLabel = (state: AutosaveStateSnapshot): string => {
  if (state.kind === "idle") {
    return "Autosave idle";
  }

  if (state.kind === "dirty") {
    return "Unsaved changes";
  }

  if (state.kind === "saving") {
    return "Saving…";
  }

  if (state.kind === "saved") {
    if (!state.savedAt) {
      return "Saved";
    }

    const savedAt = new Date(state.savedAt);
    return Number.isNaN(savedAt.getTime())
      ? "Saved"
      : `Saved ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  }

  return state.message && state.message.trim().length > 0
    ? `Autosave failed: ${state.message}`
    : "Autosave failed";
};
