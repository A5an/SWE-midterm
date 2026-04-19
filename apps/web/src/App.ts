import "./App.css";
import {
  isAiHistoryResponse,
  isApiErrorEnvelope,
  isCollaborationSessionResponse,
  isCreateAiJobResponse,
  isDemoLoginResponse,
  isDocumentDetailResponse,
  isDocumentMetadataResponse,
  type AiHistoryRecord,
  type AiJobStatus,
  type CollaborationParticipant,
  type CreateDocumentRequest,
  type DocumentDetailResponse
} from "@swe-midterm/contracts";
import {
  applySuggestionToDocument,
  buildAiRequestContext,
  describeSelection,
  normalizeEditorSelection,
  type EditorSelectionRange
} from "./ai.ts";

const DEFAULT_API_BASE_URL = "http://localhost:4000";

interface PendingMutation {
  baseRevision: number;
  clientSeq: number;
  mutationId: string;
  text: string;
}

interface ActiveAiJob {
  createdAt: string;
  decision: AiHistoryRecord["decision"];
  documentId: string;
  editMode: boolean;
  feature: "rewrite" | "summarize";
  jobId: string;
  outputText: string;
  selection: EditorSelectionRange;
  sourceText: string;
  status: AiJobStatus;
  streamToken: string;
  streamUrl: string;
}

