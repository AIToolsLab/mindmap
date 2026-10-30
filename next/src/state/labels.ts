import type { Card, Proposal, Provenance, StructureProvenance } from "./types";

/**
 * Provenance wording, shared by the chat, the map and what the model is shown, so the
 * labels can't drift apart. The writer's own words get no label (null).
 */
export function provenanceLabel(p: Provenance): string | null {
  if (p.kind === "combined") return `From ${p.messages} messages`;
  if (p.kind === "draft") return "From your draft";
  if (p.kind === "ai_suggested") return "AI suggestion";
  return null;
}

export function structureLabel(p: StructureProvenance | undefined): string | null {
  return p?.kind === "ai_suggested" ? "AI suggested" : null;
}

/**
 * The label a proposal will carry on the map, shown on its chat line so the writer
 * sees it before deciding.
 */
export function proposalLabel(p: Proposal): string | null {
  if (p.kind === "card") return provenanceLabel(p.provenance);
  if (p.kind === "suggestion") return provenanceLabel({ kind: "ai_suggested" });
  return structureLabel(p.provenance);
}

/** For the model's state block, where every card states its source. */
export function cardSourceForModel(card: Pick<Card, "provenance">): string {
  return provenanceLabel(card.provenance) ?? "writer's own";
}
