import { useEffect, useRef, useState } from "react";
import { blockedReason } from "../state/map";
import type { Proposal, Session, TranscriptItem } from "../state/types";

interface Props {
  session: Session;
  busy: boolean;
  onSend: (text: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

const STATUS: Record<Exclude<Proposal["status"], "pending">, string> = {
  accepted: "Accepted",
  rejected: "Rejected",
  dropped: "Dropped",
};

/** One line per tool call (spec §8): name, summary, then Accept/Reject or the outcome. */
function ToolLine({ item, session, busy, onAccept, onReject }: { item: Extract<TranscriptItem, { kind: "tool" }> } & Omit<Props, "onSend">) {
  const proposal = item.proposalId ? session.proposals.find((p) => p.id === item.proposalId) : undefined;
  const blocked = proposal?.status === "pending" ? blockedReason(session, proposal) : undefined;
  return (
    <div className={`tool-line ${item.ok ? "tool-ok" : "tool-refused"}`}>
      <span className="tool-mark" aria-hidden>{item.ok ? "✓" : "✕"}</span>
      <span className="tool-name">{item.name}</span>
      <span className="tool-summary">· {item.ok ? item.summary : "refused"}</span>
      {item.ok && proposal?.status === "pending" && (
        <span className="tool-buttons">
          <button type="button" className="accept" disabled={busy || !!blocked} title={blocked} onClick={() => onAccept(proposal.id)}>
            Accept
          </button>
          <button type="button" disabled={busy} onClick={() => onReject(proposal.id)}>
            Reject
          </button>
        </span>
      )}
      {item.ok && proposal && proposal.status !== "pending" && (
        <span className={`tool-status status-${proposal.status}`} title={proposal.note}>
          {STATUS[proposal.status]}
          {proposal.note ? ` · ${proposal.note}` : ""}
        </span>
      )}
      {!item.ok && (
        <details className="tool-why">
          <summary>why</summary>
          <div>
            <div className="muted">{item.summary}</div>
            {item.reason}
          </div>
        </details>
      )}
    </div>
  );
}

export function Chat({ session, busy, onSend, onAccept, onReject }: Props) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: scrollIntoView() returns a Promise in current Chrome, and an effect
  // must return nothing or a cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [session.transcript.length, busy]);

  const send = () => {
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <section className="chat" aria-label="Chat">
      <div className="chat-log">
        {session.transcript.length === 0 && <p className="muted chat-empty">Say what's on your mind. The coach can propose cards from your words; nothing reaches the map until you accept it.</p>}
        {session.transcript.map((item, i) =>
          item.kind === "tool" ? (
            <ToolLine key={i} item={item} session={session} busy={busy} onAccept={onAccept} onReject={onReject} />
          ) : (
            <div key={i} className={`msg msg-${item.kind}`}>
              {item.text}
            </div>
          ),
        )}
        {busy && <div className="msg msg-notice">The coach is thinking…</div>}
        <div ref={end} />
      </div>
      <div className="composer">
        <textarea
          aria-label="Message"
          placeholder="Say what's on your mind…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="send" disabled={busy || !text.trim()} onClick={send}>
          Send
        </button>
      </div>
      <div className="hint muted">Enter to send · Shift+Enter for a new line</div>
    </section>
  );
}
