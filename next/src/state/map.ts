import { reconcileAdoption } from "./adoption";
import type { Card, Link, MapState, Proposal, Session } from "./types";

const UNDO_LIMIT = 50;

/** Next free spot in a simple grid, so new cards don't stack on each other. */
function nextPosition(map: MapState): { x: number; y: number } {
  const n = map.cards.length;
  return { x: 40 + (n % 3) * 260, y: 40 + Math.floor(n / 3) * 140 };
}

function withUndo(session: Session): Session {
  return { ...session, undo: [...session.undo, session.map].slice(-UNDO_LIMIT) };
}

export function findCard(map: MapState, id: string): Card | undefined {
  return map.cards.find((c) => c.id === id);
}

/** The text a model reference points at: an existing card, or a card proposal still pending. */
export function refText(session: Session, ref: string): string | undefined {
  const card = findCard(session.map, ref);
  if (card) return card.text;
  const p = session.proposals.find((x) => x.id === ref);
  return p && p.kind === "card" && p.status === "pending" ? p.text : undefined;
}

/** True if making `parent` the parent of `child` would create a loop. */
export function wouldCycle(map: MapState, child: string, parent: string): boolean {
  let at: string | null = parent;
  const seen = new Set<string>();
  while (at && !seen.has(at)) {
    if (at === child) return true;
    seen.add(at);
    at = findCard(map, at)?.parentId ?? null;
  }
  return false;
}

export function hasLink(map: MapState, from: string, to: string): boolean {
  return map.links.some((l) => l.from === from && l.to === to);
}

// ---- Writer's own map actions (immediate: they are the writer's explicit acts) ----

export function addCard(session: Session, text: string): Session {
  const s = withUndo(session);
  const id = `c${s.counters.card + 1}`;
  const card: Card = { id, text, parentId: null, provenance: { kind: "user" }, ...nextPosition(s.map) };
  const next = { ...s, counters: { ...s.counters, card: s.counters.card + 1 }, map: { ...s.map, cards: [...s.map.cards, card] } };
  return reconcileAdoption(next, new Set([id]));
}

export function editCard(session: Session, id: string, text: string): Session {
  const s = withUndo(session);
  const cards = s.map.cards.map((c) => (c.id === id ? { ...c, text } : c));
  return reconcileAdoption({ ...s, map: { ...s.map, cards } }, new Set([id]));
}

export function moveCard(session: Session, id: string, x: number, y: number): Session {
  // Dragging isn't an undo step: it changes layout, not ideas.
  return { ...session, map: { ...session.map, cards: session.map.cards.map((c) => (c.id === id ? { ...c, x, y } : c)) } };
}

export function deleteCard(session: Session, id: string): Session {
  const s = withUndo(session);
  const cards = s.map.cards.filter((c) => c.id !== id).map((c) => (c.parentId === id ? { ...c, parentId: null } : c));
  const links = s.map.links.filter((l) => l.from !== id && l.to !== id);
  return { ...s, map: { cards, links } };
}

export function setParent(session: Session, child: string, parent: string | null): Session {
  if (parent && (child === parent || wouldCycle(session.map, child, parent))) return session;
  const s = withUndo(session);
  return { ...s, map: { ...s.map, cards: s.map.cards.map((c) => (c.id === child ? { ...c, parentId: parent } : c)) } };
}

export function addLink(session: Session, from: string, to: string, label: string): Session {
  if (from === to || hasLink(session.map, from, to)) return session;
  const s = withUndo(session);
  const link: Link = { id: `l${s.counters.link + 1}`, from, to, label, provenance: { kind: "user" } };
  return { ...s, counters: { ...s.counters, link: s.counters.link + 1 }, map: { ...s.map, links: [...s.map.links, link] } };
}

export function editLinkLabel(session: Session, id: string, label: string): Session {
  const s = withUndo(session);
  return { ...s, map: { ...s.map, links: s.map.links.map((l) => (l.id === id ? { ...l, label } : l)) } };
}

export function deleteLink(session: Session, id: string): Session {
  const s = withUndo(session);
  return { ...s, map: { ...s.map, links: s.map.links.filter((l) => l.id !== id) } };
}

