import type { Card, Provenance, StructureProvenance } from "./types";

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

/** For the model's state block, where every card states its source. */
export function cardSourceForModel(card: Pick<Card, "provenance">): string {
  return provenanceLabel(card.provenance) ?? "writer's own";
}
