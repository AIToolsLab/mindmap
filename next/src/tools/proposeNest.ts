import { findCard, refText, wouldCycle } from "../state/map";
import { obj, quote, refuse, stringList, type Tool } from "./common";
import { checkEvidence } from "./evidence";

/** Spec §5.3. */
export const proposeNest: Tool = {
  name: "propose_nest",
  description: (level) =>
    [
      "Propose putting one card under another (child under parent). Cards are referred to by id: an existing card (c3) or a card proposal still waiting for the writer (p5).",
      level === 2
        ? "At this level you may propose nesting freely; it is shown as AI suggested. `evidence` may be empty."
        : "At this level the writer must have stated it themselves. `evidence` is one piece of the writer's words, or two pieces from two of their messages next to each other, and both cards' text must appear in it.",
    ].join(" "),
  parameters: {
    type: "object",
    properties: {
      child: { type: "string" },
      parent: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
    },
    required: ["child", "parent", "evidence"],
    additionalProperties: false,
  },
  handle(args, ctx) {
    const a = obj(args);
    const child = typeof a?.child === "string" ? a.child : "";
    const parent = typeof a?.parent === "string" ? a.parent : "";
    const evidence = stringList(a?.evidence) ?? [];
    const childText = refText(ctx.session, child);
    const parentText = refText(ctx.session, parent);
    const summary = `${childText ? quote(childText) : child} under ${parentText ? quote(parentText) : parent}`;

    if (!childText) return refuse(`There is no card or pending card proposal "${child}".`, summary);
    if (!parentText) return refuse(`There is no card or pending card proposal "${parent}".`, summary);
    if (child === parent) return refuse("A card can't be nested under itself.", summary);
    if (findCard(ctx.session.map, child)?.parentId === parent) return refuse("That card is already under that parent.", summary);
    if (wouldCycle(ctx.session.map, child, parent)) return refuse("That nesting would make a loop: the parent is already inside the child.", summary);
    if (ctx.session.proposals.some((p) => p.kind === "nest" && p.status === "pending" && p.child === child && p.parent === parent)) {
      return refuse("That nesting is already proposed.", summary);
    }

    const free = ctx.level === 2 || !ctx.checks;
    if (!free) {
      const reason = checkEvidence(evidence, { fromText: childText, toText: parentText }, null, ctx.session.record, ctx.level);
      if (reason) return refuse(reason, summary);
    }

    return {
      ok: true,
      summary,
      proposal: { id: ctx.nextProposalId(), status: "pending", kind: "nest", child, parent, provenance: free ? { kind: "ai_suggested" } : { kind: "user" } },
    };
  },
};
