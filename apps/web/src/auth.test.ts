import assert from "node:assert/strict";
import {
  AUTH_SESSION_STORAGE_KEY,
  buildAuthRouteHash,
  clearPersistedAuthSession,
  isApiErrorEnvelope,
  loginAuthUser,
  parseAuthRoute,
  persistAuthSession,
  readPersistedAuthSession,
  restorePersistedAuthSession,
  type PersistedAuthSession,
  type StorageLike
} from "./auth.ts";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const makeSession = (): PersistedAuthSession => ({
  baseUrl: "http://auth.example.test",
  tokens: {
    accessToken: "access-token",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: "2099-01-02T00:00:00.000Z",
    tokenType: "bearer"
  },
  user: {
    createdAt: "2026-04-19T10:00:00.000Z",
    displayName: "Auth Tester",
    email: "user@example.com",
    userId: "usr_auth",
    workspaceRole: "owner"
  }
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  });

async function testPersistenceRoundTrip(): Promise<void> {
  const storage = new MemoryStorage();
  const session = makeSession();

  persistAuthSession(storage, session);
  assert.deepEqual(readPersistedAuthSession(storage), session);

  clearPersistedAuthSession(storage);
  assert.equal(readPersistedAuthSession(storage), null);
}

async function testRouteParsing(): Promise<void> {
  assert.equal(parseAuthRoute("#auth/login"), "login");
  assert.equal(parseAuthRoute("#auth/register"), "register");
  assert.equal(parseAuthRoute("#auth/workspace"), "workspace");
  assert.equal(buildAuthRouteHash("workspace"), "#auth/workspace");
}

async function testLoginEnvelope(): Promise<void> {
  const session = await loginAuthUser(
    "http://auth.example.test/",
    {
      email: "user@example.com",
      password: "Sup3rSecure!"
    },
    async (input, init) => {
      assert.equal(String(input), "http://auth.example.test/v1/auth/login");
      assert.equal(init?.method, "POST");
      return jsonResponse(200, {
        user: makeSession().user,
        tokens: makeSession().tokens
      });
    }
  );

  assert.equal(session.baseUrl, "http://auth.example.test");
  assert.equal(session.user.email, "user@example.com");
}

async function testRestoreSessionViaProtectedProfile(): Promise<void> {
  const storage = new MemoryStorage();
  const session = makeSession();
  persistAuthSession(storage, session);

  const restored = await restorePersistedAuthSession(storage, session.baseUrl, async (input, init) => {
    assert.equal(String(input), "http://auth.example.test/v1/me");
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer access-token");
    return jsonResponse(200, session.user);
  });

  assert.equal(restored.recoveredWithRefresh, false);
  assert.equal(restored.message, "Restored saved session.");
  assert.deepEqual(restored.session, session);
}

async function testRestoreSessionRefreshesExpiredAccessToken(): Promise<void> {
  const storage = new MemoryStorage();
  const session = makeSession();
  session.tokens.accessTokenExpiresAt = "2000-01-01T00:00:00.000Z";
  persistAuthSession(storage, session);

  let step = 0;
  const restored = await restorePersistedAuthSession(storage, session.baseUrl, async (input, init) => {
    step += 1;

    if (step === 1) {
      assert.equal(String(input), "http://auth.example.test/v1/auth/refresh");
      assert.equal(init?.method, "POST");
      return jsonResponse(200, {
        user: session.user,
        tokens: {
          ...session.tokens,
          accessToken: "rotated-access-token",
          accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
          refreshToken: "rotated-refresh-token"
        }
      });
    }

    assert.equal(String(input), "http://auth.example.test/v1/me");
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer rotated-access-token");
    return jsonResponse(200, session.user);
  });

  assert.equal(step, 2);
  assert.equal(restored.recoveredWithRefresh, true);
  assert.equal(restored.session?.tokens.accessToken, "rotated-access-token");
  assert.equal(
    readPersistedAuthSession(storage, AUTH_SESSION_STORAGE_KEY)?.tokens.refreshToken,
    "rotated-refresh-token"
  );
}

async function testRestoreSessionClearsExpiredRefreshToken(): Promise<void> {
  const storage = new MemoryStorage();
  const session = makeSession();
  session.tokens.accessTokenExpiresAt = "2000-01-01T00:00:00.000Z";
  session.tokens.refreshTokenExpiresAt = "2000-01-01T00:00:00.000Z";
  persistAuthSession(storage, session);

  const restored = await restorePersistedAuthSession(storage, session.baseUrl, async () => {
    throw new Error("fetch should not be called when both tokens are already expired");
  });

  assert.equal(restored.session, null);
  assert.equal(readPersistedAuthSession(storage), null);
}

async function testApiErrorGuard(): Promise<void> {
  assert.equal(
    isApiErrorEnvelope({
      error: {
        code: "AUTHN_TOKEN_EXPIRED",
        message: "Expired.",
        requestId: "req_123",
        retryable: false
      }
    }),
    true
  );
}

await testPersistenceRoundTrip();
await testRouteParsing();
await testLoginEnvelope();
await testRestoreSessionViaProtectedProfile();
await testRestoreSessionRefreshesExpiredAccessToken();
await testRestoreSessionClearsExpiredRefreshToken();
await testApiErrorGuard();

console.log("frontend-auth: persistence, refresh, and protected-route helpers passed");
