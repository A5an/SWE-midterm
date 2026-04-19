export type UserRole = "owner" | "editor" | "commenter" | "viewer";
export type SharingRole = Extract<UserRole, "owner" | "editor" | "viewer">;

export type AiFeatureType = "rewrite" | "summarize" | "translate" | "restructure";

export type CollaborationActivity = "idle" | "editing";

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

export interface UpdateDocumentRequest {
  title?: string;
  content: DocumentContent;
}

export interface DocumentPermissionEntry {
  shareId: string | null;
  source: "owner" | "workspace" | "share";
  userId: string;
  email: string;
  displayName: string;
  permissionLevel: SharingRole;
}

export interface DocumentPermissionsResponse {
  documentId: string;
  permissions: DocumentPermissionEntry[];
}

export interface CreateDocumentShareRequest {
  principalType: "user";
  principalId: string;
  permissionLevel: SharingRole;
}

export interface DocumentShareResponse {
  documentId: string;
  permission: DocumentPermissionEntry;
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

export interface CollaborationParticipant {
  sessionId: string;
  userId: string;
  displayName: string;
  activity: CollaborationActivity;
}

export interface DemoLoginRequest {
  userId: string;
  password: string;
}

export interface DemoLoginResponse {
  accessToken: string;
  userId: string;
  displayName: string;
  workspaceIds: string[];
  issuedAt: string;
  expiresAt: string;
}

export interface CollaborationSessionRequest {
}

export interface CollaborationSessionResponse {
  sessionId: string;
  documentId: string;
  wsUrl: string;
  sessionToken: string;
  documentText: string;
  serverRevision: number;
  presence: CollaborationParticipant[];
  issuedAt: string;
  expiresAt: string;
}

export interface CollaborationClientPresenceMessage {
  type: "client.presence";
  sessionId: string;
  activity: CollaborationActivity;
}

export interface CollaborationClientUpdateMessage {
  type: "client.update";
  sessionId: string;
  clientSeq: number;
  mutationId: string;
  baseRevision: number;
  text: string;
}

export type CollaborationClientMessage =
  | CollaborationClientPresenceMessage
  | CollaborationClientUpdateMessage;

export interface CollaborationServerBootstrapMessage {
  type: "server.bootstrap";
  sessionId: string;
  documentId: string;
  text: string;
  serverRevision: number;
  participants: CollaborationParticipant[];
}

export interface CollaborationServerPresenceMessage {
  type: "server.presence";
  participants: CollaborationParticipant[];
}

export interface CollaborationServerAckMessage {
  type: "server.ack";
  sessionId: string;
  ackClientSeq: number;
  mutationId: string;
  serverRevision: number;
  text: string;
}

export interface CollaborationServerUpdateMessage {
  type: "server.update";
  sessionId: string;
  mutationId: string;
  authorUserId: string;
  serverRevision: number;
  text: string;
}

export interface CollaborationServerErrorMessage {
  type: "server.error";
  code: string;
  message: string;
}

export type CollaborationServerMessage =
  | CollaborationServerBootstrapMessage
  | CollaborationServerPresenceMessage
  | CollaborationServerAckMessage
  | CollaborationServerUpdateMessage
  | CollaborationServerErrorMessage;

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isCollaborationActivity = (value: unknown): value is CollaborationActivity =>
  value === "idle" || value === "editing";

const isSharingRole = (value: unknown): value is SharingRole =>
  value === "owner" || value === "editor" || value === "viewer";

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

export const parseUpdateDocumentRequest = (value: unknown): ParseResult<UpdateDocumentRequest> => {
  if (!isRecord(value)) {
    return { ok: false, reason: "Request body must be a JSON object." };
  }

  const { title, content } = value;

  if (title !== undefined && !isNonEmptyString(title)) {
    return { ok: false, reason: "title must be omitted or a non-empty string." };
  }

  if (!isDocumentContent(content)) {
    return { ok: false, reason: "content must match document content schema." };
  }

  return {
    ok: true,
    value: {
      title,
      content
    }
  };
};

export const parseCollaborationSessionRequest = (
  value: unknown
): ParseResult<CollaborationSessionRequest> => {
  if (!isRecord(value)) {
    return { ok: false, reason: "Request body must be a JSON object." };
  }
  return {
    ok: true,
    value: {}
  };
};

export const parseDemoLoginRequest = (value: unknown): ParseResult<DemoLoginRequest> => {
  if (!isRecord(value)) {
    return { ok: false, reason: "Request body must be a JSON object." };
  }

  const { userId, password } = value;

  if (!isNonEmptyString(userId)) {
    return { ok: false, reason: "userId must be a non-empty string." };
  }

  if (!isNonEmptyString(password)) {
    return { ok: false, reason: "password must be a non-empty string." };
  }

  return {
    ok: true,
    value: {
      userId,
      password
    }
  };
};

export const parseCreateDocumentShareRequest = (
  value: unknown
): ParseResult<CreateDocumentShareRequest> => {
  if (!isRecord(value)) {
    return { ok: false, reason: "Request body must be a JSON object." };
  }

  const { principalType, principalId, permissionLevel } = value;

  if (principalType !== "user") {
    return { ok: false, reason: "principalType must be 'user'." };
  }

  if (!isNonEmptyString(principalId)) {
    return { ok: false, reason: "principalId must be a non-empty string." };
  }

  if (!isSharingRole(permissionLevel)) {
    return { ok: false, reason: "permissionLevel must be one of owner, editor, viewer." };
  }

  return {
    ok: true,
    value: {
      principalType,
      principalId,
      permissionLevel
    }
  };
};

export const parseCollaborationClientMessage = (
  value: unknown
): ParseResult<CollaborationClientMessage> => {
  if (!isRecord(value) || !isNonEmptyString(value.type) || !isNonEmptyString(value.sessionId)) {
    return { ok: false, reason: "Collaboration message must include type and sessionId." };
  }

  if (value.type === "client.presence") {
    if (!isCollaborationActivity(value.activity)) {
      return { ok: false, reason: "Presence updates must use a valid activity state." };
    }

    return {
      ok: true,
      value: {
        type: "client.presence",
        sessionId: value.sessionId,
        activity: value.activity
      }
    };
  }

  if (value.type === "client.update") {
    if (!Number.isInteger(value.clientSeq) || (value.clientSeq as number) < 1) {
      return { ok: false, reason: "clientSeq must be a positive integer." };
    }

    if (!isNonEmptyString(value.mutationId)) {
      return { ok: false, reason: "mutationId must be a non-empty string." };
    }

    if (!Number.isInteger(value.baseRevision) || (value.baseRevision as number) < 0) {
      return { ok: false, reason: "baseRevision must be a non-negative integer." };
    }

    if (typeof value.text !== "string") {
      return { ok: false, reason: "text must be a string." };
    }

    const clientSeq = value.clientSeq as number;
    const baseRevision = value.baseRevision as number;

    return {
      ok: true,
      value: {
        type: "client.update",
        sessionId: value.sessionId,
        clientSeq,
        mutationId: value.mutationId,
        baseRevision,
        text: value.text
      }
    };
  }

  return { ok: false, reason: `Unsupported collaboration message type '${value.type}'.` };
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

export const isDocumentPermissionEntry = (value: unknown): value is DocumentPermissionEntry => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.shareId === null || isNonEmptyString(value.shareId)) &&
    (value.source === "owner" || value.source === "workspace" || value.source === "share") &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.email) &&
    isNonEmptyString(value.displayName) &&
    isSharingRole(value.permissionLevel)
  );
};

