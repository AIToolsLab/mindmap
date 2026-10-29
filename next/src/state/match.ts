import type { Level, WriterRecord } from "./types";

/**
 * The matching rule every handler uses (spec §5): a mechanical comparison, never an
 * interpretation. Unicode NFC, lower-case, curly quotes treated as straight, and
 * whitespace runs collapsed to one space.
 */
export function norm(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Index of `piece` inside `haystack` (both normalized), starting and ending on word
 * boundaries so a piece can't begin or end mid-word ("ike x" inside "like x").
 * -1 when absent.
 */
export function findOnWordBoundary(haystack: string, piece: string, from = 0): number {
  if (!piece) return -1;
  let at = haystack.indexOf(piece, from);
  while (at !== -1) {
    const before = at === 0 ? "" : haystack[at - 1]!;
    const after = haystack[at + piece.length] ?? "";
    const startsWord = !WORD_CHAR.test(piece[0]!) || !WORD_CHAR.test(before);
    const endsWord = !WORD_CHAR.test(piece[piece.length - 1]!) || !WORD_CHAR.test(after);
    if (startsWord && endsWord) return at;
    at = haystack.indexOf(piece, at + 1);
  }
  return -1;
}

/** One place a piece can come from: a writer chat message or the current draft. */
export interface Source {
  kind: "chat" | "draft";
  /** Position in the writer's message list (chat only), for adjacency checks. */
  index: number;
  turn: number;
  text: string;
}

/** The writer's words a level allows quoting from (spec §3). */
export function eligibleSources(record: WriterRecord, level: Level): Source[] {
  const chat: Source[] = record.messages.map((m, index) => ({ kind: "chat", index, turn: m.turn, text: norm(m.text) }));
  if (level >= 1 && record.draft.trim()) chat.push({ kind: "draft", index: -1, turn: -1, text: norm(record.draft) });
  return chat;
}

/** Every source containing the piece, most recent chat message first, draft last. */
export function sourcesContaining(piece: string, sources: Source[]): Source[] {
  const p = norm(piece);
  return sources
    .filter((s) => findOnWordBoundary(s.text, p) !== -1)
    .sort((a, b) => (a.kind === b.kind ? b.index - a.index : a.kind === "chat" ? -1 : 1));
}

/** A piece is usable only if it has at least one letter or number after normalizing. */
export function hasWords(piece: string): boolean {
  return WORD_CHAR.test(norm(piece));
}
