import "./App.css";
import {
  isApiErrorEnvelope,
  isCollaborationSessionResponse,
  isDocumentDetailResponse,
  isDocumentMetadataResponse,
  type CollaborationParticipant,
  type CreateDocumentRequest,
  type DocumentDetailResponse
} from "@swe-midterm/contracts";

const DEFAULT_API_BASE_URL = "http://localhost:4000";

interface PendingMutation {
  baseRevision: number;
  clientSeq: number;
  mutationId: string;
  text: string;
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

export const mountApp = (root: HTMLElement): void => {
  const initialApiBase =
    typeof import.meta.env.VITE_API_BASE_URL === "string" &&
    import.meta.env.VITE_API_BASE_URL.trim().length > 0
      ? import.meta.env.VITE_API_BASE_URL.trim()
      : DEFAULT_API_BASE_URL;

  root.innerHTML = `
    <div class="app-shell">
      <header class="hero">
        <p class="eyebrow">Assignment 2 Collaboration Baseline</p>
        <h1>Authenticated WebSocket + Presence + Reconnect Demo</h1>
        <p class="summary">
          Create or load a document, join as different users in two browser windows,
          and verify presence plus reconnect-safe text sync.
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
        <h2>Collaboration Session</h2>
        <div class="three-column">
          <div class="form-grid">
            <label class="field-label" for="userId">User ID</label>
            <input id="userId" class="text-input" value="usr_assanali" />
          </div>
          <div class="form-grid">
            <label class="field-label" for="displayName">Display Name</label>
            <input id="displayName" class="text-input" value="Assanali" />
          </div>
          <div class="button-row">
            <button id="joinButton" class="button button-primary" type="button">Join Session</button>
            <button id="disconnectButton" class="button button-ghost" type="button">Disconnect</button>
            <button id="reconnectButton" class="button button-secondary" type="button">Reconnect</button>
          </div>
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
  const displayNameInput = root.querySelector<HTMLInputElement>("#displayName");
  const joinButton = root.querySelector<HTMLButtonElement>("#joinButton");
  const disconnectButton = root.querySelector<HTMLButtonElement>("#disconnectButton");
  const reconnectButton = root.querySelector<HTMLButtonElement>("#reconnectButton");
  const connectionState = root.querySelector<HTMLElement>("#connectionState");
  const sessionState = root.querySelector<HTMLElement>("#sessionState");
  const revisionState = root.querySelector<HTMLElement>("#revisionState");
  const presenceList = root.querySelector<HTMLUListElement>("#presenceList");
  const collabEditor = root.querySelector<HTMLTextAreaElement>("#collabEditor");
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
    !displayNameInput ||
    !joinButton ||
    !disconnectButton ||
    !reconnectButton ||
    !connectionState ||
    !sessionState ||
    !revisionState ||
    !presenceList ||
    !collabEditor ||
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

  const setStatus = (message: string): void => {
    statusOutput.textContent = message;
  };

  const currentApiBase = (): string => apiBaseInput.value.trim().replace(/\/+$/, "");

  const updateRevisionState = (revision: number): void => {
    currentServerRevision = revision;
    revisionState.textContent = String(revision);
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
            <strong>${participant.displayName}</strong>
            <span>${participant.userId}</span>
            <span class="presence-pill">${participant.activity}</span>
          </li>
        `
      )
      .join("");
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

  const updateConnectionState = (message: string): void => {
    connectionState.textContent = message;
  };

  const updateSessionState = (): void => {
    sessionState.textContent = sessionInfo
      ? `${sessionInfo.sessionId} on ${sessionInfo.documentId}`
      : "No active session";
  };

  const setEditorEnabled = (enabled: boolean): void => {
    collabEditor.disabled = !enabled;
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
          documentId: string;
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

        return;
      }

      if (typedMessage.type === "server.presence") {
        const presence = message as unknown as { participants: CollaborationParticipant[] };
        renderPresence(presence.participants);
        return;
      }

      if (typedMessage.type === "server.ack") {
        const ack = message as unknown as {
          ackClientSeq: number;
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

        setStatus(
          `Server acknowledged mutation ${ack.mutationId.slice(0, 8)} at revision ${ack.serverRevision}.`
        );
        return;
      }

      if (typedMessage.type === "server.update") {
        const update = message as unknown as {
          authorUserId: string;
          mutationId: string;
          serverRevision: number;
          text: string;
        };

        updateRevisionState(update.serverRevision);
        collabEditor.value = update.text;
        syncDocumentFromEditor();
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
    const response = await fetch(`${currentApiBase()}/v1/documents/${encodeURIComponent(documentId)}`);
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
      headers: {
        "Content-Type": "application/json"
      },
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

  joinButton.addEventListener("click", async () => {
    const documentId = documentIdInput.value.trim();

    if (!documentId) {
      setStatus("Join blocked: load or create a document first.");
      return;
    }

    manualDisconnect = false;

    const response = await fetch(`${currentApiBase()}/v1/documents/${encodeURIComponent(documentId)}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userId: userIdInput.value.trim(),
        displayName: displayNameInput.value.trim()
      })
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
  documentOutput.textContent = "No document loaded yet.";
};
