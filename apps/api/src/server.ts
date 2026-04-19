import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { URL, fileURLToPath } from "node:url";
import {
  parseCollaborationClientMessage,
  parseCollaborationSessionRequest,
  parseCreateDocumentRequest,
  parseDemoLoginRequest,
  type ApiErrorEnvelope,
  type CollaborationParticipant,
  type CollaborationServerAckMessage,
  type CollaborationServerBootstrapMessage,
  type CollaborationServerErrorMessage,
  type CollaborationServerMessage,
  type CollaborationServerPresenceMessage,
  type CollaborationServerUpdateMessage,
  type DocumentContent,
  type DocumentDetailResponse,
  type DocumentMetadataResponse
} from "@swe-midterm/contracts";

interface MutationRecord {
  ackClientSeq: number;
  authorUserId: string;
  mutationId: string;
  serverRevision: number;
  text: string;
}

interface ParticipantState {
  activity: CollaborationParticipant["activity"];
  buffer: Buffer;
  displayName: string;
  sessionId: string;
  socket: Duplex | null;
  userId: string;
}

interface CollaborationState {
  mutationHistory: Map<string, MutationRecord>;
  mutationOrder: string[];
  participants: Map<string, ParticipantState>;
  serverRevision: number;
  text: string;
}

interface StoredDocument {
  collaboration: CollaborationState;
  content: DocumentContent;
  metadata: DocumentMetadataResponse;
  updatedAt: string;
}

interface AccessTokenPayload {
  exp: number;
  iat: number;
  name: string;
  sub: string;
  tokenUse: "api_access";
  workspaceIds: string[];
}

interface SessionTokenPayload {
  documentId: string;
  exp: number;
  iat: number;
  name: string;
  sessionId: string;
  sub: string;
  tokenUse: "collab_session";
}

type SignedTokenPayload = AccessTokenPayload | SessionTokenPayload;

interface DemoUser {
  displayName: string;
  password: string;
  workspaceIds: string[];
}

const DEFAULT_PORT = Number(process.env.PORT ?? 4000);
const ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60;
const SESSION_TOKEN_TTL_SECONDS = 20 * 60;
const SESSION_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET?.trim() || "dev-collab-secret";
const MAX_MUTATION_HISTORY = 200;
const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEMO_USERS = new Map<string, DemoUser>([
  [
    "usr_assanali",
    {
      displayName: "Assanali",
      password: "demo-assanali",
      workspaceIds: ["ws_123"]
    }
  ],
  [
    "usr_alaa",
    {
      displayName: "Alaa",
      password: "demo-alaa",
      workspaceIds: ["ws_123"]
    }
  ],
  [
    "usr_dachi",
    {
      displayName: "Dachi",
      password: "demo-dachi",
      workspaceIds: ["ws_123"]
    }
  ],
  [
    "usr_viewer",
    {
      displayName: "Viewer",
      password: "demo-viewer",
      workspaceIds: ["ws_other"]
    }
  ]
]);

const json = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};

const setCorsHeaders = (response: ServerResponse): void => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const buildErrorEnvelope = (
  requestId: string,
  code: string,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>
): ApiErrorEnvelope => ({
  error: {
    code,
    message,
    retryable,
    requestId,
    details
  }
});

const readJsonBody = async (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw.length === 0) {
        reject(new Error("Request body is required."));
        return;
      }
      try {
        resolve(JSON.parse(raw) as unknown);
      } catch {
        reject(new Error("Malformed JSON body."));
      }
    });

    request.on("error", reject);
  });

const getBearerToken = (request: IncomingMessage): string | null => {
  const authorization = request.headers.authorization;

  if (typeof authorization !== "string") {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/u);
  return match ? match[1].trim() : null;
};

const base64UrlEncode = (value: Buffer | string): string =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");

const base64UrlDecode = (value: string): Buffer => {
  const padded = `${value}${"=".repeat((4 - (value.length % 4 || 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Buffer.from(padded, "base64");
};

const signJwt = (payload: SignedTokenPayload): string => {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(
    createHmac("sha256", SESSION_TOKEN_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${signature}`;
};

