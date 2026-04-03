export type UserRole = "owner" | "editor" | "commenter" | "viewer";

export type AiFeatureType = "rewrite" | "summarize" | "translate" | "restructure";

export interface DocumentParagraph {
  type: "paragraph";
  text: string;
}

export interface DocumentContent {
  type: "doc";
  content: DocumentParagraph[];
}

export interface CreateDocumentRequest {
  workspaceId: string;
  title: string;
  templateId: string | null;
  initialContent: DocumentContent;
}

export interface DocumentMetadataResponse {
  documentId: string;
  workspaceId: string;
  title: string;
  ownerRole: "owner";
  currentVersionId: string;
  createdAt: string;
}

export interface DocumentDetailResponse extends DocumentMetadataResponse {
  content: DocumentContent;
  updatedAt: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isDocumentContent = (value: unknown): value is DocumentContent => {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type !== "doc" || !Array.isArray(value.content)) {
    return false;
  }
  return value.content.every(
    (block) =>
      isRecord(block) &&
      block.type === "paragraph" &&
      typeof block.text === "string"
  );
};

export const parseCreateDocumentRequest = (value: unknown): ParseResult<CreateDocumentRequest> => {
  if (!isRecord(value)) {
    return { ok: false, reason: "Request body must be a JSON object." };
  }

  const { workspaceId, title, templateId, initialContent } = value;

  if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    return { ok: false, reason: "workspaceId must be a non-empty string." };
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    return { ok: false, reason: "title must be a non-empty string." };
  }

  if (templateId !== null && typeof templateId !== "string") {
    return { ok: false, reason: "templateId must be null or string." };
  }

  if (!isDocumentContent(initialContent)) {
    return { ok: false, reason: "initialContent must match document content schema." };
  }

  return {
    ok: true,
    value: {
      workspaceId,
      title,
      templateId,
      initialContent
    }
  };
};

const isIsoDateString = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

export const isDocumentMetadataResponse = (value: unknown): value is DocumentMetadataResponse => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.documentId === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.title === "string" &&
    value.ownerRole === "owner" &&
    typeof value.currentVersionId === "string" &&
    isIsoDateString(value.createdAt)
  );
};

export const isDocumentDetailResponse = (value: unknown): value is DocumentDetailResponse => {
  if (!isDocumentMetadataResponse(value) || !isRecord(value)) {
    return false;
  }
  return isDocumentContent(value.content) && isIsoDateString(value.updatedAt);
};

export const isApiErrorEnvelope = (value: unknown): value is ApiErrorEnvelope => {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }
  const { error } = value;
  return (
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof error.retryable === "boolean" &&
    typeof error.requestId === "string"
  );
};
