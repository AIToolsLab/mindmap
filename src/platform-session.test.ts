import { describe, expect, it, vi } from "vitest";
import {
  OAUTH_SCOPE,
  OAUTH_SESSION_STORAGE_KEY,
  OAUTH_TRANSACTION_STORAGE_KEY,
  canonicalOAuthResource,
  clearOAuthSession,
  consumeOAuthTransaction,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  isCompactJwt,
  loginRequired,
  oauthCallbackFromSearch,
  oauthRedirectUri,
  readOAuthSession,
  resolveBackendUrl,
  resolveOAuthClientId,
  scrubOAuthCallbackFromUrl,
  writeOAuthSession,
  type OAuthTransaction,
} from "./platform-session";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(exp = Math.floor(Date.now() / 1000) + 43_200): string {
  return `${base64Url({ alg: "EdDSA", typ: "JWT" })}.${base64Url({ exp })}.signature`;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const transaction: OAuthTransaction = {
  version: 1,
  state: "state",
  verifier: "v".repeat(64),
  redirectUri: "https://mindmap.example/",
  resource: "https://app.example",
  createdAt: 1,
};

describe("standalone OAuth session", () => {
  it("fails closed in production while keeping development defaults", () => {
    expect(resolveBackendUrl({ PROD: false })).toBe("http://localhost:8000/api");
    expect(resolveOAuthClientId({ PROD: false })).toBe("writing-tools-mindmap");
    expect(() => resolveBackendUrl({ PROD: true })).toThrow("VITE_BACKEND_URL");
    expect(() => resolveOAuthClientId({ PROD: true })).toThrow("VITE_OAUTH_CLIENT_ID");
  });

  it("requires login unconditionally in production and only by opt-in in development", () => {
    expect(loginRequired({ PROD: true, VITE_REQUIRE_LOGIN: "false" })).toBe(true);
    expect(loginRequired({ PROD: false })).toBe(false);
    expect(loginRequired({ PROD: false, VITE_REQUIRE_LOGIN: "true" })).toBe(true);
  });

  it("derives the byte-exact origin resource and callback", () => {
    expect(canonicalOAuthResource("https://APP.Example/api/")).toBe("https://app.example");
    expect(oauthRedirectUri({ origin: "https://mindmap.example", pathname: "/" })).toBe("https://mindmap.example/");
  });

  it("creates S256 authorization state and persists the transaction before redirect", async () => {
    const storage = memoryStorage();
    const request = await createAuthorizationRequest({
      storage,
      location: { origin: "https://mindmap.example", pathname: "/" },
      backendUrl: "https://app.example/api",
      clientId: "writing-tools-mindmap",
      now: () => 10,
    });
    const url = new URL(request.url);
    expect(url.pathname).toBe("/api/auth/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("writing-tools-mindmap");
    expect(url.searchParams.get("redirect_uri")).toBe("https://mindmap.example/");
    expect(url.searchParams.get("scope")).toBe(OAUTH_SCOPE);
    expect(url.searchParams.get("resource")).toBe("https://app.example");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(request.transaction.state);
    expect(JSON.parse(storage.getItem(OAUTH_TRANSACTION_STORAGE_KEY)!)).toEqual(request.transaction);
  });

  it("captures and scrubs callback material while preserving unrelated query and hash values", () => {
    expect(oauthCallbackFromSearch("?view=map&code=c&state=s")).toEqual({ code: "c", state: "s" });
    const replaceState = vi.fn();
    scrubOAuthCallbackFromUrl(
      { pathname: "/", search: "?view=map&code=c&state=s&error_description=no", hash: "#draft" },
      { state: { keep: true }, replaceState },
    );
    expect(replaceState).toHaveBeenCalledWith({ keep: true }, "", "/?view=map#draft");
  });

  it("consumes authorization state exactly once", () => {
    const storage = memoryStorage();
    storage.setItem(OAUTH_TRANSACTION_STORAGE_KEY, JSON.stringify(transaction));
    expect(consumeOAuthTransaction(storage)).toEqual(transaction);
    expect(consumeOAuthTransaction(storage)).toBeNull();
  });

  it("accepts only unexpired compact JWT sessions and clears OAuth state without local work", () => {
    const storage = memoryStorage();
    const session = { version: 1 as const, accessToken: jwt(200), expiresAt: 200_000 };
    writeOAuthSession(storage, session);
    expect(readOAuthSession(storage, 100_000)).toEqual(session);
    expect(readOAuthSession(storage, 201_000)).toBeNull();
    expect(isCompactJwt("not-a-token")).toBe(false);
    storage.setItem(OAUTH_TRANSACTION_STORAGE_KEY, JSON.stringify(transaction));
    clearOAuthSession(storage);
    expect(storage.getItem(OAUTH_SESSION_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(OAUTH_TRANSACTION_STORAGE_KEY)).toBeNull();
  });

  it("exchanges with omitted credentials and repeats the exact resource", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      access_token: jwt(44_000),
      token_type: "Bearer",
      scope: OAUTH_SCOPE,
      expires_in: 43_200,
    }));
    const session = await exchangeAuthorizationCode("code", transaction, {
      fetcher,
      backendUrl: "https://app.example/api",
      clientId: "writing-tools-mindmap",
      now: () => 1_000,
    });
    expect(session.accessToken).toContain(".");
    const [, init] = fetcher.mock.calls[0]!;
    expect(init).toMatchObject({ method: "POST", credentials: "omit" });
    const form = init.body as URLSearchParams;
    expect(form.get("resource")).toBe("https://app.example");
    expect(form.get("redirect_uri")).toBe("https://mindmap.example/");
    expect(form.get("code_verifier")).toBe(transaction.verifier);
  });

  it.each([
    { token_type: "bearer", scope: OAUTH_SCOPE, expires_in: 43_200, access_token: jwt() },
    { token_type: "Bearer", scope: "doc:read", expires_in: 43_200, access_token: jwt() },
    { token_type: "Bearer", scope: OAUTH_SCOPE, expires_in: 86_401, access_token: jwt() },
    { token_type: "Bearer", scope: OAUTH_SCOPE, expires_in: 0, access_token: jwt() },
    { token_type: "Bearer", scope: OAUTH_SCOPE, expires_in: 43_200, access_token: "opaque" },
  ])("rejects a token response outside the Track A contract", async (body) => {
    await expect(exchangeAuthorizationCode("code", transaction, {
      fetcher: vi.fn().mockResolvedValue(response(body)),
    })).rejects.toMatchObject({ code: "invalid" });
  });

  it("accepts a shorter server-selected access-token lifetime", async () => {
    const accessToken = jwt(3_700);
    await expect(exchangeAuthorizationCode("code", transaction, {
      fetcher: vi.fn().mockResolvedValue(response({
        token_type: "Bearer", scope: OAUTH_SCOPE, expires_in: 3_600, access_token: accessToken,
      })),
      now: () => 100_000,
    })).resolves.toMatchObject({ accessToken });
  });

  it("rejects a correctly shaped token that is already expired", async () => {
    await expect(exchangeAuthorizationCode("code", transaction, {
      fetcher: vi.fn().mockResolvedValue(response({
        token_type: "Bearer", scope: OAUTH_SCOPE, expires_in: 43_200, access_token: jwt(1),
      })),
      now: () => 2_000,
    })).rejects.toMatchObject({ code: "invalid" });
  });
});
