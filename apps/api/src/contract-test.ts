import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  isApiErrorEnvelope,
  isDocumentDetailResponse,
  isDocumentMetadataResponse
} from "@swe-midterm/contracts";
import { createApiServer } from "./server.ts";

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

const main = async (): Promise<void> => {
  const baseUrl = await listen();

  const createResponse = await fetch(`${baseUrl}/v1/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      workspaceId: "ws_123",
      title: "Q3 Product Brief",
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

  const missingResponse = await fetch(`${baseUrl}/v1/documents/doc_missing`);
  assert.equal(missingResponse.status, 404, "Unknown document must return 404.");
  const missingBody = (await missingResponse.json()) as unknown;
  assert.equal(
    isApiErrorEnvelope(missingBody),
    true,
    "Error response must use standard envelope shape."
  );

  const invalidCreateResponse = await fetch(`${baseUrl}/v1/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      workspaceId: "ws_123",
      title: "Invalid content shape",
      templateId: null,
      initialContent: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            text: 42
          }
        ]
      }
    })
  });
  assert.equal(invalidCreateResponse.status, 400, "Invalid content schema must be rejected.");
  const invalidCreateBody = (await invalidCreateResponse.json()) as unknown;
  assert.equal(
    isApiErrorEnvelope(invalidCreateBody),
    true,
    "Validation failures must use standard error envelope shape."
  );

  await close();
  // eslint-disable-next-line no-console
  console.log("API contract tests passed.");
};

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error("API contract tests failed:", error);
  try {
    await close();
  } catch {
    // Best effort cleanup in failure path.
  }
  process.exit(1);
});
