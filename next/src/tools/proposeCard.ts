import { eligibleSources, hasWords, norm, sourcesContaining } from "../state/match";
import type { PieceSource, Provenance } from "../state/types";
import { quote, refuse, stringList, obj, whereFrom, type Tool } from "./common";

/** Spec §5.1. The model writes the pieces; the handler checks each against the writer's words. */
export const proposeCard: Tool = {
  name: "propose_card",
  description: (level) =>
    [
      "Propose one card for the writer's map, made only of the writer's own words.",
      "`pieces` are joined in your order with a single space to form the card text; nothing else is added.",
      level === 0
        ? "Each piece must appear word for word in one of the writer's chat messages (any earlier message counts). The draft can't be quoted at this level."
        : "Each piece must appear word for word in one of the writer's chat messages or in their current draft.",
      "Partial sentences are fine. The writer sees the card and accepts or rejects it.",
    ].join(" "),
  parameters: {
    type: "object",
    properties: { pieces: { type: "array", items: { type: "string" } } },
    required: ["pieces"],
    additionalProperties: false,
  },
  handle(args, ctx) {
    const pieces = stringList(obj(args)?.pieces);
    if (!pieces || pieces.length === 0) return refuse("`pieces` must be a non-empty list of strings.", "invalid arguments");
    const text = pieces.join(" ").trim();
    // Not shortened: the chat shows this and the writer must see the whole card to decide.
    const summary = `"${text}"`;

    if (pieces.some((p) => !hasWords(p))) return refuse("Every piece needs at least one word.", summary);

    const turns = new Set<number>();
    let fromDraft = false;
    const pieceSources: PieceSource[] = [];
    if (ctx.checks) {
      const sources = eligibleSources(ctx.session.record, ctx.level);
      for (const piece of pieces) {
        const all = sourcesContaining(piece, sources);
        const found = all[0];
        if (!found) {
          const inDraft = ctx.level === 0 && sourcesContaining(piece, eligibleSources(ctx.session.record, 1)).some((s) => s.kind === "draft");
          return refuse(
            inDraft
              ? `${quote(piece)} is in your draft, but at L0 cards can only use your chat messages.`
              : `${quote(piece)} is not in ${whereFrom(ctx.level)}.`,
            summary,
          );
        }
        if (found.kind === "draft") fromDraft = true;
        else turns.add(found.turn);
        // Spec §5.1: record the most recent match, and every match.
        pieceSources.push({
          piece,
          from: found.kind,
          turn: found.kind === "chat" ? found.turn : null,
          allTurns: [...new Set(all.filter((x) => x.kind === "chat").map((x) => x.turn))],
          inDraft: all.some((x) => x.kind === "draft"),
        });
      }
    }

    const key = norm(text);
    if (ctx.session.map.cards.some((c) => norm(c.text) === key)) return refuse(`A card with the text ${summary} is already on the map.`, summary);
    if (ctx.session.proposals.some((p) => p.kind === "card" && p.status === "pending" && norm(p.text) === key)) {
      return refuse(`A card with the text ${summary} is already proposed.`, summary);
    }

    const provenance: Provenance = fromDraft ? { kind: "draft" } : turns.size > 1 ? { kind: "combined", messages: turns.size } : { kind: "user" };
    return { ok: true, summary, proposal: { id: ctx.nextProposalId(), status: "pending", kind: "card", text, provenance, sources: pieceSources } };
  },
};
