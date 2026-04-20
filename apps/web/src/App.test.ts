import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("quill", () => {
  let lastInstance: MockQuill | null = null;

  class MockQuill {
    public static getLatest(): MockQuill | null {
      return lastInstance;
    }

    public clipboard = {
      dangerouslyPasteHTML: (_index: number, html: string) => {
        this.root.innerHTML = html;
      }
    };

    public root: HTMLDivElement;

    private currentFormat: Record<string, unknown> = {};
    private currentSelection = { index: 0, length: 0 };
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

    public constructor(host: HTMLElement) {
      this.root = document.createElement("div");
      this.root.className = "ql-editor";
      host.append(this.root);
      lastInstance = this;
    }

    public deleteText(index: number, length: number): void {
      const text = this.getText().replace(/\n$/u, "");
      this.root.textContent = `${text.slice(0, index)}${text.slice(index + length)}`;
    }

    public enable(_enabled: boolean): void {}

    public format(name: string, value: unknown): void {
      this.currentFormat[name] = value;
    }

    public formatLine(_index: number, _length: number, name: string, value: unknown): void {
      this.currentFormat[name] = value;
    }

    public getFormat(): Record<string, unknown> {
      return this.currentFormat;
    }

    public getLength(): number {
      return this.getText().length;
    }

    public getSelection(): { index: number; length: number } {
      return this.currentSelection;
    }

    public getText(index?: number, length?: number): string {
      const text = `${this.root.textContent || ""}\n`;

      if (typeof index === "number" && typeof length === "number") {
        return text.slice(index, index + length);
      }

      return text;
    }

    public insertText(index: number, value: string): void {
      const text = this.getText().replace(/\n$/u, "");
      this.root.textContent = `${text.slice(0, index)}${value}${text.slice(index)}`;
    }

    public on(eventName: string, handler: (...args: unknown[]) => void): void {
      this.handlers.set(eventName, [...(this.handlers.get(eventName) || []), handler]);
    }

    public setSelection(index: number, length: number): void {
      this.currentSelection = { index, length };
      this.emit("selection-change");
    }

    public setText(value: string): void {
      this.root.textContent = value;
    }

    public emit(eventName: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(eventName) || []) {
        handler(...args);
      }
    }
  }

  return {
    __getLastQuill: () => MockQuill.getLatest(),
    default: MockQuill
  };
});

