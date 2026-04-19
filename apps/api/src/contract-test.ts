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
  isDocumentMetadataResponse,
  isDocumentPermissionsResponse,
  isDocumentShareResponse
} from "@swe-midterm/contracts";
import { createApiServer } from "./server.ts";

interface MessageBucket {
  messages: Array<Record<string, unknown>>;
}

interface AuthSession {
  accessToken: string;
  displayName: string;
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

const loginDemoUser = async (baseUrl: string, userId: string, password: string): Promise<AuthSession> => {
  const response = await fetch(`${baseUrl}/v1/auth/demo-login`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ userId, password })
  });

  assert.equal(response.status, 200, "Demo login must return 200 for valid credentials.");
  const body = (await response.json()) as unknown;
  assert.equal(isDemoLoginResponse(body), true, "Demo login must match the documented auth contract.");

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
  assert.deepEqual(
    permissions.permissions.map((permission) => [
      permission.userId,
      permission.permissionLevel,
      permission.source
    ]),
    [
      ["usr_assanali", "owner", "owner"],
      ["usr_alaa", "editor", "workspace"],
      ["usr_dachi", "editor", "workspace"],
      ["usr_editor", "editor", "share"],
      ["usr_viewer", "viewer", "share"]
    ]
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

  const createSession = async (accessToken: string): Promise<{
    documentId: string;
    sessionId: string;
    sessionToken: string;
    wsUrl: string;
  }> => {
    const response = await fetch(`${baseUrl}/v1/documents/${created.documentId}/sessions`, {
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
