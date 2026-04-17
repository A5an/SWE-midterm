import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createConnection } from "node:net";
import {
  isApiErrorEnvelope,
  isDemoLoginResponse,
  isCollaborationSessionResponse,
  isDocumentDetailResponse,
  isDocumentMetadataResponse
} from "@swe-midterm/contracts";
import { createApiServer } from "./server.ts";

interface MessageBucket {
  messages: Array<Record<string, unknown>>;
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

const rawInvalidHandshake = async (port: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let response = "";

    socket.on("connect", () => {
      socket.write(
        [
          "GET /v1/collab?token=invalid-token HTTP/1.1",
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

const main = async (): Promise<void> => {
  const baseUrl = await listen();
  const address = server.address() as AddressInfo;

  const createResponse = await fetch(`${baseUrl}/v1/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      workspaceId: "ws_123",
      title: "Realtime collaboration baseline",
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

  assert.equal(createResponse.status, 201, "Create endpoint must return 201.");
  const createdBody = (await createResponse.json()) as unknown;
  assert.equal(
    isDocumentMetadataResponse(createdBody),
    true,
    "Create response must match documented metadata contract."
  );

  const created = createdBody as { documentId: string };
  const loadResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`);
  assert.equal(loadResponse.status, 200, "Load endpoint must return 200 for existing document.");
  const loadBody = (await loadResponse.json()) as unknown;
  assert.equal(
    isDocumentDetailResponse(loadBody),
    true,
    "Load response must include metadata + content contract."
  );

  const invalidHandshakeResponse = await rawInvalidHandshake(address.port);
  assert.match(invalidHandshakeResponse, /HTTP\/1\.1 401 Unauthorized/u);
  assert.match(invalidHandshakeResponse, /AUTH_INVALID_TOKEN/u);
  console.log("ws-auth: invalid token rejected with HTTP 401");

  const loginDemoUser = async (userId: string, password: string): Promise<{
    accessToken: string;
    displayName: string;
    userId: string;
    workspaceIds: string[];
  }> => {
    const response = await fetch(`${baseUrl}/v1/auth/demo-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ userId, password })
    });

    assert.equal(response.status, 200, "Demo login must return 200 for valid credentials.");
    const body = (await response.json()) as unknown;
    assert.equal(isDemoLoginResponse(body), true, "Demo login must match the documented auth contract.");

    return body as {
      accessToken: string;
      displayName: string;
      userId: string;
      workspaceIds: string[];
    };
  };

  const unauthenticatedSessionResponse = await fetch(
    `${baseUrl}/v1/documents/${created.documentId}/sessions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    }
  );
  assert.equal(unauthenticatedSessionResponse.status, 401, "Session bootstrap must require API auth.");
  const unauthenticatedSessionBody = (await unauthenticatedSessionResponse.json()) as unknown;
  assert.equal(isApiErrorEnvelope(unauthenticatedSessionBody), true);
  assert.equal(
    (unauthenticatedSessionBody as { error: { code: string } }).error.code,
    "AUTH_REQUIRED"
  );

  const outsider = await loginDemoUser("usr_viewer", "demo-viewer");
  const forbiddenSessionResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${outsider.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  assert.equal(forbiddenSessionResponse.status, 403, "Session bootstrap must enforce document access.");
  const forbiddenSessionBody = (await forbiddenSessionResponse.json()) as unknown;
  assert.equal(isApiErrorEnvelope(forbiddenSessionBody), true);
  assert.equal(
    (forbiddenSessionBody as { error: { code: string } }).error.code,
    "ACCESS_FORBIDDEN"
  );
  console.log("authz: session bootstrap requires API auth and workspace access");

  const createSession = async (accessToken: string): Promise<{
    documentId: string;
    sessionId: string;
    sessionToken: string;
    wsUrl: string;
  }> => {
    const response = await fetch(`${baseUrl}/v1/documents/${created.documentId}/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    assert.equal(response.status, 201, "Session bootstrap must return 201.");
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

  const authA = await loginDemoUser("usr_assanali", "demo-assanali");
  const authB = await loginDemoUser("usr_alaa", "demo-alaa");
  const sessionA = await createSession(authA.accessToken);
  const sessionB = await createSession(authB.accessToken);

  const userA = await openSocket(`${sessionA.wsUrl}?token=${encodeURIComponent(sessionA.sessionToken)}`);
  const bootstrapA = await waitForMessage<{
    serverRevision: number;
    text: string;
    type: string;
  }>(userA.bucket, (message) => message.type === "server.bootstrap");
  assert.equal(bootstrapA.serverRevision, 0);
  assert.equal(bootstrapA.text, "Initial content from PoC.");

  const userB = await openSocket(`${sessionB.wsUrl}?token=${encodeURIComponent(sessionB.sessionToken)}`);
  await waitForMessage(userB.bucket, (message) => message.type === "server.bootstrap");

  const presenceForA = await waitForMessage<{ participants: Array<{ userId: string }> }>(
    userA.bucket,
    (message) =>
      message.type === "server.presence" &&
      Array.isArray(message.participants) &&
      message.participants.length === 2
  );
  const presenceForB = await waitForMessage<{ participants: Array<{ userId: string }> }>(
    userB.bucket,
    (message) =>
      message.type === "server.presence" &&
      Array.isArray(message.participants) &&
      message.participants.length === 2
  );
  assert.deepEqual(
    presenceForA.participants.map((participant) => participant.userId).sort(),
    ["usr_alaa", "usr_assanali"]
  );
  assert.deepEqual(
    presenceForB.participants.map((participant) => participant.userId).sort(),
    ["usr_alaa", "usr_assanali"]
  );
  console.log("presence: both websocket clients see the same online user list");

  userB.ws.close();
  const afterDisconnectPresence = await waitForMessage<{ participants: Array<{ userId: string }> }>(
    userA.bucket,
    (message) =>
      message.type === "server.presence" &&
      Array.isArray(message.participants) &&
      message.participants.length === 1
  );
  assert.deepEqual(afterDisconnectPresence.participants.map((participant) => participant.userId), ["usr_assanali"]);
  console.log("presence: disconnect removed the offline user from the room");

  const reconnectedB = await openSocket(`${sessionB.wsUrl}?token=${encodeURIComponent(sessionB.sessionToken)}`);
  const reconnectBootstrap = await waitForMessage<{
    serverRevision: number;
    text: string;
    type: string;
  }>(reconnectedB.bucket, (message) => message.type === "server.bootstrap");
  assert.equal(reconnectBootstrap.text, "Initial content from PoC.");

  const afterReconnectPresence = await waitForMessage<{ participants: Array<{ userId: string }> }>(
    userA.bucket,
    (message) =>
      message.type === "server.presence" &&
      Array.isArray(message.participants) &&
      message.participants.length === 2
  );
  assert.deepEqual(
    afterReconnectPresence.participants.map((participant) => participant.userId).sort(),
    ["usr_alaa", "usr_assanali"]
  );

  const offlineReplayMessage = {
    type: "client.update",
    sessionId: sessionB.sessionId,
    clientSeq: 1,
    mutationId: "mut-offline-replay",
    baseRevision: reconnectBootstrap.serverRevision,
    text: "Offline edit from reconnecting collaborator."
  };

  reconnectedB.ws.send(JSON.stringify(offlineReplayMessage));

  const firstAck = await waitForMessage<{
    mutationId: string;
    serverRevision: number;
    text: string;
    type: string;
  }>(
    reconnectedB.bucket,
    (message) =>
      message.type === "server.ack" &&
      message.mutationId === offlineReplayMessage.mutationId
  );
  assert.equal(firstAck.serverRevision, 1);
  assert.equal(firstAck.text, offlineReplayMessage.text);

  const remoteUpdateForA = await waitForMessage<{
    mutationId: string;
    serverRevision: number;
    text: string;
    type: string;
  }>(
    userA.bucket,
    (message) =>
      message.type === "server.update" &&
      message.mutationId === offlineReplayMessage.mutationId
  );
  assert.equal(remoteUpdateForA.serverRevision, 1);
  assert.equal(remoteUpdateForA.text, offlineReplayMessage.text);

  reconnectedB.ws.send(JSON.stringify(offlineReplayMessage));

  const duplicateAck = await waitForMessage<{
    mutationId: string;
    serverRevision: number;
    type: string;
  }>(
    reconnectedB.bucket,
    (message) =>
      message.type === "server.ack" &&
      message.mutationId === offlineReplayMessage.mutationId
  );
  assert.equal(duplicateAck.serverRevision, firstAck.serverRevision);

  const duplicateBroadcast = await waitForOptionalMessage(
    userA.bucket,
    (message) =>
      message.type === "server.update" &&
      message.mutationId === offlineReplayMessage.mutationId
  );
  assert.equal(duplicateBroadcast, null, "Duplicate replay must not rebroadcast the same mutation.");

  const persistedLoadResponse = await fetch(`${baseUrl}/v1/documents/${created.documentId}`);
  assert.equal(persistedLoadResponse.status, 200);
  const persistedBody = (await persistedLoadResponse.json()) as unknown;
  assert.equal(isDocumentDetailResponse(persistedBody), true);
  assert.equal(
    (persistedBody as { content: { content: Array<{ text: string }> } }).content.content[0]?.text,
    offlineReplayMessage.text
  );
  console.log("reconnect: resync applied once and the latest shared text persisted");

  reconnectedB.ws.close();
  userA.ws.close();

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
