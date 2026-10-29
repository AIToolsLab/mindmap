import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { provenanceLabel, structureLabel } from "../state/labels";
import type { Card } from "../state/types";

export interface CardNodeData extends Record<string, unknown> {
  card: Card;
  hasChildren: boolean;
  editing: boolean;
  readOnly: boolean;
  onStartEdit: (id: string) => void;
  onFinishEdit: (id: string, text: string | null) => void;
  onDelete: (id: string) => void;
  onTakeOut: (id: string) => void;
}

export type CardFlowNode = Node<CardNodeData, "card">;

/** One card. A card with children is drawn as a box that holds them (visual nesting). */
export function CardNode({ data }: NodeProps<CardFlowNode>) {
  const { card, editing, readOnly } = data;
  const [text, setText] = useState(card.text);
  const cancelled = useRef(false);
  const editor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setText(card.text);
      cancelled.current = false;
    }
  }, [editing, card.text]);

  // React Flow mounts a new node hidden until it's measured, so `autoFocus` alone misses;
  // focus once it's shown, or typing goes to whatever button still has focus.
  useEffect(() => {
    if (!editing) return;
    const timers = [0, 50, 150].map((ms) => setTimeout(() => editor.current?.focus(), ms));
    return () => timers.forEach(clearTimeout);
  }, [editing]);

  const badges = [
    provenanceLabel(card.provenance),
    card.parentId && structureLabel(card.parentProvenance) ? "Nesting AI suggested" : null,
  ].filter((b): b is string => !!b);

  const finish = () => data.onFinishEdit(card.id, cancelled.current || text === card.text ? null : text);

  return (
    <div className={`card${data.hasChildren ? " card-parent" : ""}${card.provenance.kind === "ai_suggested" ? " card-ai" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="card-head">
        {badges.map((b) => (
          <span key={b} className="badge">{b}</span>
        ))}
        {!readOnly && (
          <span className="card-actions">
            {card.parentId && (
              <button type="button" className="nodrag" title="Take this card out of the card it's in" onClick={() => data.onTakeOut(card.id)}>
                Out
              </button>
            )}
            <button type="button" className="nodrag" aria-label="Delete card" title="Delete card" onClick={() => data.onDelete(card.id)}>
              ✕
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <textarea
          ref={editor}
          className="card-editor nodrag nowheel"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <div className="card-text" title={readOnly ? undefined : "Double-click to edit"} onDoubleClick={() => !readOnly && data.onStartEdit(card.id)}>
          {card.text || <em className="muted">Double-click to write</em>}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
