export type UserRole = "owner" | "editor" | "commenter" | "viewer";
export type SharingRole = Extract<UserRole, "owner" | "editor" | "viewer">;

export type AiFeatureType = "rewrite" | "summarize" | "translate" | "restructure";

export type CollaborationActivity = "idle" | "editing";

export type AiJobStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";

export type AiSuggestionDecision = "pending" | "accepted" | "rejected" | "edited" | "undone";

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

export interface DocumentListItem {
  documentId: string;
  workspaceId: string;
  title: string;
  effectiveRole: SharingRole;
  createdAt: string;
  updatedAt: string;
  preview: string;
}

export interface DocumentListResponse {
  documents: DocumentListItem[];
}

export interface DocumentVersionSummary {
  versionId: string;
  versionNumber: number;
  createdAt: string;
  createdByUserId: string;
  basedOnVersionId: string | null;
  isRevert: boolean;
  changeSummary: string;
  title: string;
}

export interface DocumentVersionsResponse {
  documentId: string;
  currentVersionId: string;
  versions: DocumentVersionSummary[];
}

export interface DocumentVersionResponse extends DocumentVersionSummary {
  documentId: string;
  content: DocumentContent;
}

export interface DocumentRestoreResponse {
  documentId: string;
  restoredFromVersionId: string;
  currentVersionId: string;
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

export interface AiSelectionRange {
  start: number;
  end: number;
  text: string;
}

export interface AiRequestContext {
  before: string;
  after: string;
}

export interface CreateAiJobRequest {
  feature: Extract<AiFeatureType, "rewrite" | "summarize">;
  selection: AiSelectionRange;
  context: AiRequestContext;
  instructions: string | null;
}

export interface CreateAiJobResponse {
  jobId: string;
  documentId: string;
  feature: Extract<AiFeatureType, "rewrite" | "summarize">;
  status: AiJobStatus;
  streamUrl: string;
  streamToken: string;
  createdAt: string;
}

export interface AiSuggestionDecisionRequest {
  decision: Exclude<AiSuggestionDecision, "pending">;
  appliedText: string | null;
}

export interface AiHistoryRecord {
  jobId: string;
  documentId: string;
  feature: Extract<AiFeatureType, "rewrite" | "summarize">;
  status: AiJobStatus;
  decision: AiSuggestionDecision;
  requestedBy: {
    userId: string;
    displayName: string;
  };
  selection: AiSelectionRange;
  sourceText: string;
  outputText: string;
  appliedText: string | null;
  instructions: string | null;
  model: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  errorMessage: string | null;
}

export interface AiHistoryResponse {
  documentId: string;
  jobs: AiHistoryRecord[];
}

export interface AiStreamStatusEvent {
  type: "ai.status";
  jobId: string;
  status: AiJobStatus;
  message: string;
}

export interface AiStreamChunkEvent {
  type: "ai.chunk";
  jobId: string;
  delta: string;
  outputText: string;
}

export interface AiStreamCompleteEvent {
  type: "ai.completed";
  jobId: string;
  status: "completed";
  outputText: string;
  completedAt: string;
  model: string;
}

export interface AiStreamCanceledEvent {
  type: "ai.canceled";
  jobId: string;
  status: "canceled";
  outputText: string;
  canceledAt: string;
}

export interface AiStreamFailedEvent {
  type: "ai.failed";
  jobId: string;
  status: "failed";
  outputText: string;
  errorMessage: string;
}

export type AiStreamEvent =
  | AiStreamStatusEvent
  | AiStreamChunkEvent
  | AiStreamCompleteEvent
  | AiStreamCanceledEvent
  | AiStreamFailedEvent;

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

export interface CollaborationServerReloadRequiredMessage {
  type: "server.reload_required";
  reason: "revert_created_new_head";
  documentId: string;
  newVersionId: string;
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
  | CollaborationServerReloadRequiredMessage
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

const isSupportedAiFeature = (
  value: unknown
): value is Extract<AiFeatureType, "rewrite" | "summarize"> =>
  value === "rewrite" || value === "summarize";

const isAiJobStatus = (value: unknown): value is AiJobStatus =>
  value === "queued" ||
  value === "in_progress" ||
  value === "completed" ||
  value === "failed" ||
  value === "canceled";

const isAiSuggestionDecision = (value: unknown): value is AiSuggestionDecision =>
  value === "pending" ||
  value === "accepted" ||
  value === "rejected" ||
  value === "edited" ||
  value === "undone";

export const isAiSelectionRange = (value: unknown): value is AiSelectionRange => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    (value.start as number) >= 0 &&
    (value.end as number) >= (value.start as number) &&
    typeof value.text === "string"
  );
};

export const parseCreateAiJobRequest = (value: unknown): ParseResult<CreateAiJobRequest> => {
  if (!isRecord(value)) {
    return { ok: false, reason: "Request body must be a JSON object." };
  }

  if (!isSupportedAiFeature(value.feature)) {
    return { ok: false, reason: "feature must be either 'rewrite' or 'summarize'." };
  }

  if (!isAiSelectionRange(value.selection)) {
    return { ok: false, reason: "selection must include valid start/end offsets and text." };
  }

  if (value.selection.text.trim().length === 0) {
    return { ok: false, reason: "selection text must not be empty." };
  }

  if (
    !isRecord(value.context) ||
    typeof value.context.before !== "string" ||
    typeof value.context.after !== "string"
  ) {
    return { ok: false, reason: "context must include string before/after fields." };
  }

  if (value.context.before.length > 240 || value.context.after.length > 240) {
    return { ok: false, reason: "context before/after must be 240 characters or fewer." };
  }

  if (value.instructions !== null && typeof value.instructions !== "string") {
    return { ok: false, reason: "instructions must be null or string." };
  }

  return {
    ok: true,
    value: {
      feature: value.feature,
      selection: value.selection,
      context: {
        before: value.context.before,
        after: value.context.after
      },
      instructions: value.instructions
    }
  };
};