export function undo(session: Session): Session {
  const prev = session.undo[session.undo.length - 1];
  if (!prev) return session;
  return { ...session, map: prev, undo: session.undo.slice(0, -1) };
}

// ---- Proposals: only the writer's click changes the map ----

/** A model reference as a card id: an existing card, or the card an accepted card proposal became. */
function resolve(session: Session, ref: string): string | undefined {
  if (findCard(session.map, ref)) return ref;
  const p = session.proposals.find((x) => x.id === ref);
  const cardId = p && (p.kind === "card" || p.kind === "suggestion") ? p.cardId : undefined;
  return cardId && findCard(session.map, cardId) ? cardId : undefined;
}

/** Why a link or nest proposal can't be accepted yet, or undefined if it can. */
export function blockedReason(session: Session, p: Proposal): string | undefined {
  if (p.kind !== "link" && p.kind !== "nest") return undefined;
  const refs = p.kind === "link" ? [p.from, p.to] : [p.child, p.parent];
  for (const ref of refs) {
    if (resolve(session, ref)) continue;
    const pending = session.proposals.find((x) => x.id === ref && x.status === "pending");
    return pending ? "Accept the card it connects first." : "A card it connects is gone.";
  }
  return undefined;
}

function setStatus(session: Session, id: string, status: Proposal["status"], note?: string): Session {
  return { ...session, proposals: session.proposals.map((p) => (p.id === id ? { ...p, status, note } : p)) };
}

function describe(p: Proposal): string {
  return p.kind === "card" || p.kind === "suggestion" ? `${p.kind} "${p.text}"` : p.kind;
}

export function acceptProposal(session: Session, id: string): Session {
  const p = session.proposals.find((x) => x.id === id);
  if (!p || p.status !== "pending" || blockedReason(session, p)) return session;
  let s = withUndo(session);

  if (p.kind === "card" || p.kind === "suggestion") {
    const cardId = `c${s.counters.card + 1}`;
    const card: Card = {
      id: cardId,
      text: p.text,
      parentId: null,
      provenance: p.kind === "card" ? p.provenance : { kind: "ai_suggested" },
      ...nextPosition(s.map),
    };
    s = {
      ...s,
      counters: { ...s.counters, card: s.counters.card + 1 },
      map: { ...s.map, cards: [...s.map.cards, card] },
      proposals: s.proposals.map((x) => (x.id === p.id ? { ...x, cardId } : x)),
    };
  } else if (p.kind === "link") {
    const from = resolve(s, p.from)!;
    const to = resolve(s, p.to)!;
    if (from === to || hasLink(s.map, from, to)) return setStatus(session, id, "dropped", "That link is already on the map.");
    const link: Link = { id: `l${s.counters.link + 1}`, from, to, label: p.label, provenance: p.provenance };
    s = { ...s, counters: { ...s.counters, link: s.counters.link + 1 }, map: { ...s.map, links: [...s.map.links, link] } };
  } else {
    const child = resolve(s, p.child)!;
    const parent = resolve(s, p.parent)!;
    if (child === parent || wouldCycle(s.map, child, parent)) return setStatus(session, id, "dropped", "The map has changed so this nesting would make a loop.");
    s = { ...s, map: { ...s.map, cards: s.map.cards.map((c) => (c.id === child ? { ...c, parentId: parent } : c)) } };
  }
  s = setStatus(s, id, "accepted");
  return { ...s, decisions: [...s.decisions, `accepted ${p.id} (${describe(p)})`] };
}

export function rejectProposal(session: Session, id: string): Session {
  const p = session.proposals.find((x) => x.id === id);
  if (!p || p.status !== "pending") return session;
  let s = setStatus(session, id, "rejected");
  // A link or nest that named this pending card can no longer happen.
  for (const other of s.proposals) {
    if (other.status !== "pending") continue;
    const refs = other.kind === "link" ? [other.from, other.to] : other.kind === "nest" ? [other.child, other.parent] : [];
    if (refs.includes(id)) s = setStatus(s, other.id, "dropped", "Its card was rejected.");
  }
  return { ...s, decisions: [...s.decisions, `rejected ${p.id} (${describe(p)})`] };
}
