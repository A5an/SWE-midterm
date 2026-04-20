import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createConnection } from "node:net";
import {
  isAiHistoryResponse,
  isApiErrorEnvelope,
  isCreateAiJobResponse,
  isCollaborationSessionResponse,
  isDemoLoginResponse,
  isDocumentDetailResponse,
  isDocumentListResponse,
  isDocumentMetadataResponse,
  isDocumentPermissionsResponse,
  isDocumentRestoreResponse,
  isDocumentShareResponse,
  isDocumentVersionResponse,
  isDocumentVersionsResponse
} from "@swe-midterm/contracts";
import { createApiServer } from "./server.ts";

interface MessageBucket {
  messages: Array<Record<string, unknown>>;
}

interface AuthSession {
  accessToken: string;
  displayName: string;
  expiresAt: string;
  issuedAt: string;
  userId: string;
  workspaceIds: string[];
}

interface SseBucket {
  events: Array<Record<string, unknown>>;
}

const server = createApiServer();

const listen = async (): Promise<string> => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
};

const close = async (): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const openSseStream = async (
  url: string
): Promise<{ bucket: SseBucket; close: () => Promise<void> }> => {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: {
      Accept: "text/event-stream"
    },
    signal: controller.signal
  });
  assert.equal(response.status, 200, "AI stream must return 200.");
  assert.ok(response.body, "AI stream must expose a readable body.");

  const bucket: SseBucket = { events: [] };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!dataLine) {
          continue;
        }
        bucket.events.push(JSON.parse(dataLine.slice(6)) as Record<string, unknown>);
      }
    }
  })();

  return {
    bucket,
    close: async () => {
      controller.abort();
      try {
        await pump;
      } catch {
        // Abort is expected in some flows.
      }
    }
  };
};

const attachMessageBucket = (ws: WebSocket): MessageBucket => {
  const bucket: MessageBucket = { messages: [] };

  ws.addEventListener("message", (event) => {
    const parsed = JSON.parse(String(event.data)) as Record<string, unknown>;
    bucket.messages.push(parsed);
  });

  return bucket;
};

const waitForMessage = async <T extends Record<string, unknown>>(
  bucket: MessageBucket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 2_000
): Promise<T> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const index = bucket.messages.findIndex(predicate);
    if (index >= 0) {
      const [message] = bucket.messages.splice(index, 1);
      return message as T;
    }
    await delay(20);
  }

  throw new Error("Timed out waiting for websocket message.");
};

const waitForOptionalMessage = async <T extends Record<string, unknown>>(
  bucket: MessageBucket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 400
): Promise<T | null> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const index = bucket.messages.findIndex(predicate);
    if (index >= 0) {
      const [message] = bucket.messages.splice(index, 1);
      return message as T;
    }
    await delay(20);
  }

  return null;
};

const waitForSseEvent = async <T extends Record<string, unknown>>(
  bucket: SseBucket,
  predicate: (event: Record<string, unknown>) => boolean,
  timeoutMs = 3_000
): Promise<T> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const index = bucket.events.findIndex(predicate);
    if (index >= 0) {
      const [event] = bucket.events.splice(index, 1);
      return event as T;
    }
    await delay(20);
  }

  throw new Error("Timed out waiting for AI SSE event.");
};

const openSocket = async (
  url: string
): Promise<{ bucket: MessageBucket; ws: WebSocket }> => {
  const ws = new WebSocket(url);
  const bucket = attachMessageBucket(ws);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out opening websocket.")), 2_000);
    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket open failed."));
    });
  });

  return { bucket, ws };
};

