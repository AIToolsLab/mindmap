import type { Edge, Node } from "@xyflow/react";
import { structureLabel } from "../state/labels";
import type { MapState } from "../state/types";
import type { CardFlowNode, CardNodeData } from "./CardNode";

/**
 * Turning the map into React Flow nodes and edges. Pure functions, so the nesting
 * layout is testable without a browser. A nested card is a child node (positions are
 * parent-relative); a parent card is sized to hold its children.
 */

export const CARD_W = 220;
export const CARD_H = 96;
const PAD = 16;

export function depthOf(map: MapState, id: string): number {
  let d = 0;
  const seen = new Set<string>();
  let at = map.cards.find((c) => c.id === id)?.parentId ?? null;
  while (at && !seen.has(at)) {
    seen.add(at);
    d++;
    at = map.cards.find((c) => c.id === at)?.parentId ?? null;
  }
  return d;
}

/** True if `id` sits somewhere inside `ancestor`. */
export function isInside(map: MapState, id: string, ancestor: string): boolean {
  const seen = new Set<string>();
  let at = map.cards.find((c) => c.id === id)?.parentId ?? null;
  while (at && !seen.has(at)) {
    if (at === ancestor) return true;
    seen.add(at);
    at = map.cards.find((c) => c.id === at)?.parentId ?? null;
  }
  return false;
}

// Pick, not Omit: CardNodeData has an index signature, which Omit would flatten.
type Callbacks = Pick<CardNodeData, "readOnly" | "onStartEdit" | "onFinishEdit" | "onDelete" | "onTakeOut">;

/**
 * Nodes for the map, parents before children (React Flow requires it). Keeps each
 * node's measured size and selection from the previous render.
 */
export function buildNodes(map: MapState, prev: Node[], editId: string | null, callbacks: Callbacks): CardFlowNode[] {
  const old = new Map(prev.map((n) => [n.id, n]));
  const parents = new Set(map.cards.flatMap((c) => (c.parentId ? [c.parentId] : [])));
  const ordered = [...map.cards].sort((a, b) => depthOf(map, a.id) - depthOf(map, b.id));
  const nodes: CardFlowNode[] = ordered.map((card) => {
    const before = old.get(card.id);
    return {
      id: card.id,
      type: "card",
      position: { x: card.x, y: card.y },
      ...(card.parentId && map.cards.some((c) => c.id === card.parentId) ? { parentId: card.parentId } : {}),
      draggable: !callbacks.readOnly,
      ...(before?.selected ? { selected: true } : {}),
      ...(before?.measured ? { measured: before.measured } : {}),
      data: { ...callbacks, card, hasChildren: parents.has(card.id), editing: card.id === editId },
    };
  });
  return sizeParents(nodes);
}

/**
 * Give every parent card a size that holds its children, innermost parents first.
 * Leaf cards keep their natural (measured) size.
 */
export function sizeParents<T extends Node>(nodes: T[]): T[] {
  const kids = new Map<string, T[]>();
  for (const n of nodes) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  if (!kids.size) return nodes.map((n) => (n.style?.width ? { ...n, style: undefined } : n));

  const depth = (n: T): number => {
    let d = 0;
    let at = n.parentId;
    while (at && d < 100) {
      d++;
      at = nodes.find((x) => x.id === at)?.parentId;
    }
    return d;
  };
  const sizes = new Map<string, { w: number; h: number }>();
  const sizeOf = (n: T) => sizes.get(n.id) ?? { w: n.measured?.width ?? CARD_W, h: n.measured?.height ?? CARD_H };
  const parentIds = [...kids.keys()].sort((a, b) => depth(nodes.find((n) => n.id === b)!) - depth(nodes.find((n) => n.id === a)!));
  for (const id of parentIds) {
    const children = kids.get(id)!;
    const w = Math.max(CARD_W + 2 * PAD, ...children.map((c) => c.position.x + sizeOf(c).w + PAD));
    const h = Math.max(CARD_H, ...children.map((c) => c.position.y + sizeOf(c).h + PAD));
    sizes.set(id, { w, h });
  }
  return nodes.map((n) => {
    const s = sizes.get(n.id);
    if (s) return n.style?.width === s.w && n.style?.height === s.h ? n : { ...n, style: { width: s.w, height: s.h } };
    return n.style?.width ? { ...n, style: undefined } : n;
  });
}

export function buildEdges(map: MapState, prev: Edge[]): Edge[] {
  const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
  const nested = new Set(map.cards.filter((c) => c.parentId).map((c) => c.id));
  return map.links.map((l) => {
    const ai = !!structureLabel(l.provenance);
    return {
      id: l.id,
      source: l.from,
      target: l.to,
      label: ai ? `${l.label} · AI suggested` : l.label,
      className: ai ? "edge-ai" : undefined,
      // Links draw under cards; one touching a nested card would be hidden by its parent's box.
      ...(nested.has(l.from) || nested.has(l.to) ? { zIndex: 1000 } : {}),
      ...(selected.has(l.id) ? { selected: true } : {}),
    };
  });
}
