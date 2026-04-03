import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL, fileURLToPath } from "node:url";
import {
  parseCreateDocumentRequest,
  type ApiErrorEnvelope,
  type DocumentContent,
  type DocumentDetailResponse,
  type DocumentMetadataResponse
} from "@swe-midterm/contracts";

interface StoredDocument {
  metadata: DocumentMetadataResponse;
  content: DocumentContent;
  updatedAt: string;
}

const json = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};

const setCorsHeaders = (response: ServerResponse): void => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

export const createApiServer = (store = new Map<string, StoredDocument>()): Server =>
  createServer(async (request, response) => {
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

    if (request.method === "POST" && pathname === "/v1/documents") {
      try {
        const rawBody = await readJsonBody(request);
        const parsed = parseCreateDocumentRequest(rawBody);

        if (!parsed.ok) {
          json(
            response,
            400,
            buildErrorEnvelope(requestId, "VALIDATION_ERROR", parsed.reason, false)
          );
          return;
        }

        const metadata = createCreateDocumentResponse(parsed.value.workspaceId, parsed.value.title);
        const storedDocument: StoredDocument = {
          metadata,
          content: parsed.value.initialContent,
          updatedAt: metadata.createdAt
        };

        store.set(metadata.documentId, storedDocument);
        json(response, 201, metadata);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected request parsing error.";
        json(
          response,
          400,
          buildErrorEnvelope(requestId, "MALFORMED_REQUEST", message, false)
        );
        return;
      }
    }

    const match = pathname.match(/^\/v1\/documents\/([^/]+)$/);
    if (request.method === "GET" && match) {
      const [, documentId] = match;
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

const DEFAULT_PORT = Number(process.env.PORT ?? 4000);

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const server = createApiServer();
  server.listen(DEFAULT_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${DEFAULT_PORT}`);
  });
}
