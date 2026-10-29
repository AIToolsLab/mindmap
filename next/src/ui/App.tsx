import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { callResponses } from "../loop/client";
import { runTurn } from "../loop/turn";
import { mapToMarkdown } from "../state/export";
import {
  acceptProposal,
  addCard,
  addLink,
  deleteCard,
  deleteLink,
  editCard,
  editLinkLabel,
  moveCard,
  rejectProposal,
  setParent,
  undo,
} from "../state/map";
import { loadSession, saveSession } from "../state/persist";
import { emptySession, type Level, type Session } from "../state/types";
import { Chat } from "./Chat";
import { copyText } from "./clipboard";
import { MapView, type MapActions } from "./MapView";

const LEVELS: { value: Level; label: string }[] = [
  { value: 0, label: "L0 · cards from your messages" },
  { value: 1, label: "L1 · also from your draft" },
  { value: 2, label: "L2 · coach may suggest" },
];

export function App() {
  const [session, setSession] = useState<Session>(() => loadSession());
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);

  // Refs so callbacks always see the latest values without being rebuilt.
  const current = useRef(session);
  current.current = session;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  /** A card just made with "+ Card"; if it's left empty, it goes away again. */
  const fresh = useRef<string | null>(null);

  useEffect(() => {
    setSaved(saveSession(session));
  }, [session]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2000);
    return () => clearTimeout(t);
  }, [flash]);

  /** Every writer edit goes through here; nothing changes while a turn runs (it works from a snapshot). */
  const act = (fn: (s: Session) => Session) => {
    if (!busyRef.current) setSession((s) => fn(s));
  };

  const actions = useMemo<MapActions>(
    () => ({
      move: (id, x, y) => act((s) => moveCard(s, id, x, y)),
      nest: (child, parent) => act((s) => setParent(s, child, parent)),
      takeOutAt: (id, x, y) => act((s) => moveCard(setParent(s, id, null), id, x, y)),
      takeOut: (id) => act((s) => setParent(s, id, null)),
      finishEdit: (id, text) => {
        const isFresh = fresh.current === id;
        if (isFresh) fresh.current = null;
        const final = text ?? current.current.map.cards.find((c) => c.id === id)?.text ?? "";
        // Undo the "+ Card" step rather than delete, so no extra undo step is left behind.
        if (isFresh && !final.trim()) act(undo);
        else if (text !== null) act((s) => editCard(s, id, text));
      },
      remove: (id) => act((s) => deleteCard(s, id)),
      link: (from, to) => {
        if (busyRef.current) return;
        const label = window.prompt("Label for this link (optional):", "");
        if (label !== null) act((s) => addLink(s, from, to, label.trim()));
      },
      relabel: (linkId) => {
        const link = current.current.map.links.find((l) => l.id === linkId);
        if (!link || busyRef.current) return;
        const label = window.prompt("Link label:", link.label);
        if (label !== null) act((s) => editLinkLabel(s, linkId, label.trim()));
      },
      unlink: (linkId) => act((s) => deleteLink(s, linkId)),
    }),
    [],
  );

  const send = async (text: string) => {
    if (busyRef.current) return;
    setEditId(null);
    setBusy(true);
    try {
      const done = await runTurn(current.current, text, { callModel: callResponses, onUpdate: setSession });
      setSession(done);
    } catch (error) {
      // runTurn reports its own errors; this only catches a failure outside it.
      const note = `Something went wrong: ${error instanceof Error ? error.message : String(error)}`;
      setSession((s) => ({ ...s, transcript: [...s.transcript, { kind: "notice", text: note }] }));
    } finally {
      setBusy(false);
    }
  };

  const newCard = () => {
    if (busyRef.current) return;
    // Let go of the button at once, so a space or Enter typed before the new card's
    // editor takes focus can't press "+ Card" again.
    (document.activeElement as HTMLElement | null)?.blur();
    const id = `c${current.current.counters.card + 1}`;
    act((s) => addCard(s, ""));
    fresh.current = id;
    setEditId(id);
  };

  const copy = async (what: "map" | "draft") => {
    const text = what === "map" ? mapToMarkdown(session.map) : session.record.draft;
    setFlash((await copyText(text)) ? `Copied ${what}` : `Couldn't copy the ${what}`);
  };

  const reset = () => {
    if (!busyRef.current && window.confirm("Start a new session? This clears the chat, map and draft in this browser.")) setSession(emptySession());
  };

  return (
    <div className={`app${showDraft ? " with-draft" : ""}`}>
      <header className="toolbar">
        <label className="level">
          <span>Level</span>
          <select value={session.level} disabled={busy} onChange={(e) => act((s) => ({ ...s, level: Number(e.target.value) as Level }))}>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small">applies from your next message</span>
        <span className="spacer" />
        <button type="button" disabled={busy} onClick={newCard}>+ Card</button>
        <button type="button" disabled={busy || !session.undo.length} onClick={() => act(undo)}>Undo</button>
        <button type="button" onClick={() => copy("map")}>Copy map</button>
        <button type="button" onClick={() => copy("draft")}>Copy draft</button>
        <button type="button" className={showDraft ? "on" : ""} aria-pressed={showDraft} onClick={() => setShowDraft((v) => !v)}>Draft</button>
        <label className="check" title="Mark cards you write from the coach's suggestions as AI suggested">
          <input type="checkbox" checked={session.settings.suggestionAdoption} disabled={busy} onChange={(e) => act((s) => ({ ...s, settings: { ...s.settings, suggestionAdoption: e.target.checked } }))} />
          Track suggestion adoption
        </label>
        <button type="button" className="quiet" disabled={busy} onClick={reset}>New session</button>
      </header>

      <Chat session={session} busy={busy} onSend={send} onAccept={(id) => act((s) => acceptProposal(s, id))} onReject={(id) => act((s) => rejectProposal(s, id))} />

      <main className="map" aria-label="Map">
        <ReactFlowProvider>
          <MapView map={session.map} readOnly={busy} editId={editId} setEditId={setEditId} actions={actions} />
        </ReactFlowProvider>
        {session.map.cards.length === 0 && <div className="map-empty muted">No cards yet</div>}
        <div className="map-hint muted small">Double-click to edit · drop a card on another to nest · drag out or "Out" to separate · drag from a card's dot to link · select a link + Delete to remove</div>
      </main>

      {showDraft && (
        <aside className="draft" aria-label="Draft">
          <div className="draft-head">
            <strong>Draft</strong>
            <span className="muted small">{session.level === 0 ? "The coach reads it; cards can't quote it at L0" : "The coach can quote it on cards"}</span>
          </div>
          <textarea
            aria-label="Draft text"
            placeholder="Paste or type your draft here…"
            value={session.record.draft}
            disabled={busy}
            onChange={(e) => {
              const draft = e.target.value;
              act((s) => ({ ...s, record: { ...s.record, draft } }));
            }}
          />
        </aside>
      )}

      {(flash || !saved) && <div className="toast" role="status">{flash ?? "Not saving: this browser's storage is unavailable."}</div>}
    </div>
  );
}
