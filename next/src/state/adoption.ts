import { norm } from "./match";
import type { Card, Session } from "./types";

/**
 * Suggestion adoption, behind `settings.suggestionAdoption` (spec §2).
 *
 * A card the writer creates or edits counts as adopted from an L2 suggestion when at
 * least half of its words sit inside runs of three or more words, in the same order,
 * that also appear in that suggestion. Cards shorter than three words count only if
 * the whole card appears in the suggestion. No word list: common words rarely form a
 * shared three-word run on their own. If runs prove too loose or too strict, a
 * common-word list is the fallback the spec notes.
 *
 * As before: only a card whose text just changed can newly adopt, and later edits
 * update the current and peak overlap without clearing the original influence.
 */
export const ADOPTION_THRESHOLD = 0.5;
export const MIN_RUN = 3;

function words(text: string): string[] {
  return norm(text)
    .split(" ")
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

/** Fraction of the card's words covered by runs it shares with the suggestion. */
export function runOverlap(cardText: string, suggestionText: string): number {
  const card = words(cardText);
  const suggestion = words(suggestionText);
  if (!card.length || !suggestion.length) return 0;
  const run = Math.min(MIN_RUN, card.length);
  const runs = new Set<string>();
  for (let i = 0; i + run <= suggestion.length; i++) runs.add(suggestion.slice(i, i + run).join(" "));
  const covered = new Array<boolean>(card.length).fill(false);
  for (let i = 0; i + run <= card.length; i++) {
    if (runs.has(card.slice(i, i + run).join(" "))) for (let j = i; j < i + run; j++) covered[j] = true;
  }
  return covered.filter(Boolean).length / card.length;
}

function best(cardText: string, session: Session): { id?: string; overlap: number } {
  let top: { id?: string; overlap: number } = { overlap: 0 };
  for (const p of session.proposals) {
    // Every suggestion the writer has seen in the chat counts, whatever they decided.
    if (p.kind !== "suggestion" || p.status === "dropped") continue;
    const overlap = runOverlap(cardText, p.text);
    if (overlap > top.overlap) top = { id: p.id, overlap };
  }
  return top;
}

function reconcileCard(card: Card, session: Session, textChanged: boolean): Card {
  const match = best(card.text, session);
  const prev = card.adoption;
  if (!prev && (!textChanged || !match.id || match.overlap < ADOPTION_THRESHOLD)) return card;
  const adoption = prev
    ? { ...prev, currentOverlap: match.overlap, peakOverlap: Math.max(prev.peakOverlap, match.overlap) }
    : { adoptedFrom: match.id!, currentOverlap: match.overlap, peakOverlap: match.overlap };
  return { ...card, provenance: { kind: "ai_suggested" }, adoption };
}

/** Run after any writer map change. `changed` holds the cards whose text just changed. */
export function reconcileAdoption(session: Session, changed: ReadonlySet<string>): Session {
  if (!session.settings.suggestionAdoption) return session;
  const cards = session.map.cards.map((c) => reconcileCard(c, session, changed.has(c.id)));
  return { ...session, map: { ...session.map, cards } };
}
