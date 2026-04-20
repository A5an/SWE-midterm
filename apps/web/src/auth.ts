export interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface AuthUserProfile {
  createdAt: string;
  displayName: string;
  email: string;
  userId: string;
  workspaceRole: "owner" | "editor" | "commenter" | "viewer";
  workspaceIds: string[];
}

export interface AuthTokenBundle {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tokenType: "bearer";
}

export interface AuthResponseEnvelope {
  tokens: AuthTokenBundle;
  user: AuthUserProfile;
}

export interface PersistedAuthSession extends AuthResponseEnvelope {
  baseUrl: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    details?: Record<string, unknown>;
    message: string;
    requestId: string;
    retryable: boolean;
  };
}

export interface RestoreSessionResult {
  message: string;
  recoveredWithRefresh: boolean;
  session: PersistedAuthSession | null;
}

export type AuthRoute = "login" | "register" | "workspace";

export const AUTH_SESSION_STORAGE_KEY = "swe-midterm.fastapi-auth-session";

const SKEW_MS = 30_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, "");

export const parseAuthRoute = (hash: string): AuthRoute => {
  const normalized = hash.replace(/^#\/?/, "").trim().toLowerCase();
  if (normalized === "auth/register" || normalized === "register") {
    return "register";
  }
  if (normalized === "auth/workspace" || normalized === "workspace") {
    return "workspace";
  }
  return "login";
};

export const buildAuthRouteHash = (route: AuthRoute): string => `#auth/${route}`;

export const isApiErrorEnvelope = (value: unknown): value is ApiErrorEnvelope => {
  if (!isObject(value) || !isObject(value.error)) {
    return false;
  }

  return (
    isNonEmptyString(value.error.code) &&
    isNonEmptyString(value.error.message) &&
    isNonEmptyString(value.error.requestId) &&
    typeof value.error.retryable === "boolean"
  );
};

export const isAuthUserProfile = (value: unknown): value is AuthUserProfile => {
  if (!isObject(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.email) &&
    isNonEmptyString(value.displayName) &&
    isNonEmptyString(value.createdAt) &&
    Array.isArray(value.workspaceIds) &&
    value.workspaceIds.every((workspaceId) => isNonEmptyString(workspaceId)) &&
    (value.workspaceRole === "owner" ||
      value.workspaceRole === "editor" ||
      value.workspaceRole === "commenter" ||
      value.workspaceRole === "viewer")
  );
};

export const isAuthTokenBundle = (value: unknown): value is AuthTokenBundle => {
  if (!isObject(value)) {
    return false;
  }

  return (
    value.tokenType === "bearer" &&
    isNonEmptyString(value.accessToken) &&
    isNonEmptyString(value.accessTokenExpiresAt) &&
    isNonEmptyString(value.refreshToken) &&
    isNonEmptyString(value.refreshTokenExpiresAt)
  );
};

export const isAuthResponseEnvelope = (value: unknown): value is AuthResponseEnvelope => {
  if (!isObject(value)) {
    return false;
  }

  return isAuthUserProfile(value.user) && isAuthTokenBundle(value.tokens);
};

export const isPersistedAuthSession = (value: unknown): value is PersistedAuthSession => {
  if (!isObject(value) || !isNonEmptyString(value.baseUrl)) {
    return false;
  }

  return isAuthResponseEnvelope(value);
};

export const readPersistedAuthSession = (
  storage: StorageLike,
  storageKey = AUTH_SESSION_STORAGE_KEY
): PersistedAuthSession | null => {
  const raw = storage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPersistedAuthSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const persistAuthSession = (
  storage: StorageLike,
  session: PersistedAuthSession,
  storageKey = AUTH_SESSION_STORAGE_KEY
): void => {
  storage.setItem(storageKey, JSON.stringify(session));
};

export const clearPersistedAuthSession = (
  storage: StorageLike,
  storageKey = AUTH_SESSION_STORAGE_KEY
): void => {
  storage.removeItem(storageKey);
};

const isExpired = (isoTimestamp: string, nowMs = Date.now()): boolean => {
  const expiresAt = Date.parse(isoTimestamp);
  return Number.isNaN(expiresAt) || expiresAt - nowMs <= SKEW_MS;
};

export const getAuthHeaders = (session: PersistedAuthSession): Record<string, string> => ({
  Authorization: `Bearer ${session.tokens.accessToken}`
});

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

const withBaseUrl = (baseUrl: string, path: string): string =>
  `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;

const asSession = (baseUrl: string, payload: AuthResponseEnvelope): PersistedAuthSession => ({
  baseUrl: normalizeBaseUrl(baseUrl),
  tokens: payload.tokens,
  user: payload.user
});

async function submitAuthForm(
  baseUrl: string,
  path: "/v1/auth/login" | "/v1/auth/register" | "/v1/auth/refresh",
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<{ payload: unknown; response: Response }> {
  const response = await fetchImpl(withBaseUrl(baseUrl, path), {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  return {
    payload: await readJson(response),
    response
  };
}

export const registerAuthUser = async (
  baseUrl: string,
  input: {
    displayName: string;
    email: string;
    password: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<PersistedAuthSession> => {
  const { payload, response } = await submitAuthForm(baseUrl, "/v1/auth/register", input, fetchImpl);

  if (!response.ok || !isAuthResponseEnvelope(payload)) {
    throw payload;
  }

  return asSession(baseUrl, payload);
};

export const loginAuthUser = async (
  baseUrl: string,
  input: {
    email: string;
    password: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<PersistedAuthSession> => {
  const { payload, response } = await submitAuthForm(baseUrl, "/v1/auth/login", input, fetchImpl);

  if (!response.ok || !isAuthResponseEnvelope(payload)) {
    throw payload;
  }

  return asSession(baseUrl, payload);
};

export const refreshAuthSession = async (
  session: PersistedAuthSession,
  fetchImpl: typeof fetch = fetch
): Promise<PersistedAuthSession> => {
  const { payload, response } = await submitAuthForm(
    session.baseUrl,
    "/v1/auth/refresh",
    {
      refreshToken: session.tokens.refreshToken
    },
    fetchImpl
  );

  if (!response.ok || !isAuthResponseEnvelope(payload)) {
    throw payload;
  }

  return asSession(session.baseUrl, payload);
};

export const fetchCurrentUserProfile = async (
  session: PersistedAuthSession,
  fetchImpl: typeof fetch = fetch
): Promise<AuthUserProfile> => {
  const response = await fetchImpl(withBaseUrl(session.baseUrl, "/v1/me"), {
    headers: getAuthHeaders(session)
  });
  const payload = await readJson(response);

  if (!response.ok || !isAuthUserProfile(payload)) {
    throw payload;
  }

  return payload;
};

const shouldAttemptRefresh = (error: unknown): boolean =>
  isApiErrorEnvelope(error) &&
  (error.error.code === "AUTHN_TOKEN_EXPIRED" || error.error.code === "AUTHN_INVALID_TOKEN");

export const restorePersistedAuthSession = async (
  storage: StorageLike,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  storageKey = AUTH_SESSION_STORAGE_KEY
): Promise<RestoreSessionResult> => {
  const persisted = readPersistedAuthSession(storage, storageKey);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (!persisted) {
    return {
      message: "No saved session was found.",
      recoveredWithRefresh: false,
      session: null
    };
  }

  if (persisted.baseUrl !== normalizedBaseUrl) {
    return {
      message: `Saved session belongs to ${persisted.baseUrl}. Sign in again to switch Auth API targets.`,
      recoveredWithRefresh: false,
      session: persisted
    };
  }

  if (isExpired(persisted.tokens.accessTokenExpiresAt)) {
    if (isExpired(persisted.tokens.refreshTokenExpiresAt)) {
      clearPersistedAuthSession(storage, storageKey);
      return {
        message: "Saved session expired or is no longer valid. Sign in again.",
        recoveredWithRefresh: false,
        session: null
      };
    }

    try {
      const refreshedSession = await refreshAuthSession(persisted, fetchImpl);
      const profile = await fetchCurrentUserProfile(refreshedSession, fetchImpl);
      const nextSession = { ...refreshedSession, user: profile };
      persistAuthSession(storage, nextSession, storageKey);
      return {
        message: "Restored saved session by refreshing expired credentials.",
        recoveredWithRefresh: true,
        session: nextSession
      };
    } catch {
      clearPersistedAuthSession(storage, storageKey);
      return {
        message: "Saved session expired or is no longer valid. Sign in again.",
        recoveredWithRefresh: false,
        session: null
      };
    }
  }

  try {
    const activeProfile = await fetchCurrentUserProfile(persisted, fetchImpl);
    const nextSession = activeProfile.userId === persisted.user.userId ? persisted : { ...persisted, user: activeProfile };

    persistAuthSession(storage, nextSession, storageKey);
    return {
      message: "Restored saved session.",
      recoveredWithRefresh: false,
      session: nextSession
    };
  } catch (error) {
    if (!shouldAttemptRefresh(error) || isExpired(persisted.tokens.refreshTokenExpiresAt)) {
      clearPersistedAuthSession(storage, storageKey);
      return {
        message: "Saved session expired or is no longer valid. Sign in again.",
        recoveredWithRefresh: false,
        session: null
      };
    }

    try {
      const refreshedSession = await refreshAuthSession(persisted, fetchImpl);
      const profile = await fetchCurrentUserProfile(refreshedSession, fetchImpl);
      const nextSession = { ...refreshedSession, user: profile };
      persistAuthSession(storage, nextSession, storageKey);
      return {
        message: "Restored saved session by refreshing expired credentials.",
        recoveredWithRefresh: true,
        session: nextSession
      };
    } catch {
      clearPersistedAuthSession(storage, storageKey);
      return {
        message: "Saved session expired or is no longer valid. Sign in again.",
        recoveredWithRefresh: false,
        session: null
      };
    }
  }
};