import App, { mountApp } from "./App.ts";

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("mountApp", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  it("loads the dashboard list after login and autosaves editor changes", async () => {
    let savedHtml = "<h2>Team Plan</h2><p><strong>Draft</strong> agenda.</p>";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/v1/auth/demo-login")) {
        return new Response(
          JSON.stringify({
            accessToken: "token-123",
            userId: "usr_alaa",
            displayName: "Alaa",
            workspaceIds: ["ws_123"],
            issuedAt: "2026-04-19T12:00:00.000Z",
            expiresAt: "2026-04-19T12:15:00.000Z"
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents") && (!init || !init.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            documents: [
              {
                documentId: "doc_123",
                workspaceId: "ws_123",
                title: "Team Plan",
                effectiveRole: "owner",
                createdAt: "2026-04-19T12:00:00.000Z",
                updatedAt: "2026-04-19T12:00:00.000Z",
                preview: "Draft agenda."
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents/doc_123") && (!init || !init.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            documentId: "doc_123",
            workspaceId: "ws_123",
            title: "Team Plan",
            ownerRole: "owner",
            currentVersionId: "ver_001",
            createdAt: "2026-04-19T12:00:00.000Z",
            updatedAt: "2026-04-19T12:00:00.000Z",
            content: {
              type: "doc",
              content: [{ type: "paragraph", text: savedHtml }]
            }
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents/doc_123") && init?.method === "PATCH") {
        const request = JSON.parse(String(init.body)) as {
          content: { content: Array<{ text: string }> };
          title: string;
        };
        savedHtml = request.content.content[0]?.text || savedHtml;

        return new Response(
          JSON.stringify({
            documentId: "doc_123",
            workspaceId: "ws_123",
            title: request.title,
            ownerRole: "owner",
            currentVersionId: "ver_001",
            createdAt: "2026-04-19T12:00:00.000Z",
            updatedAt: "2026-04-19T12:01:00.000Z",
            content: {
              type: "doc",
              content: [{ type: "paragraph", text: savedHtml }]
            }
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents/doc_123/permissions")) {
        return new Response(
          JSON.stringify({
            documentId: "doc_123",
            permissions: [
              {
                shareId: null,
                source: "owner",
                userId: "usr_alaa",
                email: "alaa@example.com",
                displayName: "Alaa",
                permissionLevel: "owner"
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents/doc_123/versions")) {
        return new Response(
          JSON.stringify({
            documentId: "doc_123",
            currentVersionId: "ver_001",
            versions: [
              {
                versionId: "ver_001",
                versionNumber: 1,
                createdAt: "2026-04-19T12:00:00.000Z",
                createdByUserId: "usr_alaa",
                basedOnVersionId: null,
                isRevert: false,
                changeSummary: "Initial version",
                title: "Team Plan"
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents/doc_123/ai/jobs")) {
        return new Response(
          JSON.stringify({
            documentId: "doc_123",
            jobs: []
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unhandled fetch ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const root = document.createElement("div");
    document.body.append(root);
    mountApp(root);

    root.querySelector<HTMLButtonElement>("#loginButton")?.click();
    await vi.waitFor(() => {
      expect(root.querySelector("#documentList")?.textContent).toContain("Team Plan");
    });

    expect(root.querySelector("#formatBoldButton")).not.toBeNull();

    root.querySelector<HTMLButtonElement>("[data-document-id='doc_123']")?.click();
    await flush();

    const { __getLastQuill } = (await import("quill")) as typeof import("quill") & {
      __getLastQuill: () => {
        clipboard: { dangerouslyPasteHTML: (index: number, html: string) => void };
        emit: (eventName: string, ...args: unknown[]) => void;
      } | null;
    };
    const editor = __getLastQuill();
    expect(editor).not.toBeNull();

    editor?.clipboard.dangerouslyPasteHTML(0, "<h2>Team Plan</h2><p>Autosave changed copy.</p>");
    editor?.emit("text-change", {}, {}, "user");

    expect(root.querySelector("#autosaveState")?.textContent).toContain("Unsaved");

    await vi.advanceTimersByTimeAsync(750);
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/documents/doc_123"),
      expect.objectContaining({ method: "PATCH" })
    );
    expect(root.querySelector("#autosaveState")?.textContent).toContain("Saved");
  });

  it("silently refreshes the FastAPI-backed session when the main app gets a 401", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization =
        init?.headers && "Authorization" in (init.headers as Record<string, string>)
          ? (init.headers as Record<string, string>).Authorization
          : undefined;

      if (url.endsWith("/v1/auth/login")) {
        return new Response(
          JSON.stringify({
            user: {
              userId: "usr_alaa",
              email: "alaa@example.com",
              displayName: "Alaa",
              workspaceRole: "owner",
              workspaceIds: ["ws_123"],
              createdAt: "2026-04-19T12:00:00.000Z"
            },
            tokens: {
              tokenType: "bearer",
              accessToken: "access-1",
              accessTokenExpiresAt: "2026-04-19T12:15:00.000Z",
              refreshToken: "refresh-1",
              refreshTokenExpiresAt: "2026-04-20T12:15:00.000Z"
            }
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/me")) {
        expect(authorization).toBe("Bearer access-1");
        return new Response(
          JSON.stringify({
            userId: "usr_alaa",
            email: "alaa@example.com",
            displayName: "Alaa",
            workspaceRole: "owner",
            workspaceIds: ["ws_123"],
            createdAt: "2026-04-19T12:00:00.000Z"
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/auth/refresh")) {
        return new Response(
          JSON.stringify({
            user: {
              userId: "usr_alaa",
              email: "alaa@example.com",
              displayName: "Alaa",
              workspaceRole: "owner",
              workspaceIds: ["ws_123"],
              createdAt: "2026-04-19T12:00:00.000Z"
            },
            tokens: {
              tokenType: "bearer",
              accessToken: "access-2",
              accessTokenExpiresAt: "2026-04-19T12:30:00.000Z",
              refreshToken: "refresh-2",
              refreshTokenExpiresAt: "2026-04-20T12:30:00.000Z"
            }
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents") && (!init?.method || init.method === "GET")) {
        if (authorization === "Bearer access-1") {
          return new Response(
            JSON.stringify({
              error: {
                code: "AUTH_INVALID_TOKEN",
                message: "Token has expired.",
                requestId: "req_expired",
                retryable: false
              }
            }),
            { status: 401 }
          );
        }

        expect(authorization).toBe("Bearer access-2");
        return new Response(
          JSON.stringify({
            documents: [
              {
                documentId: "doc_123",
                workspaceId: "ws_123",
                title: "Recovered Doc",
                effectiveRole: "owner",
                createdAt: "2026-04-19T12:00:00.000Z",
                updatedAt: "2026-04-19T12:00:00.000Z",
                preview: "Recovered preview."
              }
            ]
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unhandled fetch ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const root = document.createElement("div");
    document.body.append(root);
    mountApp(root);

    const emailInput = root.querySelector<HTMLInputElement>("#authLoginEmail");
    const passwordInput = root.querySelector<HTMLInputElement>("#authLoginPassword");
    emailInput!.value = "alaa@example.com";
    passwordInput!.value = "Sup3rSecure!";

    root.querySelector<HTMLFormElement>("#authLoginForm")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );

    await vi.waitFor(() => {
      expect(root.querySelector("#documentList")?.textContent).toContain("Recovered Doc");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/auth/refresh"),
      expect.objectContaining({ method: "POST" })
    );
    expect(root.querySelector("#authLifecycleState")?.textContent).toContain("refreshed");
  });

  it("removes a deleted document from the dashboard list", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/v1/auth/demo-login")) {
        return new Response(
          JSON.stringify({
            accessToken: "token-123",
            userId: "usr_alaa",
            displayName: "Alaa",
            workspaceIds: ["ws_123"],
            issuedAt: "2026-04-19T12:00:00.000Z",
            expiresAt: "2026-04-19T12:15:00.000Z"
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents") && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            documents: [
              {
                documentId: "doc_123",
                workspaceId: "ws_123",
                title: "Delete Me",
                effectiveRole: "owner",
                createdAt: "2026-04-19T12:00:00.000Z",
                updatedAt: "2026-04-19T12:00:00.000Z",
                preview: "Soon gone."
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents/doc_123") && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            documentId: "doc_123",
            workspaceId: "ws_123",
            title: "Delete Me",
            ownerRole: "owner",
            currentVersionId: "ver_001",
            createdAt: "2026-04-19T12:00:00.000Z",
            updatedAt: "2026-04-19T12:00:00.000Z",
            content: {
              type: "doc",
              content: [{ type: "paragraph", text: "Soon gone." }]
            }
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents/doc_123") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      if (url.endsWith("/v1/documents/doc_123/permissions")) {
        return new Response(
          JSON.stringify({
            documentId: "doc_123",
            permissions: [
              {
                shareId: null,
                source: "owner",
                userId: "usr_alaa",
                email: "alaa@example.com",
                displayName: "Alaa",
                permissionLevel: "owner"
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents/doc_123/versions")) {
        return new Response(
          JSON.stringify({
            documentId: "doc_123",
            currentVersionId: "ver_001",
            versions: []
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/v1/documents/doc_123/ai/jobs")) {
        return new Response(
          JSON.stringify({
            documentId: "doc_123",
            jobs: []
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unhandled fetch ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const root = document.createElement("div");
    document.body.append(root);
    mountApp(root);

    root.querySelector<HTMLButtonElement>("#loginButton")?.click();
    await vi.waitFor(() => {
      expect(root.querySelector("#documentList")?.textContent).toContain("Delete Me");
    });

    root.querySelector<HTMLButtonElement>("[data-document-id='doc_123']")?.click();
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLButtonElement>("#deleteDocumentButton")?.disabled).toBe(false);
    });

    root.querySelector<HTMLButtonElement>("#deleteDocumentButton")?.click();

    await vi.waitFor(() => {
      expect(root.querySelector("#documentList")?.textContent).not.toContain("Delete Me");
    });

    expect(root.querySelector("#status")?.textContent).toContain("Deleted doc_123");
  });

  it("renders the imperative app through the React shell", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const reactRoot = createRoot(root);
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    await act(async () => {
      reactRoot.render(createElement(App));
    });

    expect(root.textContent).toContain("Assignment 2 Core App Baseline");
    expect(addEventListenerSpy).toHaveBeenCalledWith("hashchange", expect.any(Function));

    reactRoot.unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("hashchange", expect.any(Function));
    expect(root.innerHTML).toBe("");
  });
});