const verifyJwt = (token: string): { ok: true; value: SignedTokenPayload } | { ok: false; reason: string } => {
  const segments = token.split(".");

  if (segments.length !== 3) {
    return { ok: false, reason: "Token must contain 3 segments." };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;

  let parsedHeader: unknown;
  let parsedPayload: unknown;

  try {
    parsedHeader = JSON.parse(base64UrlDecode(encodedHeader).toString("utf8")) as unknown;
    parsedPayload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as unknown;
  } catch {
    return { ok: false, reason: "Token contains malformed JSON segments." };
  }

  const expectedSignature = createHmac("sha256", SESSION_TOKEN_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const providedSignature = base64UrlDecode(encodedSignature);

  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    return { ok: false, reason: "Token signature is invalid." };
  }

  if (
    typeof parsedHeader !== "object" ||
    parsedHeader === null ||
    (parsedHeader as { alg?: string }).alg !== "HS256"
  ) {
    return { ok: false, reason: "Token header is invalid." };
  }

  if (
    typeof parsedPayload !== "object" ||
    parsedPayload === null ||
    typeof (parsedPayload as SignedTokenPayload).sub !== "string" ||
    typeof (parsedPayload as SignedTokenPayload).name !== "string" ||
    typeof (parsedPayload as SignedTokenPayload).iat !== "number" ||
    typeof (parsedPayload as SignedTokenPayload).exp !== "number" ||
    typeof (parsedPayload as SignedTokenPayload).tokenUse !== "string"
  ) {
    return { ok: false, reason: "Token payload is invalid." };
  }

  const tokenPayload = parsedPayload as SignedTokenPayload;

  if (
    tokenPayload.tokenUse === "api_access" &&
    !Array.isArray(tokenPayload.workspaceIds)
  ) {
    return { ok: false, reason: "Access token payload is invalid." };
  }

  if (
    tokenPayload.tokenUse === "collab_session" &&
    (typeof tokenPayload.documentId !== "string" || typeof tokenPayload.sessionId !== "string")
  ) {
    return { ok: false, reason: "Session token payload is invalid." };
  }

  if (tokenPayload.tokenUse !== "api_access" && tokenPayload.tokenUse !== "collab_session") {
    return { ok: false, reason: "Token use is not supported." };
  }

  if (tokenPayload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "Token has expired." };
  }

  return { ok: true, value: tokenPayload };
};

const verifyAccessToken = (
  token: string
): { ok: true; value: AccessTokenPayload } | { ok: false; reason: string } => {
  const verified = verifyJwt(token);

  if (!verified.ok) {
    return verified;
  }

  if (verified.value.tokenUse !== "api_access") {
    return { ok: false, reason: "Token is not an API access token." };
  }

  return { ok: true, value: verified.value };
};

const verifySessionToken = (
  token: string
): { ok: true; value: SessionTokenPayload } | { ok: false; reason: string } => {
  const verified = verifyJwt(token);

  if (!verified.ok) {
    return verified;
  }

  if (verified.value.tokenUse !== "collab_session") {
    return { ok: false, reason: "Token is not a collaboration session token." };
  }

  return { ok: true, value: verified.value };
};

const toParagraphText = (content: DocumentContent): string =>
  content.content.map((block) => block.text).join("\n\n");

const textToContent = (text: string): DocumentContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      text
    }
  ]
});

const createCreateDocumentResponse = (workspaceId: string, title: string): DocumentMetadataResponse => {
  const now = new Date().toISOString();
  return {
    documentId: `doc_${randomUUID().slice(0, 8)}`,
    workspaceId,
    title,
    ownerRole: "owner",
    currentVersionId: "ver_001",
    createdAt: now
  };
};