interface UndoState {
  appliedDocumentText: string;
  jobId: string;
  previousText: string;
  restoredText: string;
}

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const toParagraphText = (document: DocumentDetailResponse): string =>
  document.content.content
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("\n\n")
    .trim();

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const mountApp = (root: HTMLElement): void => {
  const initialApiBase =
    typeof import.meta.env.VITE_API_BASE_URL === "string" &&
    import.meta.env.VITE_API_BASE_URL.trim().length > 0
      ? import.meta.env.VITE_API_BASE_URL.trim()
      : DEFAULT_API_BASE_URL;

  root.innerHTML = `
    <div class="app-shell">
      <header class="hero">
        <p class="eyebrow">Assignment 2 Collaboration + AI Baseline</p>
        <h1>Authenticated Collaboration with Streaming AI Suggestions</h1>
        <p class="summary">
          Create or load a document, collaborate through the shared editor, then invoke AI rewrite or summarize on a selection.
          Suggestions stream progressively, can be canceled, compared, edited, accepted, rejected, undone, and reviewed in per-document history.
        </p>
      </header>

      <section class="panel">
        <h2>API Connection</h2>
        <label class="field-label" for="apiBase">API Base URL</label>
        <input id="apiBase" class="text-input" value="${initialApiBase}" />
        <p class="hint">Default backend URL is http://localhost:4000</p>
      </section>

      <div class="two-column">
        <section class="panel">
          <h2>Create Document</h2>
          <form id="createForm" class="form-grid">
            <label class="field-label" for="workspaceId">Workspace ID</label>
            <input id="workspaceId" class="text-input" value="ws_123" required />

            <label class="field-label" for="title">Title</label>
            <input id="title" class="text-input" value="Realtime Collaboration Baseline" required />

            <label class="field-label" for="paragraph">Initial Text</label>
            <textarea id="paragraph" class="text-area" rows="5">Start editing here and open a second browser window to collaborate.</textarea>

            <button type="submit" class="button button-primary">Create + Load</button>
          </form>
        </section>

        <section class="panel">
          <h2>Load Existing Document</h2>
          <div class="form-grid">
            <label class="field-label" for="documentId">Document ID</label>
            <div class="load-row">
              <input id="documentId" class="text-input" placeholder="doc_xxxxxxxx" />
              <button id="loadButton" class="button button-secondary" type="button">Load</button>
            </div>
            <p class="hint">Use the same document ID in both browser windows.</p>
          </div>
        </section>
      </div>

      <section class="panel">
        <h2>Demo Login</h2>
        <div class="three-column">
          <div class="form-grid">
            <label class="field-label" for="userId">User ID</label>
            <input id="userId" class="text-input" value="usr_assanali" />
          </div>
          <div class="form-grid">
            <label class="field-label" for="password">Password</label>
            <input id="password" class="text-input" type="password" value="demo-assanali" />
          </div>
          <div class="button-row">
            <button id="loginButton" class="button button-primary" type="button">Sign In</button>
            <button id="logoutButton" class="button button-ghost" type="button">Clear Auth</button>
          </div>
        </div>
        <p class="hint">
          Demo credentials: <code>usr_assanali</code> / <code>demo-assanali</code>,
          <code>usr_alaa</code> / <code>demo-alaa</code>, <code>usr_dachi</code> / <code>demo-dachi</code>,
          <code>usr_editor</code> / <code>demo-editor</code>, <code>usr_viewer</code> / <code>demo-viewer</code>.
        </p>

        <div class="session-bar">
          <div>
            <span class="field-label">Auth</span>
            <p id="authState" class="session-value">Signed out</p>
          </div>
          <div>
            <span class="field-label">Identity</span>
            <p id="authIdentity" class="session-value">No authenticated API identity</p>
          </div>
          <div>
            <span class="field-label">Workspace Access</span>
            <p id="authWorkspaces" class="session-value">-</p>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>Collaboration Session</h2>
        <p class="hint">
          Session bootstrap requires the signed API access token from Demo Login. The server then
          issues a short-lived WebSocket session token for the document.
        </p>
        <div class="button-row">
            <button id="joinButton" class="button button-primary" type="button">Join Session</button>
            <button id="disconnectButton" class="button button-ghost" type="button">Disconnect</button>
            <button id="reconnectButton" class="button button-secondary" type="button">Reconnect</button>
        </div>

        <div class="session-bar">
          <div>
            <span class="field-label">Connection</span>
            <p id="connectionState" class="session-value">Not connected</p>
          </div>
          <div>
            <span class="field-label">Session</span>
            <p id="sessionState" class="session-value">No active session</p>
          </div>
          <div>
            <span class="field-label">Server Revision</span>
            <p id="revisionState" class="session-value">0</p>
          </div>
        </div>

        <div class="two-column">
          <div>
            <h3>Online Users</h3>
            <ul id="presenceList" class="presence-list">
              <li class="presence-empty">Join a session to see presence.</li>
            </ul>
          </div>
          <div>
            <h3>Editor</h3>
            <textarea id="collabEditor" class="editor" rows="14" disabled placeholder="Load a document, join a session, then type here."></textarea>
            <p class="hint">If you disconnect, keep typing here. Reconnect will resync your latest local draft.</p>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>AI Assistant</h2>
        <div class="two-column ai-grid">
          <div class="form-grid">
            <label class="field-label" for="aiInstructions">Optional instructions</label>
            <textarea id="aiInstructions" class="text-area" rows="4" placeholder="Example: make it more concise and formal."></textarea>
            <p id="aiSelectionState" class="hint">Load a document to select text for AI.</p>
            <div class="button-row button-row-left">
              <button id="rewriteButton" class="button button-primary" type="button">Rewrite Selection</button>
              <button id="summarizeButton" class="button button-secondary" type="button">Summarize Selection</button>
              <button id="cancelAiButton" class="button button-ghost" type="button">Cancel Stream</button>
            </div>
            <div class="ai-job-summary">
              <span class="field-label">AI Job</span>
              <p id="aiJobState" class="session-value">No active AI request.</p>
            </div>
          </div>

          <div class="two-column compare-grid">
            <div class="form-grid">
              <label class="field-label" for="aiOriginal">Original</label>
              <textarea id="aiOriginal" class="compare-textarea" rows="10" readonly></textarea>
            </div>
            <div class="form-grid">
              <label class="field-label" for="aiSuggestion">Suggestion</label>
              <textarea id="aiSuggestion" class="compare-textarea" rows="10" readonly></textarea>
            </div>
          </div>
        </div>

        <div class="button-row button-row-left">
          <button id="editAiButton" class="button button-secondary" type="button">Edit Suggestion</button>
          <button id="acceptAiButton" class="button button-primary" type="button">Accept</button>
          <button id="rejectAiButton" class="button button-ghost" type="button">Reject</button>
          <button id="undoAiButton" class="button button-secondary" type="button">Undo Last AI Apply</button>
        </div>

        <h3>History</h3>
        <ul id="aiHistoryList" class="history-list">
          <li class="history-empty">No AI history for this document yet.</li>
        </ul>
      </section>

      <section class="panel">
        <h2>Status</h2>
        <pre id="status" class="status">Ready.</pre>
      </section>

      <section class="panel">
        <h2>Loaded Document</h2>
        <pre id="documentOutput" class="output">No document loaded yet.</pre>
      </section>
    </div>
  `;

  const apiBaseInput = root.querySelector<HTMLInputElement>("#apiBase");
  const createForm = root.querySelector<HTMLFormElement>("#createForm");
  const workspaceIdInput = root.querySelector<HTMLInputElement>("#workspaceId");
  const titleInput = root.querySelector<HTMLInputElement>("#title");
  const paragraphInput = root.querySelector<HTMLTextAreaElement>("#paragraph");
  const documentIdInput = root.querySelector<HTMLInputElement>("#documentId");
  const loadButton = root.querySelector<HTMLButtonElement>("#loadButton");
  const userIdInput = root.querySelector<HTMLInputElement>("#userId");
  const passwordInput = root.querySelector<HTMLInputElement>("#password");
  const loginButton = root.querySelector<HTMLButtonElement>("#loginButton");
  const logoutButton = root.querySelector<HTMLButtonElement>("#logoutButton");
  const authState = root.querySelector<HTMLElement>("#authState");
  const authIdentity = root.querySelector<HTMLElement>("#authIdentity");
  const authWorkspaces = root.querySelector<HTMLElement>("#authWorkspaces");
  const joinButton = root.querySelector<HTMLButtonElement>("#joinButton");
  const disconnectButton = root.querySelector<HTMLButtonElement>("#disconnectButton");
  const reconnectButton = root.querySelector<HTMLButtonElement>("#reconnectButton");
  const connectionState = root.querySelector<HTMLElement>("#connectionState");
  const sessionState = root.querySelector<HTMLElement>("#sessionState");
  const revisionState = root.querySelector<HTMLElement>("#revisionState");
  const presenceList = root.querySelector<HTMLUListElement>("#presenceList");
  const collabEditor = root.querySelector<HTMLTextAreaElement>("#collabEditor");
  const aiInstructions = root.querySelector<HTMLTextAreaElement>("#aiInstructions");
  const aiSelectionState = root.querySelector<HTMLElement>("#aiSelectionState");
  const rewriteButton = root.querySelector<HTMLButtonElement>("#rewriteButton");
  const summarizeButton = root.querySelector<HTMLButtonElement>("#summarizeButton");
  const cancelAiButton = root.querySelector<HTMLButtonElement>("#cancelAiButton");
  const editAiButton = root.querySelector<HTMLButtonElement>("#editAiButton");
  const acceptAiButton = root.querySelector<HTMLButtonElement>("#acceptAiButton");
  const rejectAiButton = root.querySelector<HTMLButtonElement>("#rejectAiButton");
  const undoAiButton = root.querySelector<HTMLButtonElement>("#undoAiButton");
  const aiJobState = root.querySelector<HTMLElement>("#aiJobState");
  const aiOriginal = root.querySelector<HTMLTextAreaElement>("#aiOriginal");
  const aiSuggestion = root.querySelector<HTMLTextAreaElement>("#aiSuggestion");
  const aiHistoryList = root.querySelector<HTMLUListElement>("#aiHistoryList");
  const statusOutput = root.querySelector<HTMLElement>("#status");
  const documentOutput = root.querySelector<HTMLElement>("#documentOutput");

  if (
    !apiBaseInput ||
    !createForm ||
    !workspaceIdInput ||
    !titleInput ||
    !paragraphInput ||
    !documentIdInput ||
    !loadButton ||
    !userIdInput ||
    !passwordInput ||
    !loginButton ||
    !logoutButton ||
    !authState ||
    !authIdentity ||
    !authWorkspaces ||
    !joinButton ||
    !disconnectButton ||
    !reconnectButton ||
    !connectionState ||
    !sessionState ||
    !revisionState ||
    !presenceList ||
    !collabEditor ||
    !aiInstructions ||
    !aiSelectionState ||
    !rewriteButton ||
    !summarizeButton ||
    !cancelAiButton ||
    !editAiButton ||
    !acceptAiButton ||
    !rejectAiButton ||
    !undoAiButton ||
    !aiJobState ||
    !aiOriginal ||
    !aiSuggestion ||
    !aiHistoryList ||
    !statusOutput ||
    !documentOutput
  ) {
    throw new Error("Failed to initialize collaboration UI.");
  }

  let currentDocument: DocumentDetailResponse | null = null;
  let currentServerRevision = 0;
  let reconnectTimer: number | null = null;
  let sendTimer: number | null = null;
  let typingIdleTimer: number | null = null;
  let authSession:
    | {
        accessToken: string;
        displayName: string;
        userId: string;
        workspaceIds: string[];
      }
    | null = null;
  let pendingMutation: PendingMutation | null = null;
  let sessionInfo:
    | {
        documentId: string;
        sessionId: string;
        sessionToken: string;
        wsUrl: string;
      }
    | null = null;
  let socket: WebSocket | null = null;
  let hasConnectedOnce = false;
  let manualDisconnect = false;
  let nextClientSeq = 1;
  let currentAiJob: ActiveAiJob | null = null;
  let aiHistory: AiHistoryRecord[] = [];
  let aiStream: EventSource | null = null;
  let lastAiUndo: UndoState | null = null;

  const setStatus = (message: string): void => {
    statusOutput.textContent = message;
  };

  const currentApiBase = (): string => apiBaseInput.value.trim().replace(/\/+$/, "");

  const currentAuthHeaders = (includeJson = false): Record<string, string> => {
    const headers: Record<string, string> = {};

    if (includeJson) {
      headers["Content-Type"] = "application/json";
    }

    if (authSession) {
      headers.Authorization = `Bearer ${authSession.accessToken}`;
    }

    return headers;
  };

  const updateRevisionState = (revision: number): void => {
    currentServerRevision = revision;
    revisionState.textContent = String(revision);
  };

  const updateAuthState = (): void => {
    authState.textContent = authSession ? "Signed in" : "Signed out";
    authIdentity.textContent = authSession
      ? `${authSession.displayName} (${authSession.userId})`
      : "No authenticated API identity";
    authWorkspaces.textContent = authSession ? authSession.workspaceIds.join(", ") : "-";
  };

  const renderDocument = (document: DocumentDetailResponse): void => {
    documentOutput.textContent = JSON.stringify(
      {
        documentId: document.documentId,
        workspaceId: document.workspaceId,
        title: document.title,
        ownerRole: document.ownerRole,
        currentVersionId: document.currentVersionId,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        contentText: toParagraphText(document)
      },
      null,
      2
    );
  };

  const syncDocumentFromEditor = (): void => {
    if (!currentDocument) {
      return;
    }

    currentDocument.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          text: collabEditor.value
        }
      ]
    };
    currentDocument.updatedAt = new Date().toISOString();
    renderDocument(currentDocument);
  };

  const handleApiFailure = (prefix: string, payload: unknown): void => {
    if (isApiErrorEnvelope(payload)) {
      setStatus(
        `${prefix}: ${payload.error.code} - ${payload.error.message} (requestId: ${payload.error.requestId})`
      );
      return;
    }
    setStatus(`${prefix}: unexpected response format.`);
  };

  const renderPresence = (participants: CollaborationParticipant[]): void => {
    if (participants.length === 0) {
      presenceList.innerHTML = `<li class="presence-empty">No collaborators online.</li>`;
      return;
    }

    presenceList.innerHTML = participants
      .map(
        (participant) => `
          <li class="presence-item">
            <strong>${escapeHtml(participant.displayName)}</strong>
            <span>${escapeHtml(participant.userId)}</span>
            <span class="presence-pill">${escapeHtml(participant.activity)}</span>
          </li>
        `
      )
      .join("");
  };

  const renderAiHistory = (): void => {
    if (!currentDocument) {
      aiHistoryList.innerHTML = `<li class="history-empty">Load a document to view AI history.</li>`;
      return;
    }

    if (!authSession) {
      aiHistoryList.innerHTML = `<li class="history-empty">Sign in to load AI history for this document.</li>`;
      return;
    }

    if (aiHistory.length === 0) {
      aiHistoryList.innerHTML = `<li class="history-empty">No AI history for this document yet.</li>`;
      return;
    }

    aiHistoryList.innerHTML = aiHistory
      .map(
        (job) => `
          <li class="history-item">
            <div class="history-row">
              <strong>${escapeHtml(job.feature)}</strong>
              <span class="history-pill">${escapeHtml(job.status)}</span>
              <span class="history-pill history-pill-muted">${escapeHtml(job.decision)}</span>
            </div>
            <div class="history-meta">
              <span>${escapeHtml(job.requestedBy.displayName)}</span>
              <span>${escapeHtml(new Date(job.createdAt).toLocaleString())}</span>
              <span>${escapeHtml(job.model)}</span>
            </div>
            <p class="history-snippet">${escapeHtml(job.outputText || "(no output yet)")}</p>
          </li>
        `
      )
      .join("");
  };

  const updateSessionState = (): void => {
    sessionState.textContent = sessionInfo
      ? `${sessionInfo.sessionId} on ${sessionInfo.documentId}`
      : "No active session";
  };

  const setEditorEnabled = (enabled: boolean): void => {
    collabEditor.disabled = !enabled;
  };

  const updateConnectionState = (message: string): void => {
    connectionState.textContent = message;
  };

  const currentSelection = (): EditorSelectionRange =>
    normalizeEditorSelection(collabEditor.value, collabEditor.selectionStart, collabEditor.selectionEnd);

  const renderAiState = (): void => {
    const selection = currentSelection();
    aiSelectionState.textContent = !currentDocument
      ? "Load a document to select text for AI."
      : !sessionInfo
        ? "Join a collaboration session before starting AI so accepted changes persist to the shared document."
        : `Current AI scope: ${describeSelection(selection)}`;

    aiOriginal.value = currentAiJob ? currentAiJob.selection.text : "";
    aiSuggestion.value = currentAiJob ? currentAiJob.outputText : "";
    aiSuggestion.readOnly = !(currentAiJob?.editMode ?? false);

    if (!currentAiJob) {
      aiJobState.textContent = "No active AI request.";
    } else {
      aiJobState.textContent = `${currentAiJob.feature} ${currentAiJob.status} / decision ${currentAiJob.decision} on ${describeSelection(currentAiJob.selection)}`;
    }

    const hasDocument = currentDocument !== null;
    const hasActiveSession = sessionInfo !== null;
    const generationActive =
      currentAiJob?.status === "queued" || currentAiJob?.status === "in_progress";
    const canUseAi = hasDocument && authSession !== null && hasActiveSession && !generationActive;
    const decisionPending = currentAiJob?.decision === "pending";
    const canResolveSuggestion =
      currentAiJob?.status === "completed" &&
      currentAiJob.outputText.trim().length > 0 &&
      decisionPending;
    const canUndoSuggestion =
      (currentAiJob?.decision === "accepted" || currentAiJob?.decision === "edited") &&
      lastAiUndo !== null;

    rewriteButton.disabled = !canUseAi;
    summarizeButton.disabled = !canUseAi;
    cancelAiButton.disabled = !generationActive;
    editAiButton.disabled = !canResolveSuggestion;
    acceptAiButton.disabled = !canResolveSuggestion;
    rejectAiButton.disabled = !canResolveSuggestion;
    undoAiButton.disabled = !canUndoSuggestion;
  };

  const closeAiStream = (): void => {
    if (aiStream) {
      aiStream.close();
      aiStream = null;
    }
  };

  const refreshAiHistory = async (): Promise<void> => {
    if (!currentDocument || !authSession) {
      aiHistory = [];
      renderAiHistory();
      return;
    }

    const response = await fetch(
      `${currentApiBase()}/v1/documents/${encodeURIComponent(currentDocument.documentId)}/ai/jobs`,
      {
        headers: currentAuthHeaders()
      }
    );
    const payload = await readJson(response);

    if (!response.ok) {
      handleApiFailure("AI history load failed", payload);
      aiHistory = [];
      renderAiHistory();
      return;
    }

    if (!isAiHistoryResponse(payload)) {
      setStatus("AI history load failed: backend response does not match expected history contract.");
      aiHistory = [];
      renderAiHistory();
      return;
    }

    aiHistory = payload.jobs;
    renderAiHistory();
  };

  const recordAiDecision = async (
    decision: "accepted" | "rejected" | "edited" | "undone",
    appliedText: string | null
  ): Promise<void> => {
    if (!currentDocument || !currentAiJob || !authSession) {
      return;
    }

    const response = await fetch(
      `${currentApiBase()}/v1/documents/${encodeURIComponent(currentDocument.documentId)}/ai/jobs/${encodeURIComponent(currentAiJob.jobId)}/decision`,
      {
        method: "POST",
        headers: currentAuthHeaders(true),
        body: JSON.stringify({
          decision,
          appliedText
        })
      }
    );
    const payload = await readJson(response);

    if (!response.ok) {
      handleApiFailure("AI decision save failed", payload);
      return;
    }

    currentAiJob.decision = decision;
    await refreshAiHistory();
  };

  const syncSelectionStatus = (): void => {
    renderAiState();
  };

  const syncEditorAfterProgrammaticChange = (): void => {
    syncDocumentFromEditor();
    if (sessionInfo) {
      queueOrSendLatestText();
    }
    syncSelectionStatus();
  };

  const applyCurrentAiSuggestion = async (decision: "accepted" | "edited"): Promise<void> => {
    if (!currentDocument || !currentAiJob) {
      setStatus("No AI suggestion is available to apply.");
      return;
    }

    if (currentAiJob.status !== "completed") {
      setStatus("AI suggestion can only be applied after the stream completes.");
      return;
    }

    if (collabEditor.value !== currentAiJob.sourceText) {
      setStatus("AI suggestion is stale because the document changed after generation. Regenerate on the latest text.");
      return;
    }

    const replacementText = aiSuggestion.value;
    const previousText = collabEditor.value;
    const nextText = applySuggestionToDocument(previousText, currentAiJob.selection, replacementText);
    lastAiUndo = {
      jobId: currentAiJob.jobId,
      appliedDocumentText: nextText,
      previousText,
      restoredText: currentAiJob.selection.text
    };
    collabEditor.value = nextText;
    syncEditorAfterProgrammaticChange();
    currentAiJob.editMode = false;
    currentAiJob.outputText = replacementText;
    await recordAiDecision(decision, replacementText);
    renderAiState();
    setStatus(
      decision === "edited"
        ? "Edited AI suggestion applied to the document."
        : "AI suggestion accepted and applied to the document."
    );
  };

  const undoLastAiApply = async (): Promise<void> => {
    if (!currentAiJob || !lastAiUndo) {
      setStatus("No AI apply action is available to undo.");
      return;
    }

    if (collabEditor.value !== lastAiUndo.appliedDocumentText) {
      setStatus("Undo blocked because the document changed after the AI suggestion was applied.");
      return;
    }

    collabEditor.value = lastAiUndo.previousText;
    syncEditorAfterProgrammaticChange();
    await recordAiDecision("undone", lastAiUndo.restoredText);
    lastAiUndo = null;
    renderAiState();
    setStatus("Last AI apply action was undone.");
  };

  const openAiStream = (job: ActiveAiJob): void => {
    closeAiStream();
    const source = new EventSource(`${job.streamUrl}?token=${encodeURIComponent(job.streamToken)}`);
    aiStream = source;

    const handleTypedEvent = (eventName: string, rawEvent: MessageEvent<string>): void => {
      if (!currentAiJob || currentAiJob.jobId !== job.jobId) {
        return;
      }

      let payload: unknown;

      try {
        payload = JSON.parse(rawEvent.data) as unknown;
      } catch {
        setStatus("Received malformed AI stream event.");
        return;
      }

      if (typeof payload !== "object" || payload === null || !("jobId" in payload)) {
        setStatus("Received unexpected AI stream event.");
        return;
      }

      const typedPayload = payload as {
        canceledAt?: string;
        completedAt?: string;
        errorMessage?: string;
        outputText?: string;
        status?: AiJobStatus;
      };

      if (eventName === "ai.status" && typedPayload.status) {
        currentAiJob.status = typedPayload.status;
        renderAiState();
        return;
      }

      if (eventName === "ai.chunk" && typeof typedPayload.outputText === "string") {
        currentAiJob.outputText = typedPayload.outputText;
        renderAiState();
        setStatus(`AI stream updated for ${currentAiJob.feature}.`);
        return;
      }

      if (eventName === "ai.completed" && typeof typedPayload.outputText === "string") {
        currentAiJob.outputText = typedPayload.outputText;
        currentAiJob.status = "completed";
        closeAiStream();
        renderAiState();
        void refreshAiHistory();
        setStatus("AI stream completed. Review the suggestion, then accept, reject, or edit it.");
        return;
      }

      if (eventName === "ai.canceled") {
        currentAiJob.status = "canceled";
        if (typeof typedPayload.outputText === "string") {
          currentAiJob.outputText = typedPayload.outputText;
        }
        closeAiStream();
        renderAiState();
        void refreshAiHistory();
        setStatus("AI stream canceled.");
        return;
      }

      if (eventName === "ai.failed") {
        currentAiJob.status = "failed";
        closeAiStream();
        renderAiState();
        void refreshAiHistory();
        setStatus(
          `AI stream failed${typedPayload.errorMessage ? `: ${typedPayload.errorMessage}` : "."}`
        );
      }
    };

    source.addEventListener("ai.status", (event) => {
      handleTypedEvent("ai.status", event as MessageEvent<string>);
    });
    source.addEventListener("ai.chunk", (event) => {
      handleTypedEvent("ai.chunk", event as MessageEvent<string>);
    });
    source.addEventListener("ai.completed", (event) => {
      handleTypedEvent("ai.completed", event as MessageEvent<string>);
    });
    source.addEventListener("ai.canceled", (event) => {
      handleTypedEvent("ai.canceled", event as MessageEvent<string>);
    });
    source.addEventListener("ai.failed", (event) => {
      handleTypedEvent("ai.failed", event as MessageEvent<string>);
    });
    source.onerror = () => {
      if (currentAiJob?.status === "queued" || currentAiJob?.status === "in_progress") {
        setStatus("AI stream connection dropped before completion.");
      }
      closeAiStream();
    };
  };

  const startAiJob = async (feature: "rewrite" | "summarize"): Promise<void> => {
    if (!currentDocument) {
      setStatus("AI request blocked: load a document first.");
      return;
    }

    if (!authSession) {
      setStatus("AI request blocked: sign in first.");
      return;
    }

    if (!sessionInfo) {
      setStatus("AI request blocked: join a collaboration session first so accepted changes are persisted.");
      return;
    }

    if (currentAiJob && (currentAiJob.status === "queued" || currentAiJob.status === "in_progress")) {
      setStatus("Only one in-flight AI request is supported in this baseline. Cancel the current stream first.");
      return;
    }

    const selection = currentSelection();
    setStatus(`Starting AI ${feature} for ${describeSelection(selection)}...`);

    const response = await fetch(
      `${currentApiBase()}/v1/documents/${encodeURIComponent(currentDocument.documentId)}/ai/jobs`,
      {
        method: "POST",
        headers: currentAuthHeaders(true),
        body: JSON.stringify({
          feature,
          selection,
          context: buildAiRequestContext(collabEditor.value, selection),
          instructions: aiInstructions.value.trim() || null
        })
      }
    );
    const payload = await readJson(response);

    if (!response.ok) {
      handleApiFailure("AI request failed", payload);
      return;
    }

    if (!isCreateAiJobResponse(payload)) {
      setStatus("AI request failed: backend response does not match expected AI job contract.");
      return;
    }

    currentAiJob = {
      createdAt: payload.createdAt,
      decision: "pending",
      documentId: payload.documentId,
      editMode: false,
      feature,
      jobId: payload.jobId,
      outputText: "",
      selection,
      sourceText: collabEditor.value,
      status: payload.status,
      streamToken: payload.streamToken,
      streamUrl: payload.streamUrl
    };
    aiOriginal.value = selection.text;
    aiSuggestion.value = "";
    renderAiState();
    void refreshAiHistory();
    openAiStream(currentAiJob);
  };

  const cancelAiJob = async (): Promise<void> => {
    if (!currentDocument || !currentAiJob || !authSession) {
      setStatus("No active AI stream to cancel.");
      return;
    }

    const response = await fetch(
      `${currentApiBase()}/v1/documents/${encodeURIComponent(currentDocument.documentId)}/ai/jobs/${encodeURIComponent(currentAiJob.jobId)}/cancel`,
      {
        method: "POST",
        headers: currentAuthHeaders()
      }
    );
    const payload = await readJson(response);

    if (!response.ok) {
      handleApiFailure("AI cancel failed", payload);
      return;
    }

    currentAiJob.status = "canceled";
    closeAiStream();
    renderAiState();
    await refreshAiHistory();
    setStatus("AI cancel request sent.");
  };

  const resetAiState = (): void => {
    closeAiStream();
    currentAiJob = null;
    lastAiUndo = null;
    aiOriginal.value = "";
    aiSuggestion.value = "";
    aiHistory = [];
    renderAiHistory();
    renderAiState();
  };

  const resetPresence = (): void => {
    presenceList.innerHTML = `<li class="presence-empty">Join a session to see presence.</li>`;
  };

  const clearReconnectTimer = (): void => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearSendTimer = (): void => {
    if (sendTimer !== null) {
      window.clearTimeout(sendTimer);
      sendTimer = null;
    }
  };

  const clearTypingTimer = (): void => {
    if (typingIdleTimer !== null) {
      window.clearTimeout(typingIdleTimer);
      typingIdleTimer = null;
    }
  };

  const closeSocket = (): void => {
    if (socket) {
      socket.close();
      socket = null;
    }
  };

  const sendPresence = (activity: CollaborationParticipant["activity"]): void => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !sessionInfo) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "client.presence",
        sessionId: sessionInfo.sessionId,
        activity
      })
    );
  };

  const sendMutation = (mutation: PendingMutation): void => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !sessionInfo) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "client.update",
        sessionId: sessionInfo.sessionId,
        clientSeq: mutation.clientSeq,
        mutationId: mutation.mutationId,
        baseRevision: mutation.baseRevision,
        text: mutation.text
      })
    );
  };

  const buildPendingMutation = (baseRevision: number): PendingMutation => ({
    baseRevision,
    clientSeq: nextClientSeq++,
    mutationId: crypto.randomUUID(),
    text: collabEditor.value
  });

  const queueOrSendLatestText = (baseRevision = currentServerRevision): void => {
    if (!sessionInfo) {
      syncDocumentFromEditor();
      return;
    }

    pendingMutation = pendingMutation?.text === collabEditor.value ? pendingMutation : buildPendingMutation(baseRevision);
    pendingMutation.baseRevision = baseRevision;
    pendingMutation.text = collabEditor.value;
    syncDocumentFromEditor();

    if (socket && socket.readyState === WebSocket.OPEN) {
      sendMutation(pendingMutation);
      setStatus(
        `Sent local draft ${pendingMutation.mutationId.slice(0, 8)} at base revision ${pendingMutation.baseRevision}.`
      );
    } else {
      setStatus("Connection offline. Local edits are queued and will resync on reconnect.");
      updateConnectionState("Offline with local draft");
    }
  };

  const scheduleReconnect = (): void => {
    if (!sessionInfo || manualDisconnect || reconnectTimer !== null) {
      return;
    }

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connectWebSocket(true);
    }, 1200);
  };

  const connectWebSocket = (isReconnect: boolean): void => {
    if (!sessionInfo) {
      return;
    }

    clearReconnectTimer();
    closeSocket();
    updateConnectionState(isReconnect ? "Reconnecting..." : "Connecting...");
    setStatus(isReconnect ? "Reconnecting WebSocket session..." : "Opening WebSocket session...");

    const nextSocket = new WebSocket(
      `${sessionInfo.wsUrl}?token=${encodeURIComponent(sessionInfo.sessionToken)}`
    );
    socket = nextSocket;

    nextSocket.addEventListener("open", () => {
      updateConnectionState(isReconnect ? "Reconnected" : "Connected");
      updateSessionState();
      setStatus(isReconnect ? "Reconnected. Waiting for bootstrap state..." : "Connected. Waiting for bootstrap state...");
    });

    nextSocket.addEventListener("message", (event) => {
      let message: unknown;

      try {
        message = JSON.parse(String(event.data)) as unknown;
      } catch {
        setStatus("Received invalid WebSocket payload.");
        return;
      }

      if (typeof message !== "object" || message === null || !("type" in message)) {
        setStatus("Received unexpected WebSocket message shape.");
        return;
      }

      const typedMessage = message as { type: string };

      if (typedMessage.type === "server.bootstrap") {
        const bootstrap = message as unknown as {
          participants: CollaborationParticipant[];
          serverRevision: number;
          text: string;
        };

        renderPresence(bootstrap.participants);
        updateRevisionState(bootstrap.serverRevision);

        const hadLocalDraft =
          hasConnectedOnce && (pendingMutation !== null || collabEditor.value !== bootstrap.text);

        if (!hadLocalDraft) {
          collabEditor.value = bootstrap.text;
          syncDocumentFromEditor();
        } else {
          setStatus("Reconnected with a local draft. Resyncing latest text now.");
        }

        hasConnectedOnce = true;

        if (pendingMutation) {
          pendingMutation.baseRevision = bootstrap.serverRevision;
          sendMutation(pendingMutation);
        } else if (collabEditor.value !== bootstrap.text) {
          queueOrSendLatestText(bootstrap.serverRevision);
        }

        syncSelectionStatus();
        return;
      }

      if (typedMessage.type === "server.presence") {
        const presence = message as unknown as { participants: CollaborationParticipant[] };
        renderPresence(presence.participants);
        return;
      }

      if (typedMessage.type === "server.ack") {
        const ack = message as unknown as {
          mutationId: string;
          serverRevision: number;
          text: string;
        };

        updateRevisionState(ack.serverRevision);
        collabEditor.value = ack.text;
        syncDocumentFromEditor();

        if (pendingMutation && pendingMutation.mutationId === ack.mutationId) {
          pendingMutation = null;
        }

        syncSelectionStatus();
        setStatus(
          `Server acknowledged mutation ${ack.mutationId.slice(0, 8)} at revision ${ack.serverRevision}.`
        );
        return;
      }

      if (typedMessage.type === "server.update") {
        const update = message as unknown as {
          authorUserId: string;
          serverRevision: number;
          text: string;
        };

        updateRevisionState(update.serverRevision);
        collabEditor.value = update.text;
        syncDocumentFromEditor();
        syncSelectionStatus();
        setStatus(
          `Remote update from ${update.authorUserId} applied at revision ${update.serverRevision}.`
        );
        return;
      }

      if (typedMessage.type === "server.error") {
        const errorMessage = message as unknown as { code: string; message: string };
        setStatus(`WebSocket error: ${errorMessage.code} - ${errorMessage.message}`);
      }
    });

    nextSocket.addEventListener("close", () => {
      if (socket !== nextSocket) {
        return;
      }

      socket = null;
      updateConnectionState(manualDisconnect ? "Disconnected" : "Disconnected, retrying...");
      if (!manualDisconnect) {
        setStatus("WebSocket closed unexpectedly. Scheduling reconnect...");
        scheduleReconnect();
      }
    });

    nextSocket.addEventListener("error", () => {
      setStatus("WebSocket connection failed.");
    });
  };

  const resetCollaboration = (clearEditor: boolean): void => {
    manualDisconnect = true;
    clearReconnectTimer();
    clearSendTimer();
    clearTypingTimer();
    closeSocket();
    pendingMutation = null;
    sessionInfo = null;
    hasConnectedOnce = false;
    nextClientSeq = 1;
    updateConnectionState("Not connected");
    updateSessionState();
    updateRevisionState(0);
    resetPresence();
    setEditorEnabled(false);
    if (clearEditor) {
      collabEditor.value = "";
    }
  };

  const loadDocumentById = async (documentId: string): Promise<void> => {
    if (!documentId.trim()) {
      setStatus("Load blocked: document ID is required.");
      return;
    }

    setStatus(`Loading ${documentId}...`);
    const response = await fetch(`${currentApiBase()}/v1/documents/${encodeURIComponent(documentId)}`, {
      headers: currentAuthHeaders()
    });
    const payload = await readJson(response);

    if (!response.ok) {
      handleApiFailure("Load failed", payload);
      return;
    }

    if (!isDocumentDetailResponse(payload)) {
      setStatus("Load failed: backend response does not match expected document detail contract.");
      return;
    }

    currentDocument = payload;
    documentIdInput.value = payload.documentId;
    collabEditor.value = toParagraphText(payload);
    renderDocument(payload);
    setStatus(`Loaded ${payload.documentId} successfully.`);

    if (!sessionInfo || sessionInfo.documentId !== payload.documentId) {
      resetCollaboration(false);
      collabEditor.value = toParagraphText(payload);
    }

    resetAiState();
    syncSelectionStatus();
    await refreshAiHistory();
  };

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const requestBody: CreateDocumentRequest = {
      workspaceId: workspaceIdInput.value.trim(),
      title: titleInput.value.trim(),
      templateId: null,
      initialContent: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            text: paragraphInput.value
          }
        ]
      }
    };

    setStatus("Creating document...");

    const response = await fetch(`${currentApiBase()}/v1/documents`, {
      method: "POST",
      headers: currentAuthHeaders(true),
      body: JSON.stringify(requestBody)
    });

    const payload = await readJson(response);

    if (!response.ok) {
      handleApiFailure("Create failed", payload);
      return;
    }

    if (!isDocumentMetadataResponse(payload)) {
      setStatus("Create failed: backend response does not match expected metadata contract.");
      return;
    }

    documentIdInput.value = payload.documentId;
    setStatus(`Created ${payload.documentId}. Loading full detail...`);
    await loadDocumentById(payload.documentId);
  });

  loadButton.addEventListener("click", async () => {
    await loadDocumentById(documentIdInput.value);
  });

  loginButton.addEventListener("click", async () => {
    setStatus("Signing in with demo credentials...");

    const response = await fetch(`${currentApiBase()}/v1/auth/demo-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userId: userIdInput.value.trim(),
        password: passwordInput.value
      })
    });
    const payload = await readJson(response);

    if (!response.ok) {
      handleApiFailure("Demo login failed", payload);
      return;
    }

    if (!isDemoLoginResponse(payload)) {
      setStatus("Demo login failed: backend response does not match auth contract.");
      return;
    }

    authSession = {
      accessToken: payload.accessToken,
      displayName: payload.displayName,
      userId: payload.userId,
      workspaceIds: payload.workspaceIds
    };
    updateAuthState();

    if (sessionInfo) {
      resetCollaboration(false);
      collabEditor.value = currentDocument ? toParagraphText(currentDocument) : collabEditor.value;
    }

    await refreshAiHistory();
    renderAiState();
    setStatus(
      `Signed in as ${payload.displayName}. Session bootstrap is now authorized for workspaces: ${payload.workspaceIds.join(", ")}.`
    );
  });

  logoutButton.addEventListener("click", () => {
    authSession = null;
    updateAuthState();
    if (sessionInfo) {
      resetCollaboration(false);
      collabEditor.value = currentDocument ? toParagraphText(currentDocument) : collabEditor.value;
    }
    resetAiState();
    setStatus("Signed out. Sign in again before starting a collaboration session or AI request.");
  });

  joinButton.addEventListener("click", async () => {
    const documentId = documentIdInput.value.trim();

    if (!documentId) {
      setStatus("Join blocked: load or create a document first.");
      return;
    }

    if (!authSession) {
      setStatus("Join blocked: sign in first so the API can authorize session bootstrap.");
      return;
    }

    manualDisconnect = false;

    const response = await fetch(`${currentApiBase()}/v1/documents/${encodeURIComponent(documentId)}/sessions`, {
      method: "POST",
      headers: currentAuthHeaders(true),
      body: JSON.stringify({})
    });
    const payload = await readJson(response);

    if (!response.ok) {
      handleApiFailure("Session start failed", payload);
      return;
    }

    if (!isCollaborationSessionResponse(payload)) {
      setStatus("Session start failed: backend response does not match collaboration session contract.");
      return;
    }

    sessionInfo = {
      documentId: payload.documentId,
      sessionId: payload.sessionId,
      sessionToken: payload.sessionToken,
      wsUrl: payload.wsUrl
    };
    updateSessionState();
    updateRevisionState(payload.serverRevision);
    setEditorEnabled(true);
    renderPresence(payload.presence);
    if (!currentDocument || currentDocument.documentId !== payload.documentId) {
      await loadDocumentById(payload.documentId);
    }
    connectWebSocket(false);
  });

  disconnectButton.addEventListener("click", () => {
    if (!sessionInfo) {
      setStatus("No active session to disconnect.");
      return;
    }

    manualDisconnect = true;
    clearReconnectTimer();
    closeSocket();
    updateConnectionState("Disconnected");
    setEditorEnabled(true);
    setStatus("Disconnected. Keep typing locally, then click reconnect to resync.");
  });

  reconnectButton.addEventListener("click", () => {
    if (!sessionInfo) {
      setStatus("No session to reconnect. Join first.");
      return;
    }

    manualDisconnect = false;
    connectWebSocket(true);
  });

  collabEditor.addEventListener("input", () => {
    syncDocumentFromEditor();
    syncSelectionStatus();

    if (!sessionInfo) {
      return;
    }

    sendPresence("editing");
    clearTypingTimer();
    typingIdleTimer = window.setTimeout(() => {
      sendPresence("idle");
      typingIdleTimer = null;
    }, 900);

    clearSendTimer();
    sendTimer = window.setTimeout(() => {
      queueOrSendLatestText();
      sendTimer = null;
    }, 180);
  });

  collabEditor.addEventListener("select", syncSelectionStatus);
  collabEditor.addEventListener("click", syncSelectionStatus);
  collabEditor.addEventListener("keyup", syncSelectionStatus);

  rewriteButton.addEventListener("click", async () => {
    await startAiJob("rewrite");
  });
  summarizeButton.addEventListener("click", async () => {
    await startAiJob("summarize");
  });
  cancelAiButton.addEventListener("click", async () => {
    await cancelAiJob();
  });
  editAiButton.addEventListener("click", () => {
    if (!currentAiJob || currentAiJob.status !== "completed") {
      setStatus("Edit blocked: wait for a completed AI suggestion first.");
      return;
    }

    currentAiJob.editMode = !currentAiJob.editMode;
    renderAiState();
    setStatus(currentAiJob.editMode ? "Suggestion edit mode enabled." : "Suggestion edit mode disabled.");
  });
  aiSuggestion.addEventListener("input", () => {
    if (!currentAiJob?.editMode) {
      return;
    }
    currentAiJob.outputText = aiSuggestion.value;
  });
  acceptAiButton.addEventListener("click", async () => {
    await applyCurrentAiSuggestion(currentAiJob?.editMode ? "edited" : "accepted");
  });
  rejectAiButton.addEventListener("click", async () => {
    if (!currentAiJob) {
      setStatus("No AI suggestion is available to reject.");
      return;
    }
    await recordAiDecision("rejected", null);
    renderAiState();
    setStatus("AI suggestion rejected.");
  });
  undoAiButton.addEventListener("click", async () => {
    await undoLastAiApply();
  });

  renderDocument({
    documentId: "not-loaded",
    workspaceId: "not-loaded",
    title: "No document loaded",
    ownerRole: "owner",
    currentVersionId: "ver_000",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          text: ""
        }
      ]
    }
  });
  resetCollaboration(true);
  updateAuthState();
  documentOutput.textContent = "No document loaded yet.";
  renderAiHistory();
  renderAiState();
};
