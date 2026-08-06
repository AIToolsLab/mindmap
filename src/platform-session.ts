/// <reference types="vite/client" />

export const OAUTH_SESSION_STORAGE_KEY = "prototype-mindmap-oauth-session-v1";
export const OAUTH_TRANSACTION_STORAGE_KEY = "prototype-mindmap-oauth-transaction-v1";
export const OAUTH_SESSION_VERSION = 1;
export const OAUTH_CLIENT_ID_DEFAULT = "writing-tools-mindmap";
export const OAUTH_SCOPE = "openai:chat";

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;

type PlatformEnv = {
  PROD?: boolean;
  VITE_BACKEND_URL?: string | boolean;
  VITE_OAUTH_CLIENT_ID?: string | boolean;
  VITE_REQUIRE_LOGIN?: string | boolean;
};

/**
 * A production bundle that quietly falls back to localhost points every user's browser
 * at their own machine — a confusing per-request failure rather than an obvious one.
 * Fail at module load so a misconfigured deploy is caught by the first smoke check.
 */
export function resolveBackendUrl(env: PlatformEnv = viteEnv ?? {}): string {
  const configured = typeof env.VITE_BACKEND_URL === "string" ? env.VITE_BACKEND_URL.trim() : "";
  if (configured) return configured.replace(/\/+$/, "");
  if (env.PROD === true) {
    throw new Error("VITE_BACKEND_URL must be set for production builds of the mindmap.");
  }
  return "http://localhost:8000/api";
}

export function resolveOAuthClientId(env: PlatformEnv = viteEnv ?? {}): string {
  const configured = typeof env.VITE_OAUTH_CLIENT_ID === "string"
    ? env.VITE_OAUTH_CLIENT_ID.trim()
    : "";
  if (configured) return configured;
  if (env.PROD === true) {
    throw new Error("VITE_OAUTH_CLIENT_ID must be set for production builds of the mindmap.");
  }
  return OAUTH_CLIENT_ID_DEFAULT;
}

export function canonicalOAuthResource(backendUrl: string): string {
  return new URL(backendUrl).origin;
}

export const PLATFORM_BACKEND_URL = resolveBackendUrl();
export const OAUTH_CLIENT_ID = resolveOAuthClientId();
export const OAUTH_RESOURCE = canonicalOAuthResource(PLATFORM_BACKEND_URL);

export function loginRequired(env: PlatformEnv = viteEnv ?? {}): boolean {
  // Production always requires login, and `VITE_REQUIRE_LOGIN=false` cannot turn
  // that off. The override exists only for dev servers and Playwright; honouring it
  // in a PROD build would let one stray env var ship an ungated bundle, with nothing
  // at runtime to signal that the gate was disabled.
  if (env.PROD === true) return true;
  return env.VITE_REQUIRE_LOGIN === "true";
}

export interface OAuthSession {
  version: 1;
  accessToken: string;
  expiresAt: number;
}

export interface OAuthTransaction {
  version: 1;
  state: string;
  verifier: string;
  redirectUri: string;
  resource: string;
  createdAt: number;
}

export interface OAuthCallback {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export type OAuthFlowErrorCode = "invalid" | "denied" | "network";

export class OAuthFlowError extends Error {
  constructor(readonly code: OAuthFlowErrorCode, message: string) {
    super(message);
    this.name = "OAuthFlowError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCompactJwt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const segments = value.split(".");
  return segments.length === 3 && segments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment));
}

function decodeJwtExpiry(accessToken: string): number | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (!isRecord(parsed) || typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null;
    return parsed.exp * 1000;
  } catch {
    return null;
  }
}

export function readOAuthSession(
  storage: Pick<Storage, "getItem">,
  now: number = Date.now(),
): OAuthSession | null {
  try {
    const parsed = JSON.parse(storage.getItem(OAUTH_SESSION_STORAGE_KEY) ?? "null") as unknown;
    if (!isRecord(parsed) || parsed.version !== OAUTH_SESSION_VERSION || !isCompactJwt(parsed.accessToken)) {
      return null;
    }
    const storedExpiry = typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt)
      ? parsed.expiresAt
      : null;
    const expiry = decodeJwtExpiry(parsed.accessToken) ?? storedExpiry;
    if (expiry === null || expiry <= now) return null;
    return { version: 1, accessToken: parsed.accessToken, expiresAt: expiry };
  } catch {
    return null;
  }
}

