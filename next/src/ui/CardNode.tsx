import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { provenanceLabel, structureLabel } from "../state/labels";
import type { Card } from "../state/types";

export interface CardNodeData extends Record<string, unknown> {
  card: Card;
  hasChildren: boolean;
  /** Put the caret in this card now (a card just made with "+ Card"). */
  editing: boolean;
  readOnly: boolean;
  onFinishEdit: (id: string, text: string | null) => void;
  onDelete: (id: string) => void;
  onTakeOut: (id: string) => void;
}

export type CardFlowNode = Node<CardNodeData, "card">;

/** The number the writer sees for a card: c3 is card 3. */
export function cardNumber(id: string): string {
  return id.replace(/^c/, "");
}

/**
 * One card. Its text is the edit box: click into it and type, as in any text field.
 * The card is as tall as its text, so nothing scrolls inside it. Drag a card by its top
 * row or edge. A card with children is drawn as a box that holds them (visual nesting).
 */
export function CardNode({ data }: NodeProps<CardFlowNode>) {
  const { card, editing, readOnly } = data;
  const [text, setText] = useState(card.text);
  const [focused, setFocused] = useState(false);
  const cancelled = useRef(false);
  const box = useRef<HTMLTextAreaElement>(null);

  // Show changes made elsewhere (undo, the coach's turn), but never under the writer's caret.
  useEffect(() => {
    if (!focused) setText(card.text);
  }, [card.text, focused]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // React Flow shows a new node only once it's measured, so focusing at once can miss;
  // try again shortly after, or typing goes to whatever button still has focus.
  useEffect(() => {
    if (!editing) return;
    const timers = [0, 50, 150].map((ms) => setTimeout(() => box.current?.focus(), ms));
    return () => timers.forEach(clearTimeout);
  }, [editing]);

  const badges = [
    provenanceLabel(card.provenance),
    card.parentId && structureLabel(card.parentProvenance) ? "Nesting AI suggested" : null,
  ].filter((b): b is string => !!b);

  return (
    <div className={`card${data.hasChildren ? " card-parent" : ""}${card.provenance.kind === "ai_suggested" ? " card-ai" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="card-head">
        <span className="card-num" title={`Card ${cardNumber(card.id)}`}>{cardNumber(card.id)}</span>
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
      <textarea
        ref={box}
        className="card-text nodrag"
        rows={1}
        aria-label={`Card ${cardNumber(card.id)}`}
        placeholder="Write here"
        value={text}
        readOnly={readOnly}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => {
          cancelled.current = false;
          setFocused(true);
        }}
        // Saved when the writer clicks away (one undo step per edit), or with Enter.
        onBlur={() => {
          setFocused(false);
          data.onFinishEdit(card.id, cancelled.current || text === card.text ? null : text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            setText(card.text);
            e.currentTarget.blur();
          }
        }}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
