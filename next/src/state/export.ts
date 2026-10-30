import { provenanceLabel, structureLabel } from "./labels";
import type { Card, MapState } from "./types";

/** The map as Markdown for "Copy map": nesting as an indented list, then the links. */
export function mapToMarkdown(map: MapState): string {
  const byParent = new Map<string | null, Card[]>();
  for (const c of map.cards) {
    const key = c.parentId && map.cards.some((p) => p.id === c.parentId) ? c.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), c]);
  }
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const c of byParent.get(parent) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const marks = [provenanceLabel(c.provenance), parent ? structureLabel(c.parentProvenance) && "nesting AI suggested" : null].filter(Boolean);
      lines.push(`${"  ".repeat(depth)}- ${c.text || "(empty card)"}${marks.length ? ` _(${marks.join("; ")})_` : ""}`);
      walk(c.id, depth + 1, seen);
    }
  };
  walk(null, 0, new Set());

  const text = (id: string) => map.cards.find((c) => c.id === id)?.text ?? id;
  const links = map.links.map((l) => `- ${text(l.from)} → ${l.label || "(no label)"} → ${text(l.to)}${structureLabel(l.provenance) ? " _(AI suggested)_" : ""}`);

  return ["# Map", "", ...(lines.length ? lines : ["(no cards)"]), ...(links.length ? ["", "## Links", "", ...links] : [])].join("\n");
}
