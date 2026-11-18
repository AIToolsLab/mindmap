import { Handle, Position, useReactFlow, useStore, type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { provenanceLabel, structureLabel } from "../state/labels";
import { CARD_W_DEFAULT, CARD_W_MAX, CARD_W_MIN } from "../state/map";
import type { Card } from "../state/types";
import { CARD_W, childrenWidth, PARENT_MIN_W } from "./flow";

export interface CardNodeData extends Record<string, unknown> {
  card: Card;
  hasChildren: boolean;
  /** Put the caret in this card now (a card just made with "+ Card"). */
  editing: boolean;
  readOnly: boolean;
  onFinishEdit: (id: string, text: string | null) => void;
  onDelete: (id: string) => void;
  onTakeOut: (id: string) => void;
  /** End of a resize: the width the writer dragged the card to. */
  onResize: (id: string, width: number) => void;
}

/**
 * The grip in a card's bottom-right corner: drag it to change the card's width, or use
 * the arrow keys. Double-click goes back to the default width. `shown` is the width on
 * screen and `min` the narrowest the card can be (a parent needs room for its children),
 * so the preview, the keys and the announced value all match what's drawn.
 */
function CardResizer({ card, shown, min, onResize, onLive }: { card: Card; shown: number; min: number; onResize: (id: string, width: number) => void; onLive: (width: number | null) => void }) {
  const flow = useReactFlow();
  const drag = useRef<{ x: number; width: number; zoom: number; last: number } | null>(null);
  // Key presses that come faster than a redraw build on each other, not on a stale `shown`.
  const keyed = useRef<number | null>(null);
  useEffect(() => {
    keyed.current = null;
  }, [shown]);
  const clamp = (w: number) => Math.max(min, Math.min(CARD_W_MAX, w));

  const start = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width: shown, zoom: flow.getZoom() || 1, last: shown };
    document.body.classList.add("resizing-card");
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.last = clamp(d.width + (e.clientX - d.x) / d.zoom);
    onLive(d.last);
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.classList.remove("resizing-card");
    onLive(null);
    onResize(card.id, d.last);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    keyed.current = clamp((keyed.current ?? shown) + (e.key === "ArrowRight" ? 20 : -20));
    onResize(card.id, keyed.current);
  };

  return (
    <div
      className="card-resizer nodrag nopan"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize card ${cardNumber(card.id)}`}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, CARD_W_MAX)}
      aria-valuenow={Math.round(shown)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={key}
      onDoubleClick={() => onResize(card.id, CARD_W_DEFAULT)}
    />
  );
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
  /** A parent's title is longer than the lines it shows over its children. */
  const [clipped, setClipped] = useState(false);
  const cancelled = useRef(false);
  const box = useRef<HTMLTextAreaElement>(null);
  /** The width shown while the writer drags the resize grip. */
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  // A parent fills the box the layout gives it, which already includes its width.
  const width = liveWidth ?? (data.hasChildren ? undefined : card.w);
  // The room this card's children take up (0 for a leaf), the same sum the layout uses.
  const childrenNeed = useStore(
    useCallback((s) => childrenWidth([...s.nodeLookup.values()].filter((n) => n.parentId === card.id)), [card.id]),
  );
  const min = Math.max(CARD_W_MIN, childrenNeed);
  const shown = liveWidth ?? Math.max(card.w ?? (data.hasChildren ? PARENT_MIN_W : CARD_W), childrenNeed);

  // Show changes made elsewhere (undo, the coach's turn), but never under the writer's caret.
  useEffect(() => {
    if (!focused) setText(card.text);
  }, [card.text, focused]);

  // The card is as tall as its text, which depends on its width too.
  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    setClipped(data.hasChildren && !focused && el.scrollHeight > el.clientHeight + 1);
  }, [focused, data.hasChildren]);
  useLayoutEffect(fit, [text, fit]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = el.clientWidth;
    const watch = new ResizeObserver(() => {
      if (el.clientWidth === last) return; // height changes come from fit() itself
      last = el.clientWidth;
      fit();
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [fit]);

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
    <div
      className={`card${data.hasChildren ? " card-parent" : ""}${card.provenance.kind === "ai_suggested" ? " card-ai" : ""}`}
      style={width ? { width } : undefined}
    >
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
        className={`card-text nodrag${clipped ? " clipped" : ""}`}
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
      {!readOnly && <CardResizer card={card} shown={shown} min={min} onResize={data.onResize} onLive={setLiveWidth} />}
    </div>
  );
}