const authenticateRequest = (
  request: IncomingMessage
): { ok: true; value: AccessTokenPayload } | { ok: false; code: string; message: string; statusCode: number } => {
  const token = getBearerToken(request);

  if (!token) {
    return {
      ok: false,
      code: "AUTH_REQUIRED",
      message: "Bearer access token is required.",
      statusCode: 401
    };
  }

  const verified = verifyAccessToken(token);
  if (!verified.ok) {
    return {
      ok: false,
      code: "AUTH_INVALID_TOKEN",
      message: verified.reason,
      statusCode: 401
    };
  }

  return { ok: true, value: verified.value };
};

const canAccessDocument = (user: AccessTokenPayload, document: StoredDocument): boolean =>
  user.workspaceIds.includes(document.metadata.workspaceId);

const createCollaborationState = (documentText: string): CollaborationState => ({
  mutationHistory: new Map(),
  mutationOrder: [],
  participants: new Map(),
  serverRevision: 0,
  text: documentText
});

const ensureCollaborationState = (document: StoredDocument): CollaborationState => {
  if (!document.collaboration) {
    document.collaboration = createCollaborationState(toParagraphText(document.content));
  }
  return document.collaboration;
};

const listParticipants = (state: CollaborationState): CollaborationParticipant[] =>
  [...state.participants.values()]
    .filter((participant) => participant.socket !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((participant) => ({
      sessionId: participant.sessionId,
      userId: participant.userId,
      displayName: participant.displayName,
      activity: participant.activity
    }));

const rememberMutation = (state: CollaborationState, mutation: MutationRecord): void => {
  state.mutationHistory.set(mutation.mutationId, mutation);
  state.mutationOrder.push(mutation.mutationId);

  while (state.mutationOrder.length > MAX_MUTATION_HISTORY) {
    const oldestMutationId = state.mutationOrder.shift();
    if (oldestMutationId) {
      state.mutationHistory.delete(oldestMutationId);
    }
  }
};

const writeUpgradeResponse = (socket: Duplex, statusCode: number, body: ApiErrorEnvelope): void => {
  const bodyText = JSON.stringify(body);
  socket.write(
    [
      `HTTP/1.1 ${statusCode} ${statusCode === 401 ? "Unauthorized" : "Bad Request"}`,
      "Connection: close",
      "Content-Type: application/json; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(bodyText)}`,
      "",
      bodyText
    ].join("\r\n")
  );
  socket.destroy();
};

const sendWebSocketFrame = (
  socket: Duplex,
  opcode: number,
  payload: Uint8Array = new Uint8Array()
): void => {
  const header: number[] = [0x80 | opcode];

  if (payload.length < 126) {
    header.push(payload.length);
  } else if (payload.length < 65_536) {
    header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    const lengthBuffer = Buffer.alloc(8);
    lengthBuffer.writeBigUInt64BE(BigInt(payload.length));
    header.push(127, ...lengthBuffer);
  }

  socket.write(Buffer.concat([Buffer.from(header), Buffer.from(payload)]));
};

const sendWebSocketJson = (socket: Duplex, message: CollaborationServerMessage): void => {
  sendWebSocketFrame(socket, 0x1, Buffer.from(JSON.stringify(message), "utf8"));
};

const broadcastPresence = (state: CollaborationState): void => {
  const message: CollaborationServerPresenceMessage = {
    type: "server.presence",
    participants: listParticipants(state)
  };

  for (const participant of state.participants.values()) {
    if (participant.socket) {
      sendWebSocketJson(participant.socket, message);
    }
  }
};

const applyTextUpdate = (
  document: StoredDocument,
  state: CollaborationState,
  mutation: MutationRecord
): void => {
  state.serverRevision = mutation.serverRevision;
  state.text = mutation.text;
  rememberMutation(state, mutation);

  document.content = textToContent(mutation.text);
  document.updatedAt = new Date().toISOString();
};

const decodeWebSocketFrames = (
  participant: ParticipantState,
  chunk: Buffer,
  onText: (text: string) => void,
  onClose: () => void
): void => {
  participant.buffer = Buffer.concat([participant.buffer, chunk]);

  while (participant.buffer.length >= 2) {
    const firstByte = participant.buffer[0];
    const secondByte = participant.buffer[1];
    const opcode = firstByte & 0x0f;
    const isMasked = (secondByte & 0x80) === 0x80;
    let payloadLength = secondByte & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (participant.buffer.length < offset + 2) {
        return;
      }
      payloadLength = participant.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (participant.buffer.length < offset + 8) {
        return;
      }
      const largePayloadLength = participant.buffer.readBigUInt64BE(offset);
      if (largePayloadLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        onClose();
        return;
      }
      payloadLength = Number(largePayloadLength);
      offset += 8;
    }

    const maskLength = isMasked ? 4 : 0;
    if (participant.buffer.length < offset + maskLength + payloadLength) {
      return;
    }

    const mask = isMasked ? participant.buffer.subarray(offset, offset + 4) : undefined;
    offset += maskLength;

    const payload = participant.buffer.subarray(offset, offset + payloadLength);
    participant.buffer = participant.buffer.subarray(offset + payloadLength);

    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    if (opcode === 0x8) {
      onClose();
      return;
    }

    if (opcode === 0x9) {
      if (participant.socket) {
        sendWebSocketFrame(participant.socket, 0xA, payload);
      }
      continue;
    }

    if (opcode === 0x1) {
      onText(payload.toString("utf8"));
    }
  }
};

