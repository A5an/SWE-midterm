import "./App.css";
import {
  isAiHistoryResponse,
  isApiErrorEnvelope,
  isCollaborationSessionResponse,
  isCreateAiJobResponse,
  isDemoLoginResponse,
  isDocumentDetailResponse,
  isDocumentMetadataResponse,
  isDocumentPermissionsResponse,
  isDocumentRestoreResponse,
  isDocumentShareResponse,
  isDocumentVersionsResponse,
  type AiHistoryRecord,
  type AiJobStatus,
  type CollaborationParticipant,
  type CreateDocumentRequest,
  type DocumentDetailResponse,
  type DocumentPermissionEntry,
  type DocumentVersionSummary,
  type SharingRole
} from "@swe-midterm/contracts";
import {
  applySuggestionToDocument,
  buildAiRequestContext,
  describeSelection,
  normalizeEditorSelection,
  type EditorSelectionRange
} from "./ai.ts";
import {
  buildAuthRouteHash,
  clearPersistedAuthSession,
  fetchCurrentUserProfile,
  isApiErrorEnvelope as isFastApiErrorEnvelope,
  loginAuthUser,
  parseAuthRoute,
  persistAuthSession,
  refreshAuthSession,
  registerAuthUser,
  restorePersistedAuthSession,
  type AuthRoute,
  type AuthUserProfile,
  type PersistedAuthSession
} from "./auth.ts";
import {
  describeRoleCapabilities,
  removePermissionEntry,
  resolveEffectiveDocumentRole,
  sortVersionsDescending,
  upsertPermissionEntry,
  type EffectiveDocumentRole
} from "./document-ui.ts";

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

      <section class="panel">
        <h2>Auth Baseline</h2>
        <div class="two-column auth-header-grid">
          <div class="form-grid">
            <label class="field-label" for="authApiBase">Auth API Base URL</label>
            <input id="authApiBase" class="text-input" value="${initialApiBase}" />
            <p class="hint">
              Point this to the FastAPI backend that exposes <code>/v1/auth/register</code>,
              <code>/v1/auth/login</code>, <code>/v1/auth/refresh</code>, and the protected
              <code>/v1/me</code> route.
            </p>
          </div>
          <div class="auth-route-nav">
            <div class="button-row button-row-left">
              <button id="authLoginRouteButton" class="button button-secondary" type="button">Login Route</button>
              <button id="authRegisterRouteButton" class="button button-secondary" type="button">Register Route</button>
              <button id="authWorkspaceRouteButton" class="button button-primary" type="button">Protected Workspace</button>
            </div>
            <p class="hint">
              This route state is stored in the URL hash so you can refresh directly into the protected workspace.
            </p>
          </div>
        </div>

        <div class="session-bar">
          <div>
            <span class="field-label">Route</span>
            <p id="authRouteState" class="session-value">/login</p>
          </div>
          <div>
            <span class="field-label">JWT Session</span>
            <p id="authSessionState" class="session-value">Signed out</p>
          </div>
          <div>
            <span class="field-label">Access Expiry</span>
            <p id="authExpiryState" class="session-value">-</p>
          </div>
        </div>

        <p id="authLifecycleState" class="hint">No saved auth session.</p>

        <section id="authLoginPanel" class="auth-route-panel">
          <h3>Login</h3>
          <form id="authLoginForm" class="form-grid auth-form-grid">
            <label class="field-label" for="authLoginEmail">Email</label>
            <input id="authLoginEmail" class="text-input" type="email" placeholder="user@example.com" required />

            <label class="field-label" for="authLoginPassword">Password</label>
            <input
              id="authLoginPassword"
              class="text-input"
              type="password"
              placeholder="At least 8 characters"
              required
            />

            <div class="button-row button-row-left">
              <button type="submit" class="button button-primary">Sign In</button>
              <button id="authRestoreButton" type="button" class="button button-secondary">Restore Saved Session</button>
            </div>
          </form>
        </section>

        <section id="authRegisterPanel" class="auth-route-panel" hidden>
          <h3>Register</h3>
          <form id="authRegisterForm" class="form-grid auth-form-grid">
            <label class="field-label" for="authRegisterName">Display Name</label>
            <input id="authRegisterName" class="text-input" placeholder="Assanali" required />

            <label class="field-label" for="authRegisterEmail">Email</label>
            <input id="authRegisterEmail" class="text-input" type="email" placeholder="user@example.com" required />

            <label class="field-label" for="authRegisterPassword">Password</label>
            <input
              id="authRegisterPassword"
              class="text-input"
              type="password"
              placeholder="At least 8 characters"
              required
            />

            <div class="button-row button-row-left">
              <button type="submit" class="button button-primary">Create Account</button>
            </div>
          </form>
        </section>

        <section id="authWorkspacePanel" class="auth-route-panel" hidden>
          <h3>Protected Workspace</h3>
          <p class="hint">
            This route revalidates the persisted JWT session against <code>/v1/me</code>. Refresh the page here to prove
            session persistence, and use a short backend TTL to demonstrate graceful expiry handling.
          </p>
          <div class="button-row button-row-left">
            <button id="authProtectedFetchButton" class="button button-primary" type="button">Load Protected Profile</button>
            <button id="authRefreshSessionButton" class="button button-secondary" type="button">Refresh Session</button>
            <button id="authSignOutButton" class="button button-ghost" type="button">Sign Out</button>
          </div>
          <pre id="authProfileOutput" class="output">Protected profile will appear here after sign-in.</pre>
        </section>
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
        <div class="two-column document-admin-grid">
          <div>
            <h2>Access & Sharing</h2>
            <div class="access-summary">
              <span class="field-label">Effective Access</span>
              <p id="documentRoleState" class="session-value">Unknown</p>
              <p id="documentRoleHint" class="hint">Load a document and sign in to inspect document access.</p>
            </div>

            <form id="shareForm" class="form-grid share-form">
              <label class="field-label" for="sharePrincipal">User ID or Email</label>
              <input id="sharePrincipal" class="text-input" placeholder="usr_viewer or viewer@demo.local" />

              <label class="field-label" for="shareRole">Assign Role</label>
              <select id="shareRole" class="text-input">
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>

              <div class="button-row button-row-left">
                <button id="shareSubmitButton" type="submit" class="button button-primary">Assign or Update Role</button>
                <button id="refreshPermissionsButton" type="button" class="button button-secondary">Refresh Access List</button>
              </div>
            </form>

            <h3>Current Permissions</h3>
            <ul id="permissionsList" class="history-list">
              <li class="history-empty">Owner-only sharing controls will appear here after a document is loaded.</li>
            </ul>
          </div>

          <div>
            <h2>Version History</h2>
            <div class="button-row button-row-left">
              <button id="refreshVersionsButton" type="button" class="button button-secondary">Refresh Versions</button>
            </div>
            <ul id="versionList" class="history-list">
              <li class="history-empty">Load a document to view version history.</li>
            </ul>
          </div>
        </div>
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
  const authApiBaseInput = root.querySelector<HTMLInputElement>("#authApiBase");
  const authLoginRouteButton = root.querySelector<HTMLButtonElement>("#authLoginRouteButton");
  const authRegisterRouteButton = root.querySelector<HTMLButtonElement>("#authRegisterRouteButton");
  const authWorkspaceRouteButton = root.querySelector<HTMLButtonElement>("#authWorkspaceRouteButton");
  const authRouteState = root.querySelector<HTMLElement>("#authRouteState");
  const authSessionState = root.querySelector<HTMLElement>("#authSessionState");
  const authExpiryState = root.querySelector<HTMLElement>("#authExpiryState");
  const authLifecycleState = root.querySelector<HTMLElement>("#authLifecycleState");
  const authLoginPanel = root.querySelector<HTMLElement>("#authLoginPanel");
  const authRegisterPanel = root.querySelector<HTMLElement>("#authRegisterPanel");
  const authWorkspacePanel = root.querySelector<HTMLElement>("#authWorkspacePanel");
  const authLoginForm = root.querySelector<HTMLFormElement>("#authLoginForm");
  const authRegisterForm = root.querySelector<HTMLFormElement>("#authRegisterForm");
  const authLoginEmailInput = root.querySelector<HTMLInputElement>("#authLoginEmail");
  const authLoginPasswordInput = root.querySelector<HTMLInputElement>("#authLoginPassword");
  const authRegisterNameInput = root.querySelector<HTMLInputElement>("#authRegisterName");
  const authRegisterEmailInput = root.querySelector<HTMLInputElement>("#authRegisterEmail");
  const authRegisterPasswordInput = root.querySelector<HTMLInputElement>("#authRegisterPassword");
  const authRestoreButton = root.querySelector<HTMLButtonElement>("#authRestoreButton");
  const authProtectedFetchButton = root.querySelector<HTMLButtonElement>("#authProtectedFetchButton");
  const authRefreshSessionButton = root.querySelector<HTMLButtonElement>("#authRefreshSessionButton");
  const authSignOutButton = root.querySelector<HTMLButtonElement>("#authSignOutButton");
  const authProfileOutput = root.querySelector<HTMLElement>("#authProfileOutput");
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
  const documentRoleState = root.querySelector<HTMLElement>("#documentRoleState");
  const documentRoleHint = root.querySelector<HTMLElement>("#documentRoleHint");
  const shareForm = root.querySelector<HTMLFormElement>("#shareForm");
  const sharePrincipalInput = root.querySelector<HTMLInputElement>("#sharePrincipal");
  const shareRoleSelect = root.querySelector<HTMLSelectElement>("#shareRole");
  const shareSubmitButton = root.querySelector<HTMLButtonElement>("#shareSubmitButton");
  const refreshPermissionsButton = root.querySelector<HTMLButtonElement>("#refreshPermissionsButton");
  const permissionsList = root.querySelector<HTMLUListElement>("#permissionsList");
  const refreshVersionsButton = root.querySelector<HTMLButtonElement>("#refreshVersionsButton");
  const versionList = root.querySelector<HTMLUListElement>("#versionList");
  const statusOutput = root.querySelector<HTMLElement>("#status");
  const documentOutput = root.querySelector<HTMLElement>("#documentOutput");

  if (
    !apiBaseInput ||
    !authApiBaseInput ||
    !authLoginRouteButton ||
    !authRegisterRouteButton ||
    !authWorkspaceRouteButton ||
    !authRouteState ||
    !authSessionState ||
    !authExpiryState ||
    !authLifecycleState ||
    !authLoginPanel ||
    !authRegisterPanel ||
    !authWorkspacePanel ||
    !authLoginForm ||
    !authRegisterForm ||
    !authLoginEmailInput ||
    !authLoginPasswordInput ||
    !authRegisterNameInput ||
    !authRegisterEmailInput ||
    !authRegisterPasswordInput ||
    !authRestoreButton ||
    !authProtectedFetchButton ||
    !authRefreshSessionButton ||
    !authSignOutButton ||
    !authProfileOutput ||
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
    !documentRoleState ||
    !documentRoleHint ||
    !shareForm ||
    !sharePrincipalInput ||
    !shareRoleSelect ||
    !shareSubmitButton ||
    !refreshPermissionsButton ||
    !permissionsList ||
    !refreshVersionsButton ||
    !versionList ||
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
  let fastapiSession: PersistedAuthSession | null = null;
  let fastapiProfile: AuthUserProfile | null = null;
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
  let ownerControlsAvailable = false;
  let editAccess: boolean | null = null;
  let documentRole: EffectiveDocumentRole = "unknown";
  let permissions: DocumentPermissionEntry[] = [];
  let versions: DocumentVersionSummary[] = [];

  const setStatus = (message: string): void => {
    statusOutput.textContent = message;
  };

  const currentApiBase = (): string => apiBaseInput.value.trim().replace(/\/+$/, "");
  const currentAuthApiBase = (): string => authApiBaseInput.value.trim().replace(/\/+$/, "");
  const currentAuthRoute = (): AuthRoute => parseAuthRoute(window.location.hash);

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

  const setAuthLifecycleMessage = (message: string): void => {
    authLifecycleState.textContent = message;
  };

  const renderProtectedProfile = (): void => {
    authProfileOutput.textContent = fastapiProfile
      ? JSON.stringify(
          {
            userId: fastapiProfile.userId,
            email: fastapiProfile.email,
            displayName: fastapiProfile.displayName,
            workspaceRole: fastapiProfile.workspaceRole,
            createdAt: fastapiProfile.createdAt
          },
          null,
          2
        )
      : "Protected profile will appear here after sign-in.";
  };

  const updateFastapiAuthState = (): void => {
    const route = currentAuthRoute();
    authRouteState.textContent =
      route === "workspace" ? "/workspace (protected)" : route === "register" ? "/register" : "/login";
    authSessionState.textContent = fastapiSession
      ? `Signed in as ${fastapiSession.user.displayName}`
      : "Signed out";
    authExpiryState.textContent = fastapiSession
      ? new Date(fastapiSession.tokens.accessTokenExpiresAt).toLocaleString()
      : "-";
    authProtectedFetchButton.disabled = fastapiSession === null;
    authRefreshSessionButton.disabled = fastapiSession === null;
    authSignOutButton.disabled = fastapiSession === null;
  };

  const applyFastapiSession = (
    session: PersistedAuthSession | null,
    options?: {
      persist?: boolean;
    }
  ): void => {
    fastapiSession = session;
    fastapiProfile = session?.user ?? null;

    if (session) {
      authApiBaseInput.value = session.baseUrl;
      if (options?.persist !== false) {
        persistAuthSession(window.localStorage, session);
      }
    } else if (options?.persist !== false) {
      clearPersistedAuthSession(window.localStorage);
    }

    updateFastapiAuthState();
    renderProtectedProfile();
  };

  const navigateAuthRoute = (route: AuthRoute): void => {
    const nextHash = buildAuthRouteHash(route);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
      return;
    }
    renderAuthRoute();
  };

  const renderAuthRoute = (): void => {
    let route = currentAuthRoute();

    if (route === "workspace" && !fastapiSession) {
      route = "login";
      if (window.location.hash !== buildAuthRouteHash("login")) {
        window.location.hash = buildAuthRouteHash("login");
      }
      setAuthLifecycleMessage("Protected route blocked: sign in first so /v1/me can be authorized.");
    }

    authLoginPanel.hidden = route !== "login";
    authRegisterPanel.hidden = route !== "register";
    authWorkspacePanel.hidden = route !== "workspace";
    authLoginRouteButton.disabled = route === "login";
    authRegisterRouteButton.disabled = route === "register";
    authWorkspaceRouteButton.disabled = route === "workspace";
    updateFastapiAuthState();
  };

  const describeFastapiError = (prefix: string, error: unknown): string => {
    if (isFastApiErrorEnvelope(error)) {
      return `${prefix}: ${error.error.code} - ${error.error.message} (requestId: ${error.error.requestId})`;
    }

    if (error instanceof Error) {
      return `${prefix}: ${error.message}`;
    }

    return `${prefix}: unexpected response format.`;
  };

  const loadProtectedProfile = async (
    reason = "Protected workspace loaded through /v1/me."
  ): Promise<void> => {
    if (!fastapiSession) {
      navigateAuthRoute("login");
      setAuthLifecycleMessage("Protected route blocked: sign in first so /v1/me can be authorized.");
      return;
    }

    try {
      const profile = await fetchCurrentUserProfile(fastapiSession);
      const nextSession = { ...fastapiSession, user: profile };
      applyFastapiSession(nextSession);
      setAuthLifecycleMessage(reason);
      return;
    } catch (error) {
      if (
        !isFastApiErrorEnvelope(error) ||
        (error.error.code !== "AUTHN_TOKEN_EXPIRED" && error.error.code !== "AUTHN_INVALID_TOKEN")
      ) {
        setAuthLifecycleMessage(describeFastapiError("Protected route failed", error));
        return;
      }
    }

    try {
      const refreshedSession = await refreshAuthSession(fastapiSession);
      applyFastapiSession(refreshedSession);
      const profile = await fetchCurrentUserProfile(refreshedSession);
      applyFastapiSession({
        ...refreshedSession,
        user: profile
      });
      setAuthLifecycleMessage("Access token expired. Session refreshed and protected route recovered gracefully.");
    } catch (refreshError) {
      applyFastapiSession(null);
      navigateAuthRoute("login");
      setAuthLifecycleMessage(describeFastapiError("Session expired", refreshError));
    }
  };

  const restoreFastapiSession = async (
    statusPrefix = "Restoring saved auth session..."
  ): Promise<void> => {
    setAuthLifecycleMessage(statusPrefix);
    const result = await restorePersistedAuthSession(window.localStorage, currentAuthApiBase());
    applyFastapiSession(result.session, {
      persist: false
    });
    setAuthLifecycleMessage(result.message);
    renderAuthRoute();

    if (result.session && currentAuthRoute() === "workspace") {
      await loadProtectedProfile(
        result.recoveredWithRefresh
          ? "Protected workspace restored after refreshing expired credentials."
          : "Protected workspace restored from the saved session."
      );
    }
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

  const updateDocumentRoleState = (): void => {
    documentRole = resolveEffectiveDocumentRole(ownerControlsAvailable, editAccess);
    documentRoleState.textContent =
      documentRole === "unknown" ? "Unknown" : `${documentRole.charAt(0).toUpperCase()}${documentRole.slice(1)}`;
    documentRoleHint.textContent = describeRoleCapabilities(documentRole, authSession !== null, currentDocument !== null);

    const canManageShares = currentDocument !== null && authSession !== null && documentRole === "owner";
    const canInspectDocument = currentDocument !== null && authSession !== null;

    sharePrincipalInput.disabled = !canManageShares;
    shareRoleSelect.disabled = !canManageShares;
    shareSubmitButton.disabled = !canManageShares;
    refreshPermissionsButton.disabled = !canInspectDocument;
    refreshVersionsButton.disabled = !canInspectDocument;

    if (versions.length > 0) {
      renderVersions();
    }
  };

  const renderPermissions = (): void => {
    if (!currentDocument) {
      permissionsList.innerHTML = `<li class="history-empty">Load a document to inspect sharing state.</li>`;
      return;
    }

    if (!authSession) {
      permissionsList.innerHTML = `<li class="history-empty">Sign in with a demo user to inspect document access.</li>`;
      return;
    }

    if (!ownerControlsAvailable) {
      permissionsList.innerHTML = `<li class="history-empty">Only the owner can view and edit the full sharing matrix for this document.</li>`;
      return;
    }

    if (permissions.length === 0) {
      permissionsList.innerHTML = `<li class="history-empty">No document permissions were returned by the API.</li>`;
      return;
    }

    permissionsList.innerHTML = permissions
      .map((permission) => {
        const canRemoveShare = permission.shareId !== null && permission.source === "share";

        return `
          <li class="history-item permission-item">
            <div class="history-row">
              <strong>${escapeHtml(permission.displayName)}</strong>
              <span class="history-pill">${escapeHtml(permission.permissionLevel)}</span>
              <span class="history-pill history-pill-muted">${escapeHtml(permission.source)}</span>
            </div>
            <div class="history-meta">
              <span>${escapeHtml(permission.userId)}</span>
              <span>${escapeHtml(permission.email)}</span>
            </div>
            ${
              canRemoveShare
                ? `<div class="button-row button-row-left permission-actions">
                    <button
                      type="button"
                      class="button button-ghost button-inline"
                      data-action="remove-share"
                      data-share-id="${escapeHtml(permission.shareId ?? "")}"
                    >
                      Remove Explicit Share
                    </button>
                  </div>`
                : `<p class="hint permission-note">${
                    permission.source === "owner"
                      ? "Owner access is fixed."
                      : "Workspace access is inherited until an explicit share overrides it."
                  }</p>`
            }
          </li>
        `;
      })
      .join("");
  };

  const renderVersions = (): void => {
    if (!currentDocument) {
      versionList.innerHTML = `<li class="history-empty">Load a document to view version history.</li>`;
      return;
    }

    if (!authSession) {
      versionList.innerHTML = `<li class="history-empty">Sign in with a demo user to view document versions.</li>`;
      return;
    }

    if (versions.length === 0) {
      versionList.innerHTML = `<li class="history-empty">No versions were returned for this document.</li>`;
      return;
    }

    versionList.innerHTML = versions
      .map((version) => {
        const isCurrent = currentDocument?.currentVersionId === version.versionId;
        const canRestore = documentRole === "owner" && !isCurrent;

        return `
          <li class="history-item version-item">
            <div class="history-row">
              <strong>${escapeHtml(version.versionId)}</strong>
              <span class="history-pill">${escapeHtml(version.title)}</span>
              ${isCurrent ? `<span class="history-pill history-pill-muted">current</span>` : ""}
              ${version.isRevert ? `<span class="history-pill history-pill-muted">restore</span>` : ""}
            </div>
            <div class="history-meta">
              <span>#${version.versionNumber}</span>
              <span>${escapeHtml(new Date(version.createdAt).toLocaleString())}</span>
              <span>${escapeHtml(version.createdByUserId)}</span>
            </div>
            <p class="history-snippet">${escapeHtml(version.changeSummary)}</p>
            <div class="button-row button-row-left permission-actions">
              <button
                type="button"
                class="button button-secondary button-inline"
                data-action="restore-version"
                data-version-id="${escapeHtml(version.versionId)}"
                ${canRestore ? "" : "disabled"}
              >
                ${isCurrent ? "Current Head" : "Restore as New Head"}
              </button>
            </div>
          </li>
        `;
      })
      .join("");
  };

  const resetDocumentAdminState = (): void => {
    ownerControlsAvailable = false;
    editAccess = null;
    documentRole = "unknown";
    permissions = [];
    versions = [];
    updateDocumentRoleState();
    renderPermissions();
    renderVersions();
  };

  const refreshPermissions = async (): Promise<void> => {
    if (!currentDocument || !authSession) {
      permissions = [];
      ownerControlsAvailable = false;
      updateDocumentRoleState();
      renderPermissions();
      return;
    }

    const response = await fetch(
      `${currentApiBase()}/v1/documents/${encodeURIComponent(currentDocument.documentId)}/permissions`,
      {
        headers: currentAuthHeaders()
      }
    );
    const payload = await readJson(response);

    if (response.ok) {
      if (!isDocumentPermissionsResponse(payload)) {
        setStatus("Permissions load failed: backend response does not match expected sharing contract.");
        ownerControlsAvailable = false;
        permissions = [];
        updateDocumentRoleState();
        renderPermissions();
        return;
      }

      ownerControlsAvailable = true;
      permissions = payload.permissions;
      updateDocumentRoleState();
      renderPermissions();
      return;
    }

    ownerControlsAvailable = false;
    permissions = [];
    updateDocumentRoleState();
    renderPermissions();

    if (isApiErrorEnvelope(payload) && payload.error.code === "AUTHZ_FORBIDDEN") {
      return;
    }

    handleApiFailure("Permissions load failed", payload);
  };

  const refreshVersions = async (): Promise<void> => {
    if (!currentDocument || !authSession) {
      versions = [];
      renderVersions();
      return;
    }

    const response = await fetch(
      `${currentApiBase()}/v1/documents/${encodeURIComponent(currentDocument.documentId)}/versions`,
      {
        headers: currentAuthHeaders()
      }
    );
    const payload = await readJson(response);

    if (!response.ok) {
      versions = [];
      renderVersions();
      handleApiFailure("Version history load failed", payload);
      return;
    }

    if (!isDocumentVersionsResponse(payload)) {
      versions = [];
      renderVersions();
      setStatus("Version history load failed: backend response does not match expected version contract.");
      return;
    }

    versions = sortVersionsDescending(payload.versions);
    renderVersions();
  };

  const submitShareAssignment = async (): Promise<void> => {
    if (!currentDocument) {
      setStatus("Share update blocked: load a document first.");
      return;
    }

    if (!authSession) {
      setStatus("Share update blocked: sign in first.");
      return;
    }

    if (documentRole !== "owner") {
      setStatus("Share update blocked: only the owner can assign roles.");
      return;
    }

    const principalId = sharePrincipalInput.value.trim();
    if (!principalId) {
      setStatus("Share update blocked: user ID or email is required.");
      return;
    }

    const permissionLevel = shareRoleSelect.value as SharingRole;
    const response = await fetch(
      `${currentApiBase()}/v1/documents/${encodeURIComponent(currentDocument.documentId)}/shares`,
      {
        method: "POST",
        headers: currentAuthHeaders(true),
        body: JSON.stringify({
          principalType: "user",
          principalId,
          permissionLevel
        })
      }
    );
    const payload = await readJson(response);

    if (!response.ok) {
      handleApiFailure("Share update failed", payload);
      return;
    }

    if (!isDocumentShareResponse(payload)) {
      setStatus("Share update failed: backend response does not match expected share contract.");
      return;
    }

    permissions = upsertPermissionEntry(permissions, payload.permission);
    await refreshPermissions();
    sharePrincipalInput.value = "";
    setStatus(`Assigned ${payload.permission.permissionLevel} to ${payload.permission.displayName}.`);
  };

  const removeExplicitShare = async (shareId: string): Promise<void> => {
    if (!currentDocument) {
      setStatus("Share removal blocked: load a document first.");
      return;
    }

    if (!authSession) {
      setStatus("Share removal blocked: sign in first.");
      return;
    }

    if (documentRole !== "owner") {
      setStatus("Share removal blocked: only the owner can revoke explicit shares.");
      return;
    }

    const response = await fetch(
      `${currentApiBase()}/v1/documents/${encodeURIComponent(currentDocument.documentId)}/shares/${encodeURIComponent(shareId)}`,
      {
        method: "DELETE",
        headers: currentAuthHeaders()
      }
    );

    if (!response.ok) {
      const payload = await readJson(response);
      handleApiFailure("Share removal failed", payload);
      return;
    }

    permissions = removePermissionEntry(permissions, shareId);
    await refreshPermissions();
    setStatus(`Removed explicit share ${shareId}.`);
  };

  const restoreVersion = async (versionId: string): Promise<void> => {
    if (!currentDocument) {
      setStatus("Restore blocked: load a document first.");
      return;
    }

    if (!authSession) {
      setStatus("Restore blocked: sign in first.");
      return;
    }

    if (documentRole !== "owner") {
      setStatus("Restore blocked: only the owner can restore document versions.");
      return;
    }

    const response = await fetch(
      `${currentApiBase()}/v1/documents/${encodeURIComponent(currentDocument.documentId)}/versions/${encodeURIComponent(versionId)}:revert`,
      {
        method: "POST",
        headers: currentAuthHeaders(true),
        body: JSON.stringify({})
      }
    );
    const payload = await readJson(response);

    if (!response.ok) {
      handleApiFailure("Version restore failed", payload);
      return;
    }

    if (!isDocumentRestoreResponse(payload)) {
      setStatus("Version restore failed: backend response does not match expected restore contract.");
      return;
    }

    setStatus(
      `Restore queued: ${payload.restoredFromVersionId} became new head ${payload.currentVersionId}. Reloading document state...`
    );
    await loadDocumentById(payload.documentId);
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

      if (typedMessage.type === "server.reload_required") {
        const reload = message as unknown as {
          documentId: string;
          newVersionId: string;
          reason: string;
          serverRevision: number;
          text: string;
        };

        pendingMutation = null;
        updateRevisionState(reload.serverRevision);
        collabEditor.value = reload.text;
        syncDocumentFromEditor();
        setStatus(
          `Document head changed (${reload.reason}). Reloading version ${reload.newVersionId}.`
        );
        void loadDocumentById(reload.documentId);
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

    const previousDocumentId = currentDocument?.documentId ?? null;
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

    if (previousDocumentId !== payload.documentId) {
      resetDocumentAdminState();
    }

    if (!sessionInfo || sessionInfo.documentId !== payload.documentId) {
      resetCollaboration(false);
      collabEditor.value = toParagraphText(payload);
      editAccess = null;
    }

    resetAiState();
    syncSelectionStatus();
    updateDocumentRoleState();
    await refreshPermissions();
    await refreshVersions();
    await refreshAiHistory();
  };

  authLoginRouteButton.addEventListener("click", () => {
    navigateAuthRoute("login");
  });

  authRegisterRouteButton.addEventListener("click", () => {
    navigateAuthRoute("register");
  });

  authWorkspaceRouteButton.addEventListener("click", () => {
    navigateAuthRoute("workspace");
  });

  authLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAuthLifecycleMessage("Signing in against the FastAPI auth backend...");

    try {
      const session = await loginAuthUser(currentAuthApiBase(), {
        email: authLoginEmailInput.value.trim(),
        password: authLoginPasswordInput.value
      });
      applyFastapiSession(session);
      navigateAuthRoute("workspace");
      await loadProtectedProfile("Signed in successfully. Protected workspace is authorized.");
    } catch (error) {
      setAuthLifecycleMessage(describeFastapiError("Login failed", error));
    }
  });

  authRegisterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAuthLifecycleMessage("Creating account against the FastAPI auth backend...");

    try {
      const session = await registerAuthUser(currentAuthApiBase(), {
        displayName: authRegisterNameInput.value.trim(),
        email: authRegisterEmailInput.value.trim(),
        password: authRegisterPasswordInput.value
      });
      applyFastapiSession(session);
      navigateAuthRoute("workspace");
      await loadProtectedProfile("Registration completed. Protected workspace is authorized.");
    } catch (error) {
      setAuthLifecycleMessage(describeFastapiError("Registration failed", error));
    }
  });

  authRestoreButton.addEventListener("click", async () => {
    await restoreFastapiSession();
  });

  authProtectedFetchButton.addEventListener("click", async () => {
    await loadProtectedProfile("Protected route reloaded through /v1/me.");
  });

  authRefreshSessionButton.addEventListener("click", async () => {
    if (!fastapiSession) {
      navigateAuthRoute("login");
      setAuthLifecycleMessage("Refresh blocked: sign in first.");
      return;
    }

    setAuthLifecycleMessage("Refreshing JWT session...");

    try {
      const refreshedSession = await refreshAuthSession(fastapiSession);
      applyFastapiSession(refreshedSession);
      await loadProtectedProfile("Session refreshed. Protected route still authorized.");
    } catch (error) {
      applyFastapiSession(null);
      navigateAuthRoute("login");
      setAuthLifecycleMessage(describeFastapiError("Refresh failed", error));
    }
  });

  authSignOutButton.addEventListener("click", () => {
    applyFastapiSession(null);
    navigateAuthRoute("login");
    setAuthLifecycleMessage("Signed out and cleared the persisted auth session.");
  });

  authApiBaseInput.addEventListener("change", () => {
    authApiBaseInput.value = currentAuthApiBase();
  });

  window.addEventListener("hashchange", () => {
    renderAuthRoute();
    if (currentAuthRoute() === "workspace" && fastapiSession && fastapiProfile === null) {
      void loadProtectedProfile("Protected route restored after navigation.");
    }
  });

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
    resetDocumentAdminState();

    if (sessionInfo) {
      resetCollaboration(false);
      collabEditor.value = currentDocument ? toParagraphText(currentDocument) : collabEditor.value;
    }

    if (currentDocument) {
      await loadDocumentById(currentDocument.documentId);
    } else {
      await refreshAiHistory();
    }
    renderAiState();
    setStatus(
      `Signed in as ${payload.displayName}. Session bootstrap is now authorized for workspaces: ${payload.workspaceIds.join(", ")}.`
    );
  });

  logoutButton.addEventListener("click", () => {
    authSession = null;
    updateAuthState();
    resetDocumentAdminState();
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
      if (isApiErrorEnvelope(payload) && payload.error.code === "AUTHZ_FORBIDDEN") {
        editAccess = false;
        updateDocumentRoleState();
      }
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
    editAccess = true;
    updateDocumentRoleState();
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

  shareForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitShareAssignment();
  });

  refreshPermissionsButton.addEventListener("click", async () => {
    await refreshPermissions();
  });

  permissionsList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("[data-action='remove-share']");
    if (!button) {
      return;
    }

    const shareId = button.dataset.shareId;
    if (!shareId) {
      return;
    }

    await removeExplicitShare(shareId);
  });

  refreshVersionsButton.addEventListener("click", async () => {
    await refreshVersions();
  });

  versionList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("[data-action='restore-version']");
    if (!button || button.disabled) {
      return;
    }

    const versionId = button.dataset.versionId;
    if (!versionId) {
      return;
    }

    await restoreVersion(versionId);
  });

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
  applyFastapiSession(null, {
    persist: false
  });
  renderAuthRoute();
  documentOutput.textContent = "No document loaded yet.";
  renderAiHistory();
  renderAiState();
  resetDocumentAdminState();
  void restoreFastapiSession("Checking for a saved auth session...");
};
