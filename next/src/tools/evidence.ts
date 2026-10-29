import { eligibleSources, enclosingWords, findOnWordBoundary, hasWords, norm, sourcesContaining } from "../state/match";
import type { Level, WriterRecord } from "../state/types";
import { notFoundReason, quote } from "./common";

/**
 * The evidence rule for links and nesting at L0 and L1 (spec §5.2). Text comparisons
 * and message order only: it never decides what the words mean.
 *
 * 1. One or two pieces, each word for word in the writer's eligible text.
 * 2. Two pieces must come from two adjacent writer messages, in order.
 * 3. Both cards' text appears inside the evidence.
 * 4. With a label: it appears after the `from` card's text and before the `to` card's.
 *
 * Returns a refusal reason, or undefined when the evidence holds.
 */
export function checkEvidence(
  evidence: string[],
  ends: { fromText: string; toText: string },
  label: string | null,
  record: WriterRecord,
  level: Level,
): string | undefined {
  if (evidence.length < 1 || evidence.length > 2) return "`evidence` must be one or two pieces of the writer's words.";
  if (evidence.some((e) => !hasWords(e))) return "Every evidence piece needs at least one word.";

  const sources = eligibleSources(record, level);
  const found = evidence.map((piece) => sourcesContaining(piece, sources));
  for (let i = 0; i < evidence.length; i++) {
    if (!found[i]!.length) return notFoundReason(evidence[i]!, level, enclosingWords(evidence[i]!, sources));
  }

  if (evidence.length === 2) {
    const first = found[0]!.filter((s) => s.kind === "chat").map((s) => s.index);
    const second = new Set(found[1]!.filter((s) => s.kind === "chat").map((s) => s.index));
    if (!first.some((i) => second.has(i + 1))) {
      return "The two evidence pieces must come from two of your messages next to each other, in that order.";
    }
  }

  const text = norm(evidence.join(" "));
  const from = norm(ends.fromText);
  const to = norm(ends.toText);
  const fromAt = findOnWordBoundary(text, from);
  if (fromAt === -1) return `The card ${quote(ends.fromText)} doesn't appear in the evidence.`;

  if (label === null) {
    if (findOnWordBoundary(text, to) === -1) return `The card ${quote(ends.toText)} doesn't appear in the evidence.`;
    return undefined;
  }

  const l = norm(label);
  if (!hasWords(l)) return "At this level a link's label must be the writer's own words from the evidence.";
  const labelAt = findOnWordBoundary(text, l, fromAt + from.length);
  if (labelAt === -1) return `The label ${quote(label)} doesn't appear in the evidence after ${quote(ends.fromText)}.`;
  if (findOnWordBoundary(text, to, labelAt + l.length) === -1) {
    return `The card ${quote(ends.toText)} doesn't appear in the evidence after the label ${quote(label)}.`;
  }
  return undefined;
}
