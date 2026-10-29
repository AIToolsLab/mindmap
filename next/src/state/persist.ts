import { emptySession, type Session } from "./types";

/** Browser saving (spec §4). Storage can be missing or blocked, so every access is guarded. */
export const STORAGE_KEY = "mindmap-next:session:v1";

function isArray(v: unknown): boolean {
  return Array.isArray(v);
}

/** Enough shape to trust a saved session; anything else starts fresh. */
function looksLikeSession(v: unknown): v is Session {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<Session>;
  return (
    (s.level === 0 || s.level === 1 || s.level === 2) &&
    !!s.record && isArray(s.record.messages) && typeof s.record.draft === "string" &&
    !!s.map && isArray(s.map.cards) && isArray(s.map.links) &&
    isArray(s.proposals) && isArray(s.transcript) && isArray(s.history) && isArray(s.decisions) && isArray(s.undo) &&
    !!s.counters && typeof s.counters.card === "number"
  );
}

export function loadSession(storage: Storage | undefined = safeStorage()): Session {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return emptySession();
    const parsed: unknown = JSON.parse(raw);
    if (!looksLikeSession(parsed)) return emptySession();
    const fresh = emptySession();
    return { ...fresh, ...parsed, settings: { ...fresh.settings, ...parsed.settings }, counters: { ...fresh.counters, ...parsed.counters } };
  } catch {
    return emptySession();
  }
}

/** Returns false when the session couldn't be saved (no storage, blocked, or full). */
export function saveSession(session: Session, storage: Storage | undefined = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

/** Reading `localStorage` itself throws in some embedded and private contexts. */
function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
