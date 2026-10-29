import { hasLink, refText } from "../state/map";
import { obj, quote, refuse, stringList, type Tool } from "./common";
import { checkEvidence } from "./evidence";

/** Spec §5.2. */
export const proposeLink: Tool = {
  name: "propose_link",
  description: (level) =>
    [
      "Propose a labelled link from one card to another. Cards are referred to by id: an existing card (c3) or a card you proposed this turn (p5).",
      level === 2
        ? "At this level you may propose links freely; the label is your choice and the link is shown as AI suggested. `evidence` may be empty."
        : "At this level the writer must have stated the link themselves. `evidence` is one piece of the writer's words, or two pieces from two of their messages next to each other. Both cards' text must appear in the evidence, and the label must be words from the evidence that sit after the `from` card and before the `to` card.",
    ].join(" "),
  parameters: {
    type: "object",
    properties: {
      from_card: { type: "string" },
      to_card: { type: "string" },
      label: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
    },
    required: ["from_card", "to_card", "label", "evidence"],
    additionalProperties: false,
  },
  handle(args, ctx) {
    const a = obj(args);
    const from = typeof a?.from_card === "string" ? a.from_card : "";
    const to = typeof a?.to_card === "string" ? a.to_card : "";
    const label = typeof a?.label === "string" ? a.label.trim() : "";
    const evidence = stringList(a?.evidence) ?? [];
    const fromText = refText(ctx.session, from);
    const toText = refText(ctx.session, to);
    const summary = `${fromText ? quote(fromText) : from} → ${label || "(no label)"} → ${toText ? quote(toText) : to}`;

    if (!fromText) return refuse(`There is no card or pending card proposal "${from}".`, summary);
    if (!toText) return refuse(`There is no card or pending card proposal "${to}".`, summary);
    if (from === to) return refuse("A link needs two different cards.", summary);
    if (hasLink(ctx.session.map, from, to) || ctx.session.proposals.some((p) => p.kind === "link" && p.status === "pending" && p.from === from && p.to === to)) {
      return refuse("That link is already on the map or already proposed.", summary);
    }

    const free = ctx.level === 2 || !ctx.checks;
    if (!free) {
      const reason = checkEvidence(evidence, { fromText, toText }, label, ctx.session.record, ctx.level);
      if (reason) return refuse(reason, summary);
    }

    return {
      ok: true,
      summary,
      proposal: {
        id: ctx.nextProposalId(),
        status: "pending",
        kind: "link",
        from,
        to,
        label,
        provenance: free ? { kind: "ai_suggested" } : { kind: "user" },
      },
    };
  },
};