export const parseAiSuggestionDecisionRequest = (
  value: unknown
): ParseResult<AiSuggestionDecisionRequest> => {
  if (!isRecord(value)) {
    return { ok: false, reason: "Request body must be a JSON object." };
  }

  if (
    value.decision !== "accepted" &&
    value.decision !== "rejected" &&
    value.decision !== "edited" &&
    value.decision !== "undone"
  ) {
    return { ok: false, reason: "decision must be accepted, rejected, edited, or undone." };
  }

  if (value.appliedText !== null && typeof value.appliedText !== "string") {
    return { ok: false, reason: "appliedText must be null or string." };
  }

  if (
    (value.decision === "accepted" || value.decision === "edited") &&
    typeof value.appliedText !== "string"
  ) {
    return { ok: false, reason: "accepted or edited decisions must include appliedText." };
  }

  return {
    ok: true,
    value: {
      decision: value.decision,
      appliedText: value.appliedText
    }
  };
};

export const parseDemoLoginRequest = (value: unknown): ParseResult<DemoLoginRequest> => {
  if (!isRecord(value)) {
    return { ok: false, reason: "Request body must be a JSON object." };
  }

  const userId = isNonEmptyString(value.userId)
    ? value.userId
    : isNonEmptyString(value.username)
      ? value.username
      : null;
  const { password } = value;

  if (!isNonEmptyString(userId)) {
    return { ok: false, reason: "userId or username must be a non-empty string." };
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

export const isDocumentListItem = (value: unknown): value is DocumentListItem => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.documentId) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.title) &&
    isSharingRole(value.effectiveRole) &&
    isIsoDateString(value.createdAt) &&
    isIsoDateString(value.updatedAt) &&
    typeof value.preview === "string"
  );
};

export const isDocumentListResponse = (value: unknown): value is DocumentListResponse => {
  if (!isRecord(value)) {
    return false;
  }

  return Array.isArray(value.documents) && value.documents.every((entry) => isDocumentListItem(entry));
};

export const isDocumentVersionSummary = (value: unknown): value is DocumentVersionSummary => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.versionId) &&
    Number.isInteger(value.versionNumber) &&
    (value.versionNumber as number) >= 1 &&
    isIsoDateString(value.createdAt) &&
    isNonEmptyString(value.createdByUserId) &&
    (value.basedOnVersionId === null || isNonEmptyString(value.basedOnVersionId)) &&
    typeof value.isRevert === "boolean" &&
    isNonEmptyString(value.changeSummary) &&
    isNonEmptyString(value.title)
  );
};

export const isDocumentVersionsResponse = (value: unknown): value is DocumentVersionsResponse => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.documentId) &&
    isNonEmptyString(value.currentVersionId) &&
    Array.isArray(value.versions) &&
    value.versions.every((version) => isDocumentVersionSummary(version))
  );
};

export const isDocumentVersionResponse = (value: unknown): value is DocumentVersionResponse => {
  if (!isRecord(value) || !isDocumentVersionSummary(value)) {
    return false;
  }

  return isNonEmptyString(value.documentId) && isDocumentContent(value.content);
};

export const isDocumentRestoreResponse = (value: unknown): value is DocumentRestoreResponse => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.documentId) &&
    isNonEmptyString(value.restoredFromVersionId) &&
    isNonEmptyString(value.currentVersionId) &&
    isIsoDateString(value.updatedAt)
  );
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

export const isCreateAiJobResponse = (value: unknown): value is CreateAiJobResponse => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.jobId) &&
    isNonEmptyString(value.documentId) &&
    isSupportedAiFeature(value.feature) &&
    isAiJobStatus(value.status) &&
    isNonEmptyString(value.streamUrl) &&
    isNonEmptyString(value.streamToken) &&
    isIsoDateString(value.createdAt)
  );
};

export const isAiHistoryRecord = (value: unknown): value is AiHistoryRecord => {
  if (!isRecord(value) || !isRecord(value.requestedBy)) {
    return false;
  }

  return (
    isNonEmptyString(value.jobId) &&
    isNonEmptyString(value.documentId) &&
    isSupportedAiFeature(value.feature) &&
    isAiJobStatus(value.status) &&
    isAiSuggestionDecision(value.decision) &&
    isNonEmptyString(value.requestedBy.userId) &&
    isNonEmptyString(value.requestedBy.displayName) &&
    isAiSelectionRange(value.selection) &&
    typeof value.sourceText === "string" &&
    typeof value.outputText === "string" &&
    (value.appliedText === null || typeof value.appliedText === "string") &&
    (value.instructions === null || typeof value.instructions === "string") &&
    isNonEmptyString(value.model) &&
    isIsoDateString(value.createdAt) &&
    isIsoDateString(value.updatedAt) &&
    (value.completedAt === null || isIsoDateString(value.completedAt)) &&
    (value.canceledAt === null || isIsoDateString(value.canceledAt)) &&
    (value.errorMessage === null || typeof value.errorMessage === "string")
  );
};

export const isAiHistoryResponse = (value: unknown): value is AiHistoryResponse => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.documentId) &&
    Array.isArray(value.jobs) &&
    value.jobs.every((job) => isAiHistoryRecord(job))
  );
};
