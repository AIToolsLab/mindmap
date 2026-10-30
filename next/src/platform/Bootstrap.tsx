import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { STORAGE_KEY } from "../state/persist";
import { App } from "../ui/App";
import {
  OAUTH_RESOURCE,
  OAUTH_SESSION_STORAGE_KEY,
  clearOAuthSession,
  consumeOAuthTransaction,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  loginRequired,
  oauthCallbackFromSearch,
  oauthRedirectUri,
  readOAuthSession,
  scrubOAuthCallbackFromUrl,
  writeOAuthSession,
  type OAuthCallback,
  type OAuthSession,
} from "./platform-session";

/**
 * Sign-in for the tools-first app: the same Writing Tools OAuth (PKCE) flow as the
 * current app's `src/platform/PlatformBootstrap.tsx`, without its language and reader
 * plumbing. Same client, same redirect URI and the same session storage key, so a
 * signed-in user stays signed in when the site is switched between the two apps.
 * Production always requires sign-in; local dev skips it unless VITE_REQUIRE_LOGIN=true.
 */

export type BootState =
  | { kind: "connecting" }
  | { kind: "connect_required"; detail?: string }
  | { kind: "storage_unavailable" }
  | { kind: "ready"; session: OAuthSession | null };

/** A render crash must leave the saved map alone; reloading may recover it. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Mindmap crashed during render.", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="platform-gate">
        <h1>Mindmap hit an unexpected error</h1>
        <p>Your saved map has not been changed. Reloading should bring it back.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </main>
    );
  }
}

function browserStorage(): { session: Storage; local: Storage } | null {
  if (typeof window === "undefined") return null;
  try {
    const session = window.sessionStorage;
    const local = window.localStorage;
    session.getItem(OAUTH_SESSION_STORAGE_KEY);
    local.getItem(STORAGE_KEY);
    return { session, local };
  } catch {
    return null;
  }
}

export function initialBootState(search = typeof window === "undefined" ? "" : window.location.search): BootState {
  if (typeof window === "undefined") return { kind: "connecting" };
  const storage = browserStorage();
  if (!storage) return { kind: "storage_unavailable" };
  if (oauthCallbackFromSearch(search)) return { kind: "connecting" };
  const session = readOAuthSession(storage.session);
  if (session) return { kind: "ready", session };
  try {
    clearOAuthSession(storage.session);
  } catch {
    return { kind: "storage_unavailable" };
  }
  return loginRequired() ? { kind: "connect_required" } : { kind: "ready", session: null };
}

const NOT_VERIFIED = "The login response could not be verified. Please try again.";

export function Bootstrap() {
  return (
    <AppErrorBoundary>
      <BootstrapContent />
    </AppErrorBoundary>
  );
}

function BootstrapContent() {
  const captured = useRef<OAuthCallback | null>(typeof window === "undefined" ? null : oauthCallbackFromSearch(window.location.search));
  const handled = useRef(false);
  const [boot, setBoot] = useState<BootState>(initialBootState);
  const [forbidden, setForbidden] = useState(false);

  // Returning from Writing Tools: exchange the code for a token.
  useEffect(() => {
    const callback = captured.current;
    if (!callback || handled.current) return;
    handled.current = true;
    // The code must leave the address bar before anything asynchronous can fail.
    try {
      scrubOAuthCallbackFromUrl(window.location, window.history);
    } catch {
      // Keep going with the values already captured; never reload and replay the code.
    }
    const storage = browserStorage();
    if (!storage) return setBoot({ kind: "storage_unavailable" });
    const transaction = consumeOAuthTransaction(storage.session);
    const valid = Boolean(
      callback.state && transaction && callback.state === transaction.state &&
      transaction.redirectUri === oauthRedirectUri(window.location) && transaction.resource === OAUTH_RESOURCE,
    );
    if (!valid) return setBoot({ kind: "connect_required", detail: NOT_VERIFIED });
    if (callback.error) {
      return setBoot({
        kind: "connect_required",
        detail: callback.error === "access_denied" ? "Writing Tools access was not granted." : "Writing Tools could not complete the login.",
      });
    }
    if (!callback.code || !transaction) return setBoot({ kind: "connect_required", detail: NOT_VERIFIED });
    setBoot({ kind: "connecting" });
    void exchangeAuthorizationCode(callback.code, transaction)
      .then((session) => {
        writeOAuthSession(storage.session, session);
        setForbidden(false);
        setBoot({ kind: "ready", session });
      })
      .catch(() => setBoot({ kind: "connect_required", detail: "Writing Tools could not complete the login. Please try again." }));
  }, []);

  const connect = useCallback(async () => {
    const storage = browserStorage();
    if (!storage) return setBoot({ kind: "storage_unavailable" });
    setBoot({ kind: "connecting" });
    try {
      const request = await createAuthorizationRequest({ storage: storage.session, location: window.location });
      window.location.assign(request.url);
    } catch {
      setBoot({ kind: "connect_required", detail: "Mindmap could not start a secure login. Please try again." });
    }
  }, []);

  /** Forget the token. `detail` explains why when it wasn't the writer's choice. */
  const signOut = useCallback((detail?: string) => {
    const storage = browserStorage();
    if (!storage) return setBoot({ kind: "storage_unavailable" });
    try {
      clearOAuthSession(storage.session);
    } catch {
      return setBoot({ kind: "storage_unavailable" });
    }
    setForbidden(false);
    setBoot({ kind: "connect_required", ...(detail ? { detail } : {}) });
  }, []);

  const onAccessError = useCallback(
    (status: 401 | 403) => {
      if (status === 403) setForbidden(true);
      else signOut("Your Writing Tools access expired. Your local work is still here.");
    },
    [signOut],
  );

  if (boot.kind === "connecting") {
    return <main className="platform-gate"><h1>Connecting to Writing Tools…</h1></main>;
  }
  if (boot.kind === "storage_unavailable") {
    return (
      <main className="platform-gate">
        <h1>Mindmap needs browser storage</h1>
        <p>Browser storage is unavailable, so Mindmap can't safely keep your access or your work. Enable storage for this site and reload.</p>
      </main>
    );
  }
  if (boot.kind === "connect_required") {
    return (
      <main className="platform-gate">
        <h1>Connect to Writing Tools</h1>
        <p>Sign in to use Writing Tools AI. Your chat, map and draft stay in this browser.</p>
        {boot.detail && <p className="platform-detail" role="alert">{boot.detail}</p>}
        <button type="button" onClick={() => void connect()}>Connect</button>
      </main>
    );
  }
  return (
    <App
      bearerToken={boot.session?.accessToken}
      onAccessError={onAccessError}
      aiAccessDenied={forbidden}
      onDisconnect={boot.session ? () => signOut() : undefined}
    />
  );
}
