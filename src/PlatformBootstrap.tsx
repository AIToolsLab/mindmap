import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import App from "./App";
import type { ProviderRuntimeConfig } from "./api";
import { MutationPolicyProvider } from "./mutation-policy";
import { SESSION_STORAGE_KEY } from "./session-persistence";
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
import { ReaderViewProvider, useReaderView } from "./reader-view";
import { UiLocaleProvider, useUiLocale } from "./ui-locale";

type BootState =
  | { kind: "connecting" }
  | { kind: "connect_required"; detail?: string }
  | { kind: "storage_unavailable" }
  | { kind: "ready"; session: OAuthSession | null };

function ReaderMutationBoundary({ children }: { children: ReactNode }) {
  const reader = useReaderView();
  return (
    <MutationPolicyProvider
      mode={reader.isTranslatedView ? "translated_view" : "authoring"}
      onRejected={reader.reportReadOnlyRejection}
    >
      {children}
    </MutationPolicyProvider>
  );
}

/**
 * Root error boundary. A render crash must leave the locally saved mindmap intact;
 * reloading may recover it, while clearing storage here would turn a UI defect into
 * data loss.
 */
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
        <p>Your saved mindmap has not been changed. Reloading should bring it back.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </main>
    );
  }
}

interface BrowserStorage {
  session: Storage;
  local: Storage;
}

export function browserStorage(): BrowserStorage | null {
  if (typeof window === "undefined") return null;
  try {
    const session = window.sessionStorage;
    const local = window.localStorage;
    session.getItem(OAUTH_SESSION_STORAGE_KEY);
    local.getItem(SESSION_STORAGE_KEY);
    return { session, local };
  } catch {
    return null;
  }
}

export function initialBootState(): BootState {
  if (typeof window === "undefined") return { kind: "connecting" };
  const storage = browserStorage();
  if (!storage) return { kind: "storage_unavailable" };
  if (oauthCallbackFromSearch(window.location.search)) return { kind: "connecting" };
  const session = readOAuthSession(storage.session);
  if (session) return { kind: "ready", session };
  try {
    clearOAuthSession(storage.session);
  } catch {
    return { kind: "storage_unavailable" };
  }
  return loginRequired() ? { kind: "connect_required" } : { kind: "ready", session: null };
}

export default function PlatformBootstrap() {
  return (
    <AppErrorBoundary>
      <UiLocaleProvider>
        <PlatformBootstrapContent />
      </UiLocaleProvider>
    </AppErrorBoundary>
  );
}

function PlatformBootstrapContent() {
  const { t } = useUiLocale();
  const capturedCallback = useRef<OAuthCallback | null>(
    typeof window === "undefined" ? null : oauthCallbackFromSearch(window.location.search),
  );
  const callbackHandled = useRef(false);
  const [boot, setBoot] = useState<BootState>(initialBootState);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const callback = capturedCallback.current;
    if (!callback || callbackHandled.current) return;
    callbackHandled.current = true;

    // Authorization material must leave the address bar before any asynchronous
    // exchange or failure path can run.
    try {
      scrubOAuthCallbackFromUrl(window.location, window.history);
    } catch {
      // Continue with the values already captured in memory. A history wrapper must
      // not trigger a reload that could replay the authorization code.
    }

    const storage = browserStorage();
    if (!storage) {
      setBoot({ kind: "storage_unavailable" });
      return;
    }
    const transaction = consumeOAuthTransaction(storage.session);
    const validTransaction = Boolean(
      callback.state &&
      transaction &&
      callback.state === transaction.state &&
      transaction.redirectUri === oauthRedirectUri(window.location) &&
      transaction.resource === OAUTH_RESOURCE,
    );
    if (!validTransaction) {
      setBoot({ kind: "connect_required", detail: t("The login response could not be verified. Please try again.") });
      return;
    }
    if (callback.error) {
      setBoot({
        kind: "connect_required",
        detail: callback.error === "access_denied"
          ? t("Writing Tools access was not granted.")
          : t("Writing Tools could not complete the login."),
      });
      return;
    }
    if (!callback.code || !transaction) {
      setBoot({ kind: "connect_required", detail: t("The login response could not be verified. Please try again.") });
      return;
    }
    setBoot({ kind: "connecting" });
    void exchangeAuthorizationCode(callback.code, transaction)
      .then((session) => {
        writeOAuthSession(storage.session, session);
        setForbidden(false);
        setBoot({ kind: "ready", session });
      })
      .catch(() => {
        setBoot({ kind: "connect_required", detail: t("Writing Tools could not complete the login. Please try again.") });
      });
  }, [t]);

  const connect = useCallback(async () => {
    const storage = browserStorage();
    if (!storage) {
      setBoot({ kind: "storage_unavailable" });
      return;
    }
    setBoot({ kind: "connecting" });
    try {
      const request = await createAuthorizationRequest({ storage: storage.session, location: window.location });
      window.location.assign(request.url);
    } catch {
      setBoot({ kind: "connect_required", detail: t("Mindmap could not start a secure login. Please try again.") });
    }
  }, [t]);

  const disconnect = useCallback(() => {
    const storage = browserStorage();
    if (!storage) {
      setBoot({ kind: "storage_unavailable" });
      return;
    }
    try {
      clearOAuthSession(storage.session);
    } catch {
      setBoot({ kind: "storage_unavailable" });
      return;
    }
    setForbidden(false);
    setBoot({ kind: "connect_required" });
  }, []);

  const onAccessError = useCallback((status: 401 | 403) => {
    if (status === 403) {
      setForbidden(true);
      return;
    }
    const storage = browserStorage();
    if (!storage) {
      setBoot({ kind: "storage_unavailable" });
      return;
    }
    try {
      clearOAuthSession(storage.session);
    } catch {
      setBoot({ kind: "storage_unavailable" });
      return;
    }
    setForbidden(false);
    setBoot({ kind: "connect_required", detail: t("Your Writing Tools access expired. Your local work is still here.") });
  }, [t]);

  const providerRuntime = useMemo<ProviderRuntimeConfig | undefined>(() => {
    if (boot.kind !== "ready") return undefined;
    return {
      ...(boot.session ? { bearerToken: boot.session.accessToken } : {}),
      onAccessError,
    };
  }, [boot, onAccessError]);

  if (boot.kind === "connecting") {
    return <main className="platform-gate"><h1>{t("Connecting to Writing Tools…")}</h1></main>;
  }

  if (boot.kind === "storage_unavailable") {
    return (
      <main className="platform-gate">
        <h1>{t("Mindmap needs browser storage")}</h1>
        <p>{t("Browser storage is unavailable, so Mindmap cannot safely preserve your access or local work. Enable storage for this site and reload.")}</p>
      </main>
    );
  }

  if (boot.kind === "connect_required") {
    return (
      <main className="platform-gate">
        <h1>{t("Connect to Writing Tools")}</h1>
        <p>{t("Sign in to use Writing Tools AI. Your draft and map stay in this browser.")}</p>
        {boot.detail && <p className="platform-detail" role="alert">{boot.detail}</p>}
        <button type="button" onClick={() => void connect()}>{t("Connect")}</button>
      </main>
    );
  }

  return (
    <div className="platform-workspace">
      {boot.session && (
        <button type="button" className="platform-disconnect" onClick={disconnect}>{t("Disconnect")}</button>
      )}
      <ReaderViewProvider providerRuntime={providerRuntime} disabled={forbidden}>
        <ReaderMutationBoundary>
          <App providerRuntime={providerRuntime} aiAccessDenied={forbidden} />
        </ReaderMutationBoundary>
      </ReaderViewProvider>
    </div>
  );
}