const rawWebSocketHandshake = async (port: number, token: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let response = "";

    socket.on("connect", () => {
      socket.write(
        [
          `GET /v1/collab?token=${encodeURIComponent(token)} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: dGhpcy1pcy1hLXRlc3Qta2V5",
          "",
          ""
        ].join("\r\n")
      );
    });

    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString("utf8");
    });

    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });

const rawInvalidHandshake = async (port: number): Promise<string> =>
  rawWebSocketHandshake(port, "invalid-token");

const authHeaders = (accessToken?: string): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
};

const decodeJwtTimeWindow = (token: string): { exp: number; iat: number } => {
  const [, encodedPayload] = token.split(".");
  assert.ok(encodedPayload, "JWT payload segment must exist.");

  const padded = `${encodedPayload}${"=".repeat((4 - (encodedPayload.length % 4 || 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
    exp?: unknown;
    iat?: unknown;
  };

  assert.equal(typeof payload.iat, "number", "Demo login token must expose numeric iat.");
  assert.equal(typeof payload.exp, "number", "Demo login token must expose numeric exp.");

  return {
    iat: payload.iat as number,
    exp: payload.exp as number
  };
};

const loginDemoUser = async (baseUrl: string, userId: string, password: string): Promise<AuthSession> => {
  const response = await fetch(`${baseUrl}/v1/auth/demo-login`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ userId, password })
  });

  assert.equal(response.status, 200, "Demo login must return 200 for valid credentials.");
  const body = (await response.json()) as unknown;
  assert.equal(isDemoLoginResponse(body), true, "Demo login must match the documented auth contract.");

  const tokenWindow = decodeJwtTimeWindow((body as AuthSession).accessToken);
  assert.equal(
    (body as AuthSession).issuedAt,
    new Date(tokenWindow.iat * 1000).toISOString(),
    "Demo login must report the access token issue time from the JWT itself."
  );
  assert.equal(
    (body as AuthSession).expiresAt,
    new Date(tokenWindow.exp * 1000).toISOString(),
    "Demo login must report the access token expiry from the JWT itself."
  );
  assert.equal(
    tokenWindow.exp - tokenWindow.iat,
    Number(process.env.JWT_ACCESS_TTL_SECONDS?.trim() || 900),
    "Demo login access tokens must stay aligned with the short-lived configured JWT TTL."
  );

  return body as AuthSession;
};

const loginDemoUsernameAlias = async (baseUrl: string, username: string, password: string): Promise<AuthSession> => {
  const response = await fetch(`${baseUrl}/v1/auth/demo-login`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ username, password })
  });

  assert.equal(response.status, 200, "Demo login must accept username as an alias for userId.");
  const body = (await response.json()) as unknown;
  assert.equal(isDemoLoginResponse(body), true, "Username alias login must match the documented auth contract.");

  return body as AuthSession;
};

const main = async (): Promise<void> => {
  const baseUrl = await listen();
  const address = server.address() as AddressInfo;

  const unauthenticatedCreateResponse = await fetch(`${baseUrl}/v1/documents`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      workspaceId: "ws_123",
      title: "Auth required",
      templateId: null,
      initialContent: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            text: "Should fail without auth."
          }
        ]
      }
    })
  });
  assert.equal(unauthenticatedCreateResponse.status, 401, "Document create must require API auth.");
  const unauthenticatedCreateBody = (await unauthenticatedCreateResponse.json()) as unknown;
  assert.equal(isApiErrorEnvelope(unauthenticatedCreateBody), true);
  assert.equal(
    (unauthenticatedCreateBody as { error: { code: string } }).error.code,
    "AUTH_REQUIRED"
  );

  const owner = await loginDemoUser(baseUrl, "usr_assanali", "demo-assanali");
  const ownerViaUsernameAlias = await loginDemoUsernameAlias(baseUrl, "usr_assanali", "demo-assanali");
  assert.equal(ownerViaUsernameAlias.userId, owner.userId, "Username alias login must normalize to the same user.");
  const workspaceEditor = await loginDemoUser(baseUrl, "usr_dachi", "demo-dachi");
  const editor = await loginDemoUser(baseUrl, "usr_editor", "demo-editor");
  const viewer = await loginDemoUser(baseUrl, "usr_viewer", "demo-viewer");

  const createResponse = await fetch(`${baseUrl}/v1/documents`, {
    method: "POST",
    headers: authHeaders(owner.accessToken),
    body: JSON.stringify({
      workspaceId: "ws_123",
      title: "RBAC sharing baseline",
      templateId: null,
      initialContent: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            text: "Initial content from PoC."
          }
        ]
      }
    })
  });

  assert.equal(createResponse.status, 201, "Create endpoint must return 201 for authorized owners.");
  const createdBody = (await createResponse.json()) as unknown;
  assert.equal(
    isDocumentMetadataResponse(createdBody),
    true,
    "Create response must match documented metadata contract."
  );

  const created = createdBody as { documentId: string };

  const ownerListResponse = await fetch(`${baseUrl}/v1/documents`, {
    headers: authHeaders(owner.accessToken)
  });
  assert.equal(ownerListResponse.status, 200, "Dashboard list must return 200 for authenticated users.");
  const ownerListBody = (await ownerListResponse.json()) as unknown;
  assert.equal(isDocumentListResponse(ownerListBody), true);
  assert.equal(
    (ownerListBody as { documents: Array<{ documentId: string }> }).documents.some(
      (document) => document.documentId === created.documentId
    ),
    true,
    "Created documents must appear in the authenticated dashboard list."
  );

  const unauthenticatedLoadResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`);
  assert.equal(unauthenticatedLoadResponse.status, 401, "Document load must require API auth.");
  const unauthenticatedLoadBody = (await unauthenticatedLoadResponse.json()) as unknown;
  assert.equal(isApiErrorEnvelope(unauthenticatedLoadBody), true);
  assert.equal(
    (unauthenticatedLoadBody as { error: { code: string } }).error.code,
    "AUTH_REQUIRED"
  );

  const ownerLoadResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`, {
    headers: authHeaders(owner.accessToken)
  });
  assert.equal(ownerLoadResponse.status, 200, "Owner must load the document.");
  const ownerLoadBody = (await ownerLoadResponse.json()) as unknown;
  assert.equal(
    isDocumentDetailResponse(ownerLoadBody),
    true,
    "Document detail response must match the shared contract."
  );

  const invalidHandshakeResponse = await rawInvalidHandshake(address.port);
  assert.match(invalidHandshakeResponse, /HTTP\/1\.1 401 Unauthorized/u);
  assert.match(invalidHandshakeResponse, /AUTH_INVALID_TOKEN/u);
  console.log("ws-auth: invalid token rejected with HTTP 401");

  const unsharedEditorLoadResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`, {
    headers: authHeaders(editor.accessToken)
  });
  assert.equal(unsharedEditorLoadResponse.status, 403, "Unshared external users must be denied before sharing.");
  const unsharedEditorLoadBody = (await unsharedEditorLoadResponse.json()) as unknown;
  assert.equal(isApiErrorEnvelope(unsharedEditorLoadBody), true);
  assert.equal(
    (unsharedEditorLoadBody as { error: { code: string } }).error.code,
    "AUTHZ_FORBIDDEN"
  );
  console.log("share-gate: external user denied before explicit share");

  const editorShareResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}/shares`, {
    method: "POST",
    headers: authHeaders(owner.accessToken),
    body: JSON.stringify({
      principalType: "user",
      principalId: "usr_editor",
      permissionLevel: "editor"
    })
  });
  assert.equal(editorShareResponse.status, 201, "Owner must be able to share by username.");
  const editorShareBody = (await editorShareResponse.json()) as unknown;
  assert.equal(isDocumentShareResponse(editorShareBody), true);
  const editorShare = editorShareBody as {
    permission: { shareId: string };
  };

  const viewerShareResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}/shares`, {
    method: "POST",
    headers: authHeaders(owner.accessToken),
    body: JSON.stringify({
      principalType: "user",
      principalId: "viewer@demo.local",
      permissionLevel: "viewer"
    })
  });
  assert.equal(viewerShareResponse.status, 201, "Owner must be able to share by email.");
  const viewerShareBody = (await viewerShareResponse.json()) as unknown;
  assert.equal(isDocumentShareResponse(viewerShareBody), true);

  const permissionsResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}/permissions`, {
    headers: authHeaders(owner.accessToken)
  });
  assert.equal(permissionsResponse.status, 200, "Owner must be able to inspect the ACL.");
  const permissionsBody = (await permissionsResponse.json()) as unknown;
  assert.equal(isDocumentPermissionsResponse(permissionsBody), true);
  const permissions = permissionsBody as {
    permissions: Array<{ permissionLevel: string; source: string; userId: string }>;
  };
  const permissionTriples = permissions.permissions.map((permission) => [
    permission.userId,
    permission.permissionLevel,
    permission.source
  ]);
  assert.ok(
    permissionTriples.some(
      ([userId, permissionLevel, source]) =>
        userId === "usr_assanali" && permissionLevel === "owner" && source === "owner"
    ),
    "Owner permission must be present in the ACL."
  );
  assert.ok(
    permissionTriples.some(
      ([userId, permissionLevel, source]) =>
        userId === "usr_dachi" && permissionLevel === "editor" && source === "workspace"
    ),
    "Workspace editor permission must be present in the ACL."
  );
  assert.ok(
    permissionTriples.some(
      ([userId, permissionLevel, source]) =>
        userId === "usr_editor" && permissionLevel === "editor" && source === "share"
    ),
    "Explicit shared editor permission must be present in the ACL."
  );
  assert.ok(
    permissionTriples.some(
      ([userId, permissionLevel, source]) =>
        userId === "usr_viewer" && permissionLevel === "viewer" && source === "share"
    ),
    "Explicit shared viewer permission must be present in the ACL."
  );
  console.log("rbac: role matrix includes owner, workspace editors, shared editor, and shared viewer");

  const editorCannotReshareResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}/shares`, {
    method: "POST",
    headers: authHeaders(editor.accessToken),
    body: JSON.stringify({
      principalType: "user",
      principalId: "usr_dachi",
      permissionLevel: "viewer"
    })
  });
  assert.equal(editorCannotReshareResponse.status, 403, "Editors must not manage sharing.");
  const editorCannotReshareBody = (await editorCannotReshareResponse.json()) as unknown;
  assert.equal(isApiErrorEnvelope(editorCannotReshareBody), true);
  assert.equal(
    (editorCannotReshareBody as { error: { code: string } }).error.code,
    "AUTHZ_FORBIDDEN"
  );

  const editorLoadResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`, {
    headers: authHeaders(editor.accessToken)
  });
  assert.equal(editorLoadResponse.status, 200, "Shared editor must load the document.");

  const viewerLoadResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`, {
    headers: authHeaders(viewer.accessToken)
  });
  assert.equal(viewerLoadResponse.status, 200, "Shared viewer must load the document read-only.");

  const viewerPatchResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`, {
    method: "PATCH",
    headers: authHeaders(viewer.accessToken),
    body: JSON.stringify({
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            text: "Viewer should not be able to overwrite this document."
          }
        ]
      }
    })
  });
  assert.equal(viewerPatchResponse.status, 403, "Viewer direct API edit attempts must be denied.");
  const viewerPatchBody = (await viewerPatchResponse.json()) as unknown;
  assert.equal(isApiErrorEnvelope(viewerPatchBody), true);
  assert.equal(
    (viewerPatchBody as { error: { code: string } }).error.code,
    "AUTHZ_FORBIDDEN"
  );
  console.log("rbac: viewer direct API edit rejected with 403 AUTHZ_FORBIDDEN");

  const editorPatchResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`, {
    method: "PATCH",
    headers: authHeaders(editor.accessToken),
    body: JSON.stringify({
      title: "RBAC sharing baseline (edited)",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            text: "Editor update applied through the direct document API."
          }
        ]
      }
    })
  });
  assert.equal(editorPatchResponse.status, 200, "Editors must be allowed to update document content.");
  const editorPatchBody = (await editorPatchResponse.json()) as unknown;
  assert.equal(isDocumentDetailResponse(editorPatchBody), true);
  assert.equal(
    (editorPatchBody as { content: { content: Array<{ text: string }> } }).content.content[0]?.text,
    "Editor update applied through the direct document API."
  );

  const createSession = async (accessToken: string, documentId = created.documentId): Promise<{
    documentId: string;
    sessionId: string;
    sessionToken: string;
    wsUrl: string;
  }> => {
    const response = await fetch(`${baseUrl}/v1/documents/${documentId}/sessions`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({})
    });

    assert.equal(response.status, 201, "Session bootstrap must return 201 for editable users.");
    const body = (await response.json()) as unknown;
    assert.equal(
      isCollaborationSessionResponse(body),
      true,
      "Session bootstrap must match the collaboration session contract."
    );

    return body as {
      documentId: string;
      sessionId: string;
      sessionToken: string;
      wsUrl: string;
    };
  };

  const versionCreateResponse = await fetch(`${baseUrl}/v1/documents`, {
    method: "POST",
    headers: authHeaders(owner.accessToken),
    body: JSON.stringify({
      workspaceId: "ws_123",
      title: "Version history baseline",
      templateId: null,
      initialContent: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            text: "Version one content."
          }
        ]
      }
    })
  });
  assert.equal(versionCreateResponse.status, 201, "Version test fixture document must be created.");
  const versionCreateBody = (await versionCreateResponse.json()) as unknown;
  assert.equal(isDocumentMetadataResponse(versionCreateBody), true);
  const versionedDocument = versionCreateBody as { documentId: string; currentVersionId: string };
  assert.equal(versionedDocument.currentVersionId, "ver_001");

  const initialVersionsResponse = await fetch(
    `${baseUrl}/v1/documents/${versionedDocument.documentId}/versions`,
    {
      headers: authHeaders(owner.accessToken)
    }
  );
  assert.equal(initialVersionsResponse.status, 200, "Version list must return 200 for readable documents.");
  const initialVersionsBody = (await initialVersionsResponse.json()) as unknown;
  assert.equal(isDocumentVersionsResponse(initialVersionsBody), true);
  const initialVersions = initialVersionsBody as {
    currentVersionId: string;
    versions: Array<{ versionId: string; versionNumber: number }>;
  };
  assert.equal(initialVersions.currentVersionId, "ver_001");
  assert.deepEqual(
    initialVersions.versions.map((version) => [version.versionId, version.versionNumber]),
    [["ver_001", 1]]
  );

  const firstVersionResponse = await fetch(
    `${baseUrl}/v1/documents/${versionedDocument.documentId}/versions/ver_001`,
    {
      headers: authHeaders(owner.accessToken)
    }
  );
  assert.equal(firstVersionResponse.status, 200, "Version fetch must return 200 for existing snapshots.");
  const firstVersionBody = (await firstVersionResponse.json()) as unknown;
  assert.equal(isDocumentVersionResponse(firstVersionBody), true);
  assert.equal(
    (firstVersionBody as { content: { content: Array<{ text: string }> } }).content.content[0]?.text,
    "Version one content."
  );

  const versionPatchResponse = await fetch(`${baseUrl}/v1/documents/${versionedDocument.documentId}`, {
    method: "PATCH",
    headers: authHeaders(owner.accessToken),
    body: JSON.stringify({
      title: "Version history baseline (edited)",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            text: "Version two content."
          }
        ]
      }
    })
  });
  assert.equal(versionPatchResponse.status, 200, "Direct updates must create a new version head.");
  const versionPatchBody = (await versionPatchResponse.json()) as unknown;
  assert.equal(isDocumentDetailResponse(versionPatchBody), true);
  assert.equal((versionPatchBody as { currentVersionId: string }).currentVersionId, "ver_002");

  const secondVersionsResponse = await fetch(
    `${baseUrl}/v1/documents/${versionedDocument.documentId}/versions`,
    {
      headers: authHeaders(owner.accessToken)
    }
  );
  assert.equal(secondVersionsResponse.status, 200);
  const secondVersionsBody = (await secondVersionsResponse.json()) as unknown;
  assert.equal(isDocumentVersionsResponse(secondVersionsBody), true);
  const secondVersions = secondVersionsBody as {
    currentVersionId: string;
    versions: Array<{ changeSummary: string; versionId: string }>;
  };
  assert.equal(secondVersions.currentVersionId, "ver_002");
  assert.deepEqual(
    secondVersions.versions.map((version) => version.versionId),
    ["ver_001", "ver_002"]
  );
  assert.equal(secondVersions.versions[1]?.changeSummary, "Updated title and content");

  const versionOwnerSession = await createSession(owner.accessToken, versionedDocument.documentId);
  const versionEditorSession = await createSession(workspaceEditor.accessToken, versionedDocument.documentId);
  const versionOwnerSocket = await openSocket(
    `${versionOwnerSession.wsUrl}?token=${encodeURIComponent(versionOwnerSession.sessionToken)}`
  );
  const ownerVersionBootstrap = await waitForMessage<{
    serverRevision: number;
    text: string;
    type: string;
  }>(versionOwnerSocket.bucket, (message) => message.type === "server.bootstrap");
  assert.equal(ownerVersionBootstrap.serverRevision, 1);
  assert.equal(ownerVersionBootstrap.text, "Version two content.");

  const versionEditorSocket = await openSocket(
    `${versionEditorSession.wsUrl}?token=${encodeURIComponent(versionEditorSession.sessionToken)}`
  );
  await waitForMessage(versionEditorSocket.bucket, (message) => message.type === "server.bootstrap");
  await waitForMessage(
    versionOwnerSocket.bucket,
    (message) => message.type === "server.presence" && Array.isArray(message.participants)
  );
  await waitForMessage(
    versionEditorSocket.bucket,
    (message) => message.type === "server.presence" && Array.isArray(message.participants)
  );

  const editorRestoreForbiddenResponse = await fetch(
    `${baseUrl}/v1/documents/${versionedDocument.documentId}/versions/ver_001:revert`,
    {
      method: "POST",
      headers: authHeaders(workspaceEditor.accessToken)
    }
  );
  assert.equal(editorRestoreForbiddenResponse.status, 403, "Only owners must be allowed to restore versions.");
  const editorRestoreForbiddenBody = (await editorRestoreForbiddenResponse.json()) as unknown;
  assert.equal(isApiErrorEnvelope(editorRestoreForbiddenBody), true);
  assert.equal(
    (editorRestoreForbiddenBody as { error: { code: string } }).error.code,
    "AUTHZ_FORBIDDEN"
  );

  const restoreResponse = await fetch(
    `${baseUrl}/v1/documents/${versionedDocument.documentId}/versions/ver_001:revert`,
    {
      method: "POST",
      headers: authHeaders(owner.accessToken)
    }
  );
  assert.equal(restoreResponse.status, 202, "Restore must create a new head version.");
  const restoreBody = (await restoreResponse.json()) as unknown;
  assert.equal(isDocumentRestoreResponse(restoreBody), true);
  const restore = restoreBody as {
    currentVersionId: string;
    restoredFromVersionId: string;
  };
  assert.equal(restore.restoredFromVersionId, "ver_001");
  assert.equal(restore.currentVersionId, "ver_003");

  const ownerReloadRequired = await waitForMessage<{
    newVersionId: string;
    reason: string;
    serverRevision: number;
    text: string;
    type: string;
  }>(
    versionOwnerSocket.bucket,
    (message) => message.type === "server.reload_required"
  );
  assert.equal(ownerReloadRequired.reason, "revert_created_new_head");
  assert.equal(ownerReloadRequired.newVersionId, "ver_003");
  assert.equal(ownerReloadRequired.serverRevision, 2);
  assert.equal(ownerReloadRequired.text, "Version one content.");

  const editorReloadRequired = await waitForMessage<{
    newVersionId: string;
    text: string;
    type: string;
  }>(
    versionEditorSocket.bucket,
    (message) => message.type === "server.reload_required"
  );
  assert.equal(editorReloadRequired.newVersionId, "ver_003");
  assert.equal(editorReloadRequired.text, "Version one content.");

  const restoredLoadResponse = await fetch(`${baseUrl}/v1/documents/${versionedDocument.documentId}`, {
    headers: authHeaders(owner.accessToken)
  });
  assert.equal(restoredLoadResponse.status, 200);
  const restoredLoadBody = (await restoredLoadResponse.json()) as unknown;
  assert.equal(isDocumentDetailResponse(restoredLoadBody), true);
  assert.equal((restoredLoadBody as { currentVersionId: string }).currentVersionId, "ver_003");
  assert.equal(
    (restoredLoadBody as { content: { content: Array<{ text: string }> } }).content.content[0]?.text,
    "Version one content."
  );

  const restoredVersionResponse = await fetch(
    `${baseUrl}/v1/documents/${versionedDocument.documentId}/versions/ver_003`,
    {
      headers: authHeaders(owner.accessToken)
    }
  );
  assert.equal(restoredVersionResponse.status, 200);
  const restoredVersionBody = (await restoredVersionResponse.json()) as unknown;
  assert.equal(isDocumentVersionResponse(restoredVersionBody), true);
  const restoredVersion = restoredVersionBody as {
    basedOnVersionId: string | null;
    changeSummary: string;
    isRevert: boolean;
  };
  assert.equal(restoredVersion.isRevert, true);
  assert.equal(restoredVersion.basedOnVersionId, "ver_001");
  assert.equal(restoredVersion.changeSummary, "Restored from version ver_001");
  console.log("versions: list/fetch/revert create immutable snapshots and restore a new head state");

  versionEditorSocket.ws.close();
  versionOwnerSocket.ws.close();

  const viewerSessionResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}/sessions`, {
    method: "POST",
    headers: authHeaders(viewer.accessToken),
    body: JSON.stringify({})
  });
  assert.equal(viewerSessionResponse.status, 403, "Viewer must be blocked from mutable collaboration sessions.");
  const viewerSessionBody = (await viewerSessionResponse.json()) as unknown;
  assert.equal(isApiErrorEnvelope(viewerSessionBody), true);
  assert.equal(
    (viewerSessionBody as { error: { code: string } }).error.code,
    "AUTHZ_FORBIDDEN"
  );
  const viewerAiCreateResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}/ai/jobs`, {
    method: "POST",
    headers: authHeaders(viewer.accessToken),
    body: JSON.stringify({
      feature: "rewrite",
      selection: {
        start: 0,
        end: "Editor update applied through the direct document API.".length,
        text: "Editor update applied through the direct document API."
      },
      context: {
        before: "",
        after: ""
      },
      instructions: "Make it concise"
    })
  });
  assert.equal(viewerAiCreateResponse.status, 403, "Viewer must be blocked from direct AI invocation.");
  const viewerAiCreateBody = (await viewerAiCreateResponse.json()) as unknown;
  assert.equal(isApiErrorEnvelope(viewerAiCreateBody), true);
  assert.equal(
    (viewerAiCreateBody as { error: { code: string } }).error.code,
    "AUTHZ_FORBIDDEN"
  );
  console.log("rbac: viewer direct AI invocation rejected with 403 AUTHZ_FORBIDDEN");

  const ownerSession = await createSession(owner.accessToken);
  const editorSession = await createSession(editor.accessToken);

  const ownerSocket = await openSocket(
    `${ownerSession.wsUrl}?token=${encodeURIComponent(ownerSession.sessionToken)}`
  );
  const bootstrapOwner = await waitForMessage<{
    serverRevision: number;
    text: string;
    type: string;
  }>(ownerSocket.bucket, (message) => message.type === "server.bootstrap");
  assert.equal(bootstrapOwner.serverRevision, 1);
  assert.equal(bootstrapOwner.text, "Editor update applied through the direct document API.");

  const editorSocket = await openSocket(
    `${editorSession.wsUrl}?token=${encodeURIComponent(editorSession.sessionToken)}`
  );
  await waitForMessage(editorSocket.bucket, (message) => message.type === "server.bootstrap");

  const presenceForOwner = await waitForMessage<{ participants: Array<{ userId: string }> }>(
    ownerSocket.bucket,
    (message) =>
      message.type === "server.presence" &&
      Array.isArray(message.participants) &&
      message.participants.length === 2
  );
  const presenceForEditor = await waitForMessage<{ participants: Array<{ userId: string }> }>(
    editorSocket.bucket,
    (message) =>
      message.type === "server.presence" &&
      Array.isArray(message.participants) &&
      message.participants.length === 2
  );
  assert.deepEqual(
    presenceForOwner.participants.map((participant) => participant.userId).sort(),
    ["usr_assanali", "usr_editor"]
  );
  assert.deepEqual(
    presenceForEditor.participants.map((participant) => participant.userId).sort(),
    ["usr_assanali", "usr_editor"]
  );
  console.log("presence: owner and shared editor see the same online user list");

  editorSocket.ws.close();
  const afterDisconnectPresence = await waitForMessage<{ participants: Array<{ userId: string }> }>(
    ownerSocket.bucket,
    (message) =>
      message.type === "server.presence" &&
      Array.isArray(message.participants) &&
      message.participants.length === 1
  );
  assert.deepEqual(afterDisconnectPresence.participants.map((participant) => participant.userId), ["usr_assanali"]);
  console.log("presence: disconnect removed the offline shared editor from the room");

  const reconnectedEditor = await openSocket(
    `${editorSession.wsUrl}?token=${encodeURIComponent(editorSession.sessionToken)}`
  );
  const reconnectBootstrap = await waitForMessage<{
    serverRevision: number;
    text: string;
    type: string;
  }>(reconnectedEditor.bucket, (message) => message.type === "server.bootstrap");
  assert.equal(reconnectBootstrap.text, "Editor update applied through the direct document API.");

  const afterReconnectPresence = await waitForMessage<{ participants: Array<{ userId: string }> }>(
    ownerSocket.bucket,
    (message) =>
      message.type === "server.presence" &&
      Array.isArray(message.participants) &&
      message.participants.length === 2
  );
  assert.deepEqual(
    afterReconnectPresence.participants.map((participant) => participant.userId).sort(),
    ["usr_assanali", "usr_editor"]
  );

  const offlineReplayMessage = {
    type: "client.update",
    sessionId: editorSession.sessionId,
    clientSeq: 1,
    mutationId: "mut-offline-replay",
    baseRevision: reconnectBootstrap.serverRevision,
    text: "Offline edit from reconnecting shared editor."
  };

  reconnectedEditor.ws.send(JSON.stringify(offlineReplayMessage));

  const firstAck = await waitForMessage<{
    mutationId: string;
    serverRevision: number;
    text: string;
    type: string;
  }>(
    reconnectedEditor.bucket,
    (message) =>
      message.type === "server.ack" &&
      message.mutationId === offlineReplayMessage.mutationId
  );
  assert.equal(firstAck.serverRevision, 2);
  assert.equal(firstAck.text, offlineReplayMessage.text);

  const remoteUpdateForOwner = await waitForMessage<{
    mutationId: string;
    serverRevision: number;
    text: string;
    type: string;
  }>(
    ownerSocket.bucket,
    (message) =>
      message.type === "server.update" &&
      message.mutationId === offlineReplayMessage.mutationId
  );
  assert.equal(remoteUpdateForOwner.serverRevision, 2);
  assert.equal(remoteUpdateForOwner.text, offlineReplayMessage.text);

  reconnectedEditor.ws.send(JSON.stringify(offlineReplayMessage));

  const duplicateAck = await waitForMessage<{
    mutationId: string;
    serverRevision: number;
    type: string;
  }>(
    reconnectedEditor.bucket,
    (message) =>
      message.type === "server.ack" &&
      message.mutationId === offlineReplayMessage.mutationId
  );
  assert.equal(duplicateAck.serverRevision, firstAck.serverRevision);

  const duplicateBroadcast = await waitForOptionalMessage(
    ownerSocket.bucket,
    (message) =>
      message.type === "server.update" &&
      message.mutationId === offlineReplayMessage.mutationId
  );
  assert.equal(duplicateBroadcast, null, "Duplicate replay must not rebroadcast the same mutation.");

  const persistedLoadResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`, {
    headers: authHeaders(owner.accessToken)
  });
  assert.equal(persistedLoadResponse.status, 200);
  const persistedBody = (await persistedLoadResponse.json()) as unknown;
  assert.equal(isDocumentDetailResponse(persistedBody), true);
  assert.equal(
    (persistedBody as { content: { content: Array<{ text: string }> } }).content.content[0]?.text,
    offlineReplayMessage.text
  );
  console.log("reconnect: resync applied once and the latest shared text persisted");
  const createAiJob = async (
    feature: "rewrite" | "summarize",
    documentText: string
  ): Promise<{
    createdAt: string;
    documentId: string;
    jobId: string;
    streamToken: string;
    streamUrl: string;
  }> => {
    const response = await fetch(`${baseUrl}/v1/documents/${created.documentId}/ai/jobs`, {
      method: "POST",
      headers: authHeaders(owner.accessToken),
      body: JSON.stringify({
        feature,
        selection: {
          start: 0,
          end: documentText.length,
          text: documentText
        },
        context: {
          before: "",
          after: ""
        },
        instructions: feature === "rewrite" ? "Make it concise" : null
      })
    });

    assert.equal(response.status, 201, "AI job creation must return 201.");
    const body = (await response.json()) as unknown;
    assert.equal(isCreateAiJobResponse(body), true, "AI job creation must match the shared contract.");
    return body as {
      createdAt: string;
      documentId: string;
      jobId: string;
      streamToken: string;
      streamUrl: string;
      };
  };

  const completeAiJob = async (job: {
    jobId: string;
    streamToken: string;
    streamUrl: string;
  }): Promise<string> => {
    const stream = await openSseStream(`${job.streamUrl}?token=${encodeURIComponent(job.streamToken)}`);
    await waitForSseEvent<{ status: string }>(
      stream.bucket,
      (event) => event.type === "ai.status" && typeof event.status === "string"
    );
    const chunk = await waitForSseEvent<{ outputText: string; type: string }>(
      stream.bucket,
      (event) =>
        event.type === "ai.chunk" &&
        typeof event.outputText === "string" &&
        event.outputText.length > 0
    );
    const completed = await waitForSseEvent<{ outputText: string; status: string; type: string }>(
      stream.bucket,
      (event) =>
        event.type === "ai.completed" &&
        event.status === "completed" &&
        typeof event.outputText === "string"
    );
    assert.ok(
      chunk.outputText.length < completed.outputText.length,
      "AI stream must deliver progressive chunks before completion."
    );
    await stream.close();
    return completed.outputText;
  };

  const rewriteJob = await createAiJob("rewrite", offlineReplayMessage.text);
  const queuedDecisionResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/ai/jobs/${rewriteJob.jobId}/decision`,
    {
      method: "POST",
      headers: authHeaders(owner.accessToken),
      body: JSON.stringify({
        decision: "rejected",
        appliedText: null
      })
    }
  );
  assert.equal(queuedDecisionResponse.status, 409, "Queued AI jobs must reject decision writes.");
  const queuedDecisionBody = (await queuedDecisionResponse.json()) as { error: { code: string } };
  assert.equal(queuedDecisionBody.error.code, "AI_JOB_NOT_COMPLETED");
  const rewriteCompleted = await completeAiJob(rewriteJob);
  console.log("ai-stream: rewrite streamed progressive output and completed");

  const historyAfterRewriteResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/ai/jobs`,
    {
      headers: authHeaders(owner.accessToken)
    }
  );
  assert.equal(historyAfterRewriteResponse.status, 200, "AI history endpoint must return 200.");
  const historyAfterRewriteBody = (await historyAfterRewriteResponse.json()) as unknown;
  assert.equal(isAiHistoryResponse(historyAfterRewriteBody), true, "AI history must match the shared contract.");
  const rewriteHistoryRecord = (
    historyAfterRewriteBody as { jobs: Array<{ jobId: string; status: string; decision: string }> }
  ).jobs.find((job) => job.jobId === rewriteJob.jobId);
  assert.ok(rewriteHistoryRecord, "Completed rewrite job must be present in history.");
  assert.equal(rewriteHistoryRecord.jobId, rewriteJob.jobId);
  assert.equal(rewriteHistoryRecord.status, "completed");
  assert.equal(rewriteHistoryRecord.decision, "pending");
  assert.equal(
    typeof (rewriteHistoryRecord as { promptSystem?: unknown }).promptSystem,
    "string",
    "AI history must retain the exact system prompt."
  );
  assert.equal(
    typeof (rewriteHistoryRecord as { promptUser?: unknown }).promptUser,
    "string",
    "AI history must retain the exact user prompt."
  );
  assert.equal(
    typeof (rewriteHistoryRecord as { contextBefore?: unknown }).contextBefore,
    "string",
    "AI history must retain context before the selection."
  );
  assert.equal(
    typeof (rewriteHistoryRecord as { contextAfter?: unknown }).contextAfter,
    "string",
    "AI history must retain context after the selection."
  );

  const acceptDecisionResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/ai/jobs/${rewriteJob.jobId}/decision`,
    {
      method: "POST",
      headers: authHeaders(owner.accessToken),
      body: JSON.stringify({
        decision: "accepted",
        appliedText: rewriteCompleted
      })
    }
  );
  assert.equal(acceptDecisionResponse.status, 200, "AI decision endpoint must persist accepted state.");
  const crossUserDecisionResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/ai/jobs/${rewriteJob.jobId}/decision`,
    {
      method: "POST",
      headers: authHeaders(editor.accessToken),
      body: JSON.stringify({
        decision: "rejected",
        appliedText: null
      })
    }
  );
  assert.equal(crossUserDecisionResponse.status, 403, "Only the requesting user may mutate AI job decisions.");
  const crossUserDecisionBody = (await crossUserDecisionResponse.json()) as { error: { code: string } };
  assert.equal(crossUserDecisionBody.error.code, "AI_JOB_FORBIDDEN");
  const rejectAfterAcceptResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/ai/jobs/${rewriteJob.jobId}/decision`,
    {
      method: "POST",
      headers: authHeaders(owner.accessToken),
      body: JSON.stringify({
        decision: "rejected",
        appliedText: null
      })
    }
  );
  assert.equal(rejectAfterAcceptResponse.status, 409, "Accepted AI jobs must reject a later reject decision.");
  const rejectAfterAcceptBody = (await rejectAfterAcceptResponse.json()) as { error: { code: string } };
  assert.equal(rejectAfterAcceptBody.error.code, "AI_DECISION_CONFLICT");
  const undoAfterAcceptResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/ai/jobs/${rewriteJob.jobId}/decision`,
    {
      method: "POST",
      headers: authHeaders(owner.accessToken),
      body: JSON.stringify({
        decision: "undone",
        appliedText: rewriteCompleted
      })
    }
  );
  assert.equal(undoAfterAcceptResponse.status, 200, "Accepted AI jobs must allow an undo decision.");
  const undoAfterAcceptBody = (await undoAfterAcceptResponse.json()) as {
    appliedText: string | null;
    decision: string;
  };
  assert.equal(undoAfterAcceptBody.decision, "undone");
  assert.equal(undoAfterAcceptBody.appliedText, rewriteCompleted);
  const secondUndoResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/ai/jobs/${rewriteJob.jobId}/decision`,
    {
      method: "POST",
      headers: authHeaders(owner.accessToken),
      body: JSON.stringify({
        decision: "undone",
        appliedText: rewriteCompleted
      })
    }
  );
  assert.equal(secondUndoResponse.status, 409, "Undone AI jobs must remain terminal.");
  console.log("ai-history: queued decisions are rejected and only the requesting user may mutate AI job decisions");
  console.log("ai-history: accepted jobs reject later reject writes and still allow a single undo transition");

  const editedJob = await createAiJob("rewrite", offlineReplayMessage.text);
  const editedOutput = await completeAiJob(editedJob);
  const editedDecisionResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/ai/jobs/${editedJob.jobId}/decision`,
    {
      method: "POST",
      headers: authHeaders(owner.accessToken),
      body: JSON.stringify({
        decision: "edited",
        appliedText: `${editedOutput} Manual final sentence.`
      })
    }
  );
  assert.equal(editedDecisionResponse.status, 200, "Completed AI jobs must allow an edited final decision.");
  const rejectAfterEditResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/ai/jobs/${editedJob.jobId}/decision`,
    {
      method: "POST",
      headers: authHeaders(owner.accessToken),
      body: JSON.stringify({
        decision: "rejected",
        appliedText: null
      })
    }
  );
  assert.equal(rejectAfterEditResponse.status, 409, "Edited AI jobs must reject a later reject decision.");
  const rejectAfterEditBody = (await rejectAfterEditResponse.json()) as { error: { code: string } };
  assert.equal(rejectAfterEditBody.error.code, "AI_DECISION_CONFLICT");
  console.log("ai-history: edited jobs also reject later reject writes");

  const summarizeJob = await createAiJob("summarize", offlineReplayMessage.text);
  const summarizeStream = await openSseStream(
    `${summarizeJob.streamUrl}?token=${encodeURIComponent(summarizeJob.streamToken)}`
  );
  await waitForSseEvent<{ status: string }>(
    summarizeStream.bucket,
    (event) => event.type === "ai.status" && typeof event.status === "string"
  );
  await waitForSseEvent<{ outputText: string }>(
    summarizeStream.bucket,
    (event) => event.type === "ai.chunk" && typeof event.outputText === "string"
  );
  const cancelResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/ai/jobs/${summarizeJob.jobId}/cancel`,
    {
      method: "POST",
      headers: authHeaders(owner.accessToken)
    }
  );
  assert.equal(cancelResponse.status, 200, "AI cancel endpoint must return 200.");
  const canceledEvent = await waitForSseEvent<{ status: string; type: string }>(
    summarizeStream.bucket,
    (event) => event.type === "ai.canceled" && event.status === "canceled"
  );
  assert.equal(canceledEvent.status, "canceled");
  await summarizeStream.close();
  console.log("ai-stream: summarize stream canceled successfully before completion");

  const historyAfterCancelResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/ai/jobs`,
    {
      headers: authHeaders(owner.accessToken)
    }
  );
  const historyAfterCancelBody = (await historyAfterCancelResponse.json()) as unknown;
  assert.equal(isAiHistoryResponse(historyAfterCancelBody), true);
  const summarizeHistoryRecord = (
    historyAfterCancelBody as { jobs: Array<{ jobId: string; status: string }> }
  ).jobs.find((job) => job.jobId === summarizeJob.jobId);
  assert.ok(summarizeHistoryRecord, "Canceled summarize job must remain in history.");
  assert.equal(summarizeHistoryRecord.jobId, summarizeJob.jobId);
  assert.equal(summarizeHistoryRecord.status, "canceled");
  console.log("ai-history: canceled summarize job is retained in per-document history");

  const downgradedShareResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/shares/${editorShare.permission.shareId}`,
    {
      method: "PATCH",
      headers: authHeaders(owner.accessToken),
      body: JSON.stringify({
        principalType: "user",
        principalId: "usr_editor",
        permissionLevel: "viewer"
      })
    }
  );
  assert.equal(downgradedShareResponse.status, 200, "Owner must be able to downgrade an existing share.");
  const downgradedShareBody = (await downgradedShareResponse.json()) as unknown;
  assert.equal(isDocumentShareResponse(downgradedShareBody), true);

  const revokedUpdateMessage = {
    type: "client.update",
    sessionId: editorSession.sessionId,
    clientSeq: 2,
    mutationId: "mut-revoked-session",
    baseRevision: firstAck.serverRevision,
    text: "Revoked editor should not be able to write."
  };
  reconnectedEditor.ws.send(JSON.stringify(revokedUpdateMessage));

  const revokedError = await waitForMessage<{
    code: string;
    message: string;
    type: string;
  }>(
    reconnectedEditor.bucket,
    (message) => message.type === "server.error" && message.code === "COLLAB_ACCESS_REVOKED"
  );
  assert.match(revokedError.message, /no longer has edit access/u);

  const revokedOwnerUpdate = await waitForOptionalMessage(
    ownerSocket.bucket,
    (message) =>
      message.type === "server.update" &&
      message.mutationId === revokedUpdateMessage.mutationId,
    600
  );
  assert.equal(revokedOwnerUpdate, null, "Revoked session tokens must not broadcast document mutations.");

  const staleSessionHandshakeResponse = await rawWebSocketHandshake(address.port, editorSession.sessionToken);
  assert.match(staleSessionHandshakeResponse, /HTTP\/1\.1 403 Forbidden/u);
  assert.match(staleSessionHandshakeResponse, /AUTHZ_FORBIDDEN/u);

  const downgradedSessionResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}/sessions`, {
    method: "POST",
    headers: authHeaders(editor.accessToken),
    body: JSON.stringify({})
  });
  assert.equal(
    downgradedSessionResponse.status,
    403,
    "Users downgraded to viewer must not bootstrap new collaboration sessions."
  );
  const downgradedSessionBody = (await downgradedSessionResponse.json()) as unknown;
  assert.equal(isApiErrorEnvelope(downgradedSessionBody), true);
  assert.equal(
    (downgradedSessionBody as { error: { code: string } }).error.code,
    "AUTHZ_FORBIDDEN"
  );

  const postDowngradeLoadResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`, {
    headers: authHeaders(owner.accessToken)
  });
  assert.equal(postDowngradeLoadResponse.status, 200);
  const postDowngradeLoadBody = (await postDowngradeLoadResponse.json()) as unknown;
  assert.equal(isDocumentDetailResponse(postDowngradeLoadBody), true);
  assert.equal(
    (postDowngradeLoadBody as { content: { content: Array<{ text: string }> } }).content.content[0]?.text,
    offlineReplayMessage.text
  );
  console.log("rbac: downgraded editor session token can no longer mutate or reconnect");

  reconnectedEditor.ws.close();
  ownerSocket.ws.close();

  const editorDeleteResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`, {
    method: "DELETE",
    headers: authHeaders(editor.accessToken)
  });
  assert.equal(editorDeleteResponse.status, 403, "Shared editors must not delete owner documents.");
  const editorDeleteBody = (await editorDeleteResponse.json()) as { error: { code: string } };
  assert.equal(editorDeleteBody.error.code, "AUTHZ_FORBIDDEN");

  const ownerDeleteResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`, {
    method: "DELETE",
    headers: authHeaders(owner.accessToken)
  });
  assert.equal(ownerDeleteResponse.status, 204, "Owners must be able to delete documents.");
  assert.equal(await ownerDeleteResponse.text(), "");

  const ownerListAfterDelete = await fetch(`${baseUrl}/v1/documents`, {
    headers: authHeaders(owner.accessToken)
  });
  assert.equal(ownerListAfterDelete.status, 200);
  const ownerListAfterDeleteBody = (await ownerListAfterDelete.json()) as { documents: Array<{ documentId: string }> };
  assert.equal(
    ownerListAfterDeleteBody.documents.some((document) => document.documentId === created.documentId),
    false,
    "Deleted documents must disappear from the dashboard list."
  );

  const missingAfterDelete = await fetch(`${baseUrl}/v1/documents/${created.documentId}`, {
    headers: authHeaders(owner.accessToken)
  });
  assert.equal(missingAfterDelete.status, 404, "Deleted documents must no longer load.");
  console.log("doc-delete: owner-only delete removes the document from subsequent list/load flows");

  console.log("API + websocket contract tests passed.");
};

main().catch(async (error) => {
  console.error("API contract tests failed:", error);
  try {
    await close();
  } catch {
    // Best effort cleanup in failure path.
  }
  process.exit(1);
}).finally(async () => {
  try {
    await close();
  } catch {
    // Server may already be closed in failure path.
  }
});
