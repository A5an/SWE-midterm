import "./App.css";

interface CreateDocumentRequest {
  workspaceId: string;
  title: string;
  templateId: null;
  initialContent: {
    type: "doc";
    content: Array<{
      type: "paragraph";
      text: string;
    }>;
  };
}

interface DocumentMetadataResponse {
  documentId: string;
  workspaceId: string;
  title: string;
  ownerRole: "owner";
  currentVersionId: string;
  createdAt: string;
}

interface DocumentDetailResponse extends DocumentMetadataResponse {
  content: {
    type: "doc";
    content: Array<{
      type: "paragraph";
      text: string;
    }>;
  };
  updatedAt: string;
}

interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId: string;
  };
}

const DEFAULT_API_BASE_URL = "http://localhost:4000";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isApiErrorEnvelope = (value: unknown): value is ApiErrorEnvelope =>
  isRecord(value) &&
  isRecord(value.error) &&
  typeof value.error.code === "string" &&
  typeof value.error.message === "string";

const isDocumentMetadataResponse = (value: unknown): value is DocumentMetadataResponse =>
  isRecord(value) &&
  typeof value.documentId === "string" &&
  typeof value.workspaceId === "string" &&
  typeof value.title === "string" &&
  value.ownerRole === "owner" &&
  typeof value.currentVersionId === "string" &&
  typeof value.createdAt === "string";

const isDocumentDetailResponse = (value: unknown): value is DocumentDetailResponse => {
  if (!isDocumentMetadataResponse(value)) {
    return false;
  }
  const detail = value as DocumentDetailResponse;
  return isRecord(detail.content) && Array.isArray(detail.content.content) && typeof detail.updatedAt === "string";
};

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
        <p class="eyebrow">SWE Midterm - Part 4 PoC</p>
        <h1>Frontend to Backend Contract Demo</h1>
        <p class="summary">
          This page calls the backend document API end-to-end:
          create a document, then load it by ID.
        </p>
      </header>

      <section class="panel">
        <h2>Connection</h2>
        <label class="field-label" for="apiBase">API Base URL</label>
        <input id="apiBase" class="text-input" value="${initialApiBase}" />
        <p class="hint">Default backend URL is http://localhost:4000</p>
      </section>

      <section class="panel">
        <h2>Create Document</h2>
        <form id="createForm" class="form-grid">
          <label class="field-label" for="workspaceId">Workspace ID</label>
          <input id="workspaceId" class="text-input" value="ws_123" required />

          <label class="field-label" for="title">Title</label>
          <input id="title" class="text-input" value="Q3 Product Brief" required />

          <label class="field-label" for="paragraph">Initial Paragraph</label>
          <textarea id="paragraph" class="text-area" rows="5">Initial content from web PoC.</textarea>

          <button type="submit" class="button button-primary">Create + Load</button>
        </form>
      </section>

      <section class="panel">
        <h2>Load Document</h2>
        <div class="load-row">
          <input id="documentId" class="text-input" placeholder="doc_xxxxxxxx" />
          <button id="loadButton" class="button button-secondary" type="button">Load</button>
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
    !statusOutput ||
    !documentOutput
  ) {
    throw new Error("Failed to initialize web PoC UI.");
  }

  const setStatus = (message: string): void => {
    statusOutput.textContent = message;
  };

  const currentApiBase = (): string => apiBaseInput.value.trim().replace(/\/+$/, "");

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

  const handleApiFailure = (prefix: string, payload: unknown): void => {
    if (isApiErrorEnvelope(payload)) {
      setStatus(
        `${prefix}: ${payload.error.code} - ${payload.error.message} (requestId: ${payload.error.requestId})`
      );
      return;
    }
    setStatus(`${prefix}: unexpected response format.`);
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

    setStatus(`Loaded ${payload.documentId} successfully.`);
    renderDocument(payload);
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
};