export const isDocumentPermissionsResponse = (
  value: unknown
): value is DocumentPermissionsResponse => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.documentId) &&
    Array.isArray(value.permissions) &&
    value.permissions.every((permission) => isDocumentPermissionEntry(permission))
  );
};

export const isDocumentShareResponse = (value: unknown): value is DocumentShareResponse => {
  if (!isRecord(value)) {
    return false;
  }

  return isNonEmptyString(value.documentId) && isDocumentPermissionEntry(value.permission);
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

export const isCollaborationParticipant = (value: unknown): value is CollaborationParticipant => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.displayName) &&
    isCollaborationActivity(value.activity)
  );
};

export const isCollaborationSessionResponse = (
  value: unknown
): value is CollaborationSessionResponse => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.documentId) &&
    isNonEmptyString(value.wsUrl) &&
    isNonEmptyString(value.sessionToken) &&
    typeof value.documentText === "string" &&
    Number.isInteger(value.serverRevision) &&
    Array.isArray(value.presence) &&
    value.presence.every((participant) => isCollaborationParticipant(participant)) &&
    isIsoDateString(value.issuedAt) &&
    isIsoDateString(value.expiresAt)
  );
};

export const isDemoLoginResponse = (value: unknown): value is DemoLoginResponse => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.accessToken) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.displayName) &&
    Array.isArray(value.workspaceIds) &&
    value.workspaceIds.every((workspaceId) => isNonEmptyString(workspaceId)) &&
    isIsoDateString(value.issuedAt) &&
    isIsoDateString(value.expiresAt)
  );
};