export function writeOAuthSession(storage: Pick<Storage, "setItem">, session: OAuthSession): void {
  storage.setItem(OAUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearOAuthSession(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(OAUTH_SESSION_STORAGE_KEY);
  storage.removeItem(OAUTH_TRANSACTION_STORAGE_KEY);
}

export function readOAuthTransaction(storage: Pick<Storage, "getItem">): OAuthTransaction | null {
  try {
    const parsed = JSON.parse(storage.getItem(OAUTH_TRANSACTION_STORAGE_KEY) ?? "null") as unknown;
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.state !== "string" || !parsed.state ||
      typeof parsed.verifier !== "string" || parsed.verifier.length < 43 ||
      typeof parsed.redirectUri !== "string" ||
      typeof parsed.resource !== "string" ||
      typeof parsed.createdAt !== "number" || !Number.isFinite(parsed.createdAt)
    ) return null;
    return parsed as unknown as OAuthTransaction;
  } catch {
    return null;
  }
}

export function writeOAuthTransaction(
  storage: Pick<Storage, "setItem">,
  transaction: OAuthTransaction,
): void {
  storage.setItem(OAUTH_TRANSACTION_STORAGE_KEY, JSON.stringify(transaction));
}

export function consumeOAuthTransaction(
  storage: Pick<Storage, "getItem" | "removeItem">,
): OAuthTransaction | null {
  const transaction = readOAuthTransaction(storage);
  storage.removeItem(OAUTH_TRANSACTION_STORAGE_KEY);
  return transaction;
}

function randomBase64Url(bytes: number, cryptoImpl: Crypto): string {
  const values = new Uint8Array(bytes);
  cryptoImpl.getRandomValues(values);
  let binary = "";
  values.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64Url(values: Uint8Array): string {
  let binary = "";
  values.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function oauthRedirectUri(location: Pick<Location, "origin" | "pathname">): string {
  return `${location.origin}${location.pathname}`;
}

export async function createAuthorizationRequest(options: {
  storage: Pick<Storage, "setItem">;
  location: Pick<Location, "origin" | "pathname">;
  cryptoImpl?: Crypto;
  backendUrl?: string;
  clientId?: string;
  now?: () => number;
}): Promise<{ url: string; transaction: OAuthTransaction }> {
  const cryptoImpl = options.cryptoImpl ?? crypto;
  const backendUrl = options.backendUrl ?? PLATFORM_BACKEND_URL;
  const resource = canonicalOAuthResource(backendUrl);
  const verifier = randomBase64Url(48, cryptoImpl);
  const state = randomBase64Url(32, cryptoImpl);
  const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const redirectUri = oauthRedirectUri(options.location);
  const transaction: OAuthTransaction = {
    version: 1,
    state,
    verifier,
    redirectUri,
    resource,
    createdAt: (options.now ?? Date.now)(),
  };
  writeOAuthTransaction(options.storage, transaction);
  const url = new URL(`${backendUrl}/auth/oauth2/authorize`);
  url.search = new URLSearchParams({
    client_id: options.clientId ?? OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPE,
    code_challenge: bytesToBase64Url(new Uint8Array(digest)),
    code_challenge_method: "S256",
    state,
    resource,
  }).toString();
  return { url: url.toString(), transaction };
}

export function oauthCallbackFromSearch(search: string): OAuthCallback | null {
  const params = new URLSearchParams(search);
  if (!params.has("code") && !params.has("error")) return null;
  return {
    ...(params.get("code") ? { code: params.get("code")! } : {}),
    ...(params.get("state") ? { state: params.get("state")! } : {}),
    ...(params.get("error") ? { error: params.get("error")! } : {}),
    ...(params.get("error_description") ? { errorDescription: params.get("error_description")! } : {}),
  };
}

export function scrubOAuthCallbackFromUrl(
  location: Pick<Location, "pathname" | "search" | "hash">,
  history: Pick<History, "replaceState" | "state">,
): void {
  const params = new URLSearchParams(location.search);
  for (const key of ["code", "state", "error", "error_description"]) params.delete(key);
  const search = params.toString();
  history.replaceState(history.state, "", `${location.pathname}${search ? `?${search}` : ""}${location.hash}`);
}

export async function exchangeAuthorizationCode(
  code: string,
  transaction: OAuthTransaction,
  options: {
    fetcher?: typeof fetch;
    backendUrl?: string;
    clientId?: string;
    now?: () => number;
  } = {},
): Promise<OAuthSession> {
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      `${options.backendUrl ?? PLATFORM_BACKEND_URL}/auth/oauth2/token`,
      {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: options.clientId ?? OAUTH_CLIENT_ID,
          redirect_uri: transaction.redirectUri,
          code,
          code_verifier: transaction.verifier,
          resource: transaction.resource,
        }),
      },
    );
  } catch (error) {
    throw new OAuthFlowError("network", error instanceof Error ? error.message : "Could not reach Writing Tools.");
  }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new OAuthFlowError(
      body.error === "access_denied" ? "denied" : "invalid",
      typeof body.error_description === "string" ? body.error_description : "Writing Tools rejected the login.",
    );
  }
  const expiresIn = body.expires_in;
  const scopes = typeof body.scope === "string" ? body.scope.trim().split(/\s+/).filter(Boolean) : [];
  if (
    body.token_type !== "Bearer" ||
    scopes.length !== 1 || scopes[0] !== OAUTH_SCOPE ||
    typeof expiresIn !== "number" || !Number.isFinite(expiresIn) ||
    expiresIn <= 0 || expiresIn > 86_400 ||
    !isCompactJwt(body.access_token)
  ) {
    throw new OAuthFlowError("invalid", "Writing Tools returned an invalid OAuth session.");
  }
  const now = (options.now ?? Date.now)();
  const tokenExpiry = decodeJwtExpiry(body.access_token);
  if (tokenExpiry !== null && tokenExpiry <= now) {
    throw new OAuthFlowError("invalid", "Writing Tools returned an expired OAuth session.");
  }
  return {
    version: 1,
    accessToken: body.access_token,
    expiresAt: tokenExpiry ?? now + expiresIn * 1000,
  };
}