const resolveWsUrl = (request: IncomingMessage): string => {
  const forwardedProtoHeader = request.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader;
  const protocol = forwardedProto === "https" ? "wss" : "ws";
  const host = request.headers.host ?? `localhost:${DEFAULT_PORT}`;
  return `${protocol}://${host}/v1/collab`;
};

export const createApiServer = (store = new Map<string, StoredDocument>()): Server => {
  const server = createServer(async (request, response) => {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const requestId = `req_${randomUUID().slice(0, 12)}`;
    const url = request.url ? new URL(request.url, "http://localhost") : new URL("/", "http://localhost");
    const pathname = url.pathname;

    if (request.method === "GET" && pathname === "/health") {
      json(response, 200, { status: "ok", requestId });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/auth/demo-login") {
      try {
        const rawBody = await readJsonBody(request);
        const parsed = parseDemoLoginRequest(rawBody);

        if (!parsed.ok) {
          json(response, 400, buildErrorEnvelope(requestId, "VALIDATION_ERROR", parsed.reason, false));
          return;
        }

        const demoUser = DEMO_USERS.get(parsed.value.userId);
        if (!demoUser || demoUser.password !== parsed.value.password) {
          json(
            response,
            401,
            buildErrorEnvelope(
              requestId,
              "AUTH_INVALID_CREDENTIALS",
              "Demo credentials are invalid.",
              false
            )
          );
          return;
        }

        const now = Math.floor(Date.now() / 1000);
        const accessToken = signJwt({
          tokenUse: "api_access",
          sub: parsed.value.userId,
          name: demoUser.displayName,
          workspaceIds: demoUser.workspaceIds,
          iat: now,
          exp: now + ACCESS_TOKEN_TTL_SECONDS
        });

        json(response, 200, {
          accessToken,
          userId: parsed.value.userId,
          displayName: demoUser.displayName,
          workspaceIds: demoUser.workspaceIds,
          issuedAt: new Date(now * 1000).toISOString(),
          expiresAt: new Date((now + ACCESS_TOKEN_TTL_SECONDS) * 1000).toISOString()
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected request parsing error.";
        json(response, 400, buildErrorEnvelope(requestId, "MALFORMED_REQUEST", message, false));
        return;
      }
    }

    if (request.method === "POST" && pathname === "/v1/documents") {
      try {
        const rawBody = await readJsonBody(request);
        const parsed = parseCreateDocumentRequest(rawBody);

        if (!parsed.ok) {
          json(response, 400, buildErrorEnvelope(requestId, "VALIDATION_ERROR", parsed.reason, false));
          return;
        }

        const metadata = createCreateDocumentResponse(parsed.value.workspaceId, parsed.value.title);
        const storedDocument: StoredDocument = {
          collaboration: createCollaborationState(toParagraphText(parsed.value.initialContent)),
          content: parsed.value.initialContent,
          metadata,
          updatedAt: metadata.createdAt
        };

        store.set(metadata.documentId, storedDocument);
        json(response, 201, metadata);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected request parsing error.";
        json(response, 400, buildErrorEnvelope(requestId, "MALFORMED_REQUEST", message, false));
        return;
      }
    }

    const sessionCollectionMatch = pathname.match(/^\/v1\/documents\/([^/]+)\/sessions$/u);
    if (request.method === "POST" && sessionCollectionMatch) {
      const [, documentId] = sessionCollectionMatch;
      const found = store.get(documentId);

      if (!found) {
        json(
          response,
          404,
          buildErrorEnvelope(
            requestId,
            "DOCUMENT_NOT_FOUND",
            `Document '${documentId}' does not exist.`,
            false
          )
        );
        return;
      }

      try {
        const rawBody = await readJsonBody(request);
        const parsed = parseCollaborationSessionRequest(rawBody);

        if (!parsed.ok) {
          json(response, 400, buildErrorEnvelope(requestId, "VALIDATION_ERROR", parsed.reason, false));
          return;
        }

        const authenticatedUser = authenticateRequest(request);
        if (!authenticatedUser.ok) {
          json(
            response,
            authenticatedUser.statusCode,
            buildErrorEnvelope(requestId, authenticatedUser.code, authenticatedUser.message, false)
          );
          return;
        }

        if (!canAccessDocument(authenticatedUser.value, found)) {
          json(
            response,
            403,
            buildErrorEnvelope(
              requestId,
              "ACCESS_FORBIDDEN",
              `User '${authenticatedUser.value.sub}' does not have access to document '${documentId}'.`,
              false,
              { workspaceId: found.metadata.workspaceId }
            )
          );
          return;
        }

        const now = Math.floor(Date.now() / 1000);
        const sessionId = `ses_${randomUUID().slice(0, 8)}`;
        const sessionToken = signJwt({
          tokenUse: "collab_session",
          sub: authenticatedUser.value.sub,
          name: authenticatedUser.value.name,
          documentId,
          sessionId,
          iat: now,
          exp: now + SESSION_TOKEN_TTL_SECONDS
        });
        const collaboration = ensureCollaborationState(found);

        json(response, 201, {
          sessionId,
          documentId,
          wsUrl: resolveWsUrl(request),
          sessionToken,
          documentText: collaboration.text,
          serverRevision: collaboration.serverRevision,
          presence: listParticipants(collaboration),
          issuedAt: new Date(now * 1000).toISOString(),
          expiresAt: new Date((now + SESSION_TOKEN_TTL_SECONDS) * 1000).toISOString()
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected request parsing error.";
        json(response, 400, buildErrorEnvelope(requestId, "MALFORMED_REQUEST", message, false));
        return;
      }
    }

    const sessionItemMatch = pathname.match(/^\/v1\/documents\/([^/]+)\/sessions\/([^/]+)$/u);
    if (request.method === "GET" && sessionItemMatch) {
      const [, documentId, sessionId] = sessionItemMatch;
      const found = store.get(documentId);

      if (!found) {
        json(
          response,
          404,
          buildErrorEnvelope(
            requestId,
            "DOCUMENT_NOT_FOUND",
            `Document '${documentId}' does not exist.`,
            false
          )
        );
        return;
      }

      const collaboration = ensureCollaborationState(found);
      const participant = collaboration.participants.get(sessionId);

      if (!participant) {
        json(
          response,
          404,
          buildErrorEnvelope(
            requestId,
            "SESSION_NOT_FOUND",
            `Session '${sessionId}' does not exist for document '${documentId}'.`,
            false
          )
        );
        return;
      }

      json(response, 200, {
        sessionId,
        documentId,
        isOnline: participant.socket !== null,
        activity: participant.activity,
        serverRevision: collaboration.serverRevision
      });
      return;
    }

    const documentMatch = pathname.match(/^\/v1\/documents\/([^/]+)$/u);
    if (request.method === "GET" && documentMatch) {
      const [, documentId] = documentMatch;
      const found = store.get(documentId);

      if (!found) {
        json(
          response,
          404,
          buildErrorEnvelope(
            requestId,
            "DOCUMENT_NOT_FOUND",
            `Document '${documentId}' does not exist.`,
            false
          )
        );
        return;
      }

      const detail: DocumentDetailResponse = {
        ...found.metadata,
        content: found.content,
        updatedAt: found.updatedAt
      };
      json(response, 200, detail);
      return;
    }

    json(
      response,
      404,
      buildErrorEnvelope(
        requestId,
        "ROUTE_NOT_FOUND",
        `No route for ${request.method ?? "UNKNOWN"} ${pathname}.`,
        false
      )
    );
  });

  server.on("upgrade", (request, socket, head) => {
    const requestId = `req_${randomUUID().slice(0, 12)}`;
    const url = request.url ? new URL(request.url, "http://localhost") : new URL("/", "http://localhost");

    if (url.pathname !== "/v1/collab") {
      writeUpgradeResponse(
        socket,
        404,
        buildErrorEnvelope(requestId, "ROUTE_NOT_FOUND", `No route for websocket ${url.pathname}.`, false)
      );
      return;
    }

    const token = url.searchParams.get("token");
    if (!token) {
      writeUpgradeResponse(
        socket,
        401,
        buildErrorEnvelope(requestId, "AUTH_REQUIRED", "WebSocket token is required.", false)
      );
      return;
    }

    const verifiedToken = verifySessionToken(token);
    if (!verifiedToken.ok) {
      writeUpgradeResponse(
        socket,
        401,
        buildErrorEnvelope(requestId, "AUTH_INVALID_TOKEN", verifiedToken.reason, false)
      );
      return;
    }

    const document = store.get(verifiedToken.value.documentId);
    if (!document) {
      writeUpgradeResponse(
        socket,
        404,
        buildErrorEnvelope(
          requestId,
          "DOCUMENT_NOT_FOUND",
          `Document '${verifiedToken.value.documentId}' does not exist.`,
          false
        )
      );
      return;
    }

    const wsKey = request.headers["sec-websocket-key"];
    if (typeof wsKey !== "string" || wsKey.trim().length === 0) {
      writeUpgradeResponse(
        socket,
        400,
        buildErrorEnvelope(requestId, "WS_HANDSHAKE_INVALID", "Missing websocket key header.", false)
      );
      return;
    }

    const acceptKey = createHash("sha1")
      .update(`${wsKey}${WS_MAGIC_GUID}`)
      .digest("base64");

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey}`,
        "",
        ""
      ].join("\r\n")
    );

    const collaboration = ensureCollaborationState(document);
    const existingParticipant = collaboration.participants.get(verifiedToken.value.sessionId);
    const participant: ParticipantState =
      existingParticipant ?? {
        activity: "idle",
        buffer: Buffer.alloc(0),
        displayName: verifiedToken.value.name,
        sessionId: verifiedToken.value.sessionId,
        socket: null,
        userId: verifiedToken.value.sub
      };

    if (participant.socket && participant.socket !== socket) {
      participant.socket.destroy();
    }

    participant.socket = socket;
    participant.buffer = Buffer.alloc(0);
    participant.activity = "idle";
    collaboration.participants.set(participant.sessionId, participant);

    const bootstrapMessage: CollaborationServerBootstrapMessage = {
      type: "server.bootstrap",
      sessionId: participant.sessionId,
      documentId: verifiedToken.value.documentId,
      text: collaboration.text,
      serverRevision: collaboration.serverRevision,
      participants: listParticipants(collaboration)
    };
    sendWebSocketJson(socket, bootstrapMessage);
    broadcastPresence(collaboration);

    const closeConnection = (): void => {
      const activeParticipant = collaboration.participants.get(participant.sessionId);
      if (!activeParticipant || activeParticipant.socket !== socket) {
        return;
      }

      activeParticipant.socket = null;
      activeParticipant.buffer = Buffer.alloc(0);
      activeParticipant.activity = "idle";
      broadcastPresence(collaboration);
      socket.destroy();
    };

    const handleMessageText = (messageText: string): void => {
      let parsedMessage: unknown;

      try {
        parsedMessage = JSON.parse(messageText) as unknown;
      } catch {
        const errorMessage: CollaborationServerErrorMessage = {
          type: "server.error",
          code: "COLLAB_MESSAGE_INVALID",
          message: "Collaboration messages must be valid JSON."
        };
        sendWebSocketJson(socket, errorMessage);
        return;
      }

      const parsed = parseCollaborationClientMessage(parsedMessage);
      if (!parsed.ok) {
        const errorMessage: CollaborationServerErrorMessage = {
          type: "server.error",
          code: "COLLAB_MESSAGE_INVALID",
          message: parsed.reason
        };
        sendWebSocketJson(socket, errorMessage);
        return;
      }

      if (parsed.value.sessionId !== participant.sessionId) {
        const errorMessage: CollaborationServerErrorMessage = {
          type: "server.error",
          code: "COLLAB_SESSION_MISMATCH",
          message: "Client sessionId does not match the authenticated websocket session."
        };
        sendWebSocketJson(socket, errorMessage);
        return;
      }

      if (parsed.value.type === "client.presence") {
        participant.activity = parsed.value.activity;
        broadcastPresence(collaboration);
        return;
      }

      const existingMutation = collaboration.mutationHistory.get(parsed.value.mutationId);
      if (existingMutation) {
        const duplicateAck: CollaborationServerAckMessage = {
          type: "server.ack",
          sessionId: participant.sessionId,
          ackClientSeq: parsed.value.clientSeq,
          mutationId: parsed.value.mutationId,
          serverRevision: existingMutation.serverRevision,
          text: collaboration.text
        };
        sendWebSocketJson(socket, duplicateAck);
        return;
      }

      if (parsed.value.text === collaboration.text) {
        const noopAck: CollaborationServerAckMessage = {
          type: "server.ack",
          sessionId: participant.sessionId,
          ackClientSeq: parsed.value.clientSeq,
          mutationId: parsed.value.mutationId,
          serverRevision: collaboration.serverRevision,
          text: collaboration.text
        };
        sendWebSocketJson(socket, noopAck);
        return;
      }

      const mutation: MutationRecord = {
        ackClientSeq: parsed.value.clientSeq,
        authorUserId: participant.userId,
        mutationId: parsed.value.mutationId,
        serverRevision: collaboration.serverRevision + 1,
        text: parsed.value.text
      };
      applyTextUpdate(document, collaboration, mutation);
      participant.activity = "editing";

      const ackMessage: CollaborationServerAckMessage = {
        type: "server.ack",
        sessionId: participant.sessionId,
        ackClientSeq: parsed.value.clientSeq,
        mutationId: mutation.mutationId,
        serverRevision: mutation.serverRevision,
        text: mutation.text
      };
      sendWebSocketJson(socket, ackMessage);

      const updateMessage: CollaborationServerUpdateMessage = {
        type: "server.update",
        sessionId: participant.sessionId,
        mutationId: mutation.mutationId,
        authorUserId: participant.userId,
        serverRevision: mutation.serverRevision,
        text: mutation.text
      };

      for (const connectedParticipant of collaboration.participants.values()) {
        if (connectedParticipant.socket && connectedParticipant.socket !== socket) {
          sendWebSocketJson(connectedParticipant.socket, updateMessage);
        }
      }

      broadcastPresence(collaboration);
    };

    socket.on("data", (chunk: Buffer) => {
      decodeWebSocketFrames(participant, chunk, handleMessageText, closeConnection);
    });
    socket.on("close", closeConnection);
    socket.on("end", closeConnection);
    socket.on("error", closeConnection);

    if (head.length > 0) {
      decodeWebSocketFrames(participant, head, handleMessageText, closeConnection);
    }
  });

  return server;
};

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const server = createApiServer();
  server.listen(DEFAULT_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${DEFAULT_PORT}`);
  });
}
