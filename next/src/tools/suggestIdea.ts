import { refText } from "../state/map";
import { obj, refuse, type Tool } from "./common";

/**
 * Spec §5.4. Offered at every level but refused below L2, so the model meets the
 * boundary and can draw the idea out of the writer instead.
 */
export const suggestIdea: Tool = {
  name: "suggest_idea",
  description: (level) =>
    level === 2
      ? "Suggest an idea of your own. It is shown to the writer as an AI suggestion, and they accept or reject it. `near_card` optionally names the card it relates to, or null."
      : `Suggest an idea of your own. Only works at L2; at L${level} it will be refused.`,
  parameters: {
    type: "object",
    properties: { text: { type: "string" }, near_card: { type: ["string", "null"] } },
    required: ["text", "near_card"],
    additionalProperties: false,
  },
  handle(args, ctx) {
    const a = obj(args);
    const text = typeof a?.text === "string" ? a.text.trim() : "";
    const summary = text ? `"${text}"` : "(empty)";
    if (ctx.level !== 2 && ctx.checks) return refuse(`suggest_idea isn't available at L${ctx.level}.`, summary);
    if (!text) return refuse("A suggestion needs some text.", summary);
    const near = typeof a?.near_card === "string" && a.near_card ? a.near_card : null;
    if (near && !refText(ctx.session, near)) return refuse(`There is no card or pending card proposal "${near}".`, summary);
    return { ok: true, summary, proposal: { id: ctx.nextProposalId(), status: "pending", kind: "suggestion", text, nearCard: near } };
  },
};
