import { cardSourceForModel, structureLabel } from "../state/labels";
import type { HistoryItem, Level, Proposal, Session } from "../state/types";

/**
 * What the model sees on every call (spec §7). Stateless: everything is sent each
 * time, static first so the provider's prompt cache covers the repeated part:
 * instructions and tools (passed separately), then the conversation so far, then the
 * current state rebuilt fresh, then the writer's new message.
 */

const LEVEL_RULES: Record<Level, string> = {
  0: [
    "Level L0. You can read the writer's chat messages and their draft.",
    "Cards: only the writer's own words from their chat messages (any earlier message counts), not the draft.",
    "Links and nesting: only when the writer has stated them in their own words.",
    "Your own ideas: suggest_idea exists but is refused at L0. If you have an idea, help the writer find it themselves.",
  ].join("\n"),
  1: [
    "Level L1. You can read the writer's chat messages and their draft.",
    "Cards: only the writer's own words, from their chat messages or their draft.",
    "Links and nesting: only when the writer has stated them in their own words.",
    "Your own ideas: suggest_idea exists but is refused at L1. If you have an idea, help the writer find it themselves.",
  ].join("\n"),
  2: [
    "Level L2. You can read the writer's chat messages and their draft.",
    "Cards: the writer's own words, from their chat messages or their draft.",
    "Links and nesting: you may propose them freely; they are shown as AI suggested.",
    "Your own ideas: you may offer them with suggest_idea; they are shown as AI suggestions.",
  ].join("\n"),
};

export const ATTEMPT_BUDGET = 3;

export function instructions(level: Level): string {
  return [
    "You are a thinking coach for a writer working out their ideas. The writer owns the map: you help them think, and everything you put on the map is a proposal they accept or reject.",
    "",
    "Use the tools to propose map changes. Each tool checks its rule when it runs. If a tool refuses, you get the reason; decide for yourself what to do next: try differently, ask the writer, or tell them plainly what you tried and why it didn't work.",
    `Up to ${ATTEMPT_BUDGET} refused attempts are allowed per turn. Every refusal tells you how many are left. After that, reply in words only.`,
    "",
    LEVEL_RULES[level],
    "",
    "If the writer declined something, don't raise it again.",
    "Reply to the writer in plain, short messages.",
  ].join("\n");
}

/** How many recent writer turns the model sees (spec §7.3). The writer record keeps all of them. */
export const TURNS_SEEN = 40;

/**
 * The part of the conversation the model sees: the last `TURNS_SEEN` writer turns.
 * Cuts only where a writer message starts, so a tool call is never separated from its
 * result. `hidden` counts the writer messages left out.
 */
export function visibleHistory(history: HistoryItem[], turnsSeen = TURNS_SEEN): { items: HistoryItem[]; hidden: number } {
  const starts = history.flatMap((h, i) => ("role" in h && h.role === "user" ? [i] : []));
  if (starts.length <= turnsSeen) return { items: history, hidden: 0 };
  const cut = starts[starts.length - turnsSeen]!;
  return { items: history.slice(cut), hidden: starts.length - turnsSeen };
}

function proposalLine(p: Proposal): string {
  if (p.kind === "card") return `${p.id} card "${p.text}"`;
  if (p.kind === "suggestion") return `${p.id} suggestion "${p.text}"`;
  if (p.kind === "link") return `${p.id} link ${p.from} → "${p.label}" → ${p.to}`;
  return `${p.id} nest ${p.child} under ${p.parent}`;
}

/** Part 4 of what the model sees: the current state, rebuilt every call. */
export function stateBlock(session: Session, attemptsLeft: number, hiddenMessages = 0): string {
  const cards = session.map.cards.map((c) => {
    const nest = c.parentId ? ` under ${c.parentId}${structureLabel(c.parentProvenance) ? " (nesting AI suggested)" : ""}` : "";
    return `  ${c.id} "${c.text}"${nest} (${cardSourceForModel(c)})`;
  });
  const links = session.map.links.map((l) => `  ${l.from} → "${l.label}" → ${l.to}${structureLabel(l.provenance) ? " (AI suggested)" : ""}`);
  const pending = session.proposals.filter((p) => p.status === "pending").map((p) => `  ${proposalLine(p)}`);
  // Kept for the whole session, so a declined idea isn't raised again (decisions below
  // only cover the latest ones).
  const declined = session.proposals.filter((p) => p.status === "rejected").map((p) => `  ${proposalLine(p)}`);
  return [
    "[Current state, rebuilt for this call. Not from the writer.]",
    ...(hiddenMessages ? [`(${hiddenMessages} earlier writer messages are not shown above. Your tools can still quote them.)`] : []),
    "Map cards:",
    ...(cards.length ? cards : ["  (none)"]),
    "Map links:",
    ...(links.length ? links : ["  (none)"]),
    "Pending proposals (waiting for the writer):",
    ...(pending.length ? pending : ["  (none)"]),
    "Writer decisions since your last turn:",
    ...(session.decisions.length ? session.decisions.map((d) => `  ${d}`) : ["  (none)"]),
    "Declined by the writer earlier (don't propose these again):",
    ...(declined.length ? declined : ["  (none)"]),
    "Draft:",
    session.record.draft.trim() ? session.record.draft : "  (empty)",
    `Level: L${session.level} · refused attempts left this turn: ${attemptsLeft}`,
  ].join("\n");
}
