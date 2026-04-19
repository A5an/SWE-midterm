export interface EditorSelectionRange {
  start: number;
  end: number;
  text: string;
}

export interface AiRequestContextPayload {
  before: string;
  after: string;
}

export const normalizeEditorSelection = (
  documentText: string,
  start: number | null | undefined,
  end: number | null | undefined
): EditorSelectionRange => {
  const safeStart =
    typeof start === "number" && Number.isInteger(start) && start >= 0 ? start : 0;
  const safeEnd =
    typeof end === "number" && Number.isInteger(end) && end >= safeStart ? end : safeStart;

  if (safeEnd > safeStart) {
    return {
      start: safeStart,
      end: Math.min(documentText.length, safeEnd),
      text: documentText.slice(safeStart, Math.min(documentText.length, safeEnd))
    };
  }

  return {
    start: 0,
    end: documentText.length,
    text: documentText
  };
};

export const applySuggestionToDocument = (
  documentText: string,
  selection: EditorSelectionRange,
  replacementText: string
): string =>
  `${documentText.slice(0, selection.start)}${replacementText}${documentText.slice(selection.end)}`;

export const buildAiRequestContext = (
  documentText: string,
  selection: EditorSelectionRange,
  radius = 120
): AiRequestContextPayload => ({
  before: documentText.slice(Math.max(0, selection.start - radius), selection.start),
  after: documentText.slice(selection.end, Math.min(documentText.length, selection.end + radius))
});

export const describeSelection = (selection: EditorSelectionRange): string =>
  selection.start === 0 && selection.end === selection.text.length
    ? `Entire document (${selection.text.length} chars)`
    : `Selection ${selection.start}-${selection.end} (${selection.text.length} chars)`;
