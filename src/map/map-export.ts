import type { ThoughtConnection, ThoughtUnitStoreSnapshot } from "./map-store";
import type { ThoughtUnit } from "../types";

const EMPTY_CARD = "(empty card)";

function visible(unit: ThoughtUnit): boolean {
  return unit.role !== "connection_label";
}

function displayText(unit: ThoughtUnit | undefined): string {
  return unit?.text.trim() || EMPTY_CARD;
}

function bullet(text: string, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const lines = (text.trim() || EMPTY_CARD).split(/\r?\n/);
  return [
    `${indent}- ${lines[0]}`,
    ...lines.slice(1).map((line) => `${indent}  ${line}`),
  ];
}

function relationshipLine(
  connection: ThoughtConnection,
  units: ReadonlyMap<string, ThoughtUnit>,
): string | null {
  const source = units.get(connection.sourceId);
  const target = units.get(connection.targetId);
  if (!source || !target || !visible(source) || !visible(target)) return null;
  const label = units.get(connection.labelUnitId)?.text.trim();
  const sourceText = displayText(source).replace(/\s*\r?\n\s*/g, " ");
  const targetText = displayText(target).replace(/\s*\r?\n\s*/g, " ");
  const middle = label ? ` — ${label.replace(/\s*\r?\n\s*/g, " ")} ` : " ";
  if (connection.layoutDirection === "target_to_source") {
    return `- ${targetText}${middle}→ ${sourceText}`;
  }
  if (connection.layoutDirection === "source_to_target") {
    return `- ${sourceText}${middle}→ ${targetText}`;
  }
  return `- ${sourceText}${label ? `${middle}— ` : " — "}${targetText}`;
}

/** Deterministic, loss-averse Markdown representation of the locally stored map. */
export function formatMapAsMarkdown(snapshot: ThoughtUnitStoreSnapshot): string {
  const visibleUnits = snapshot.units.filter(visible);
  const units = new Map(snapshot.units.map((unit) => [unit.id, unit]));
  const children = new Map<string, ThoughtUnit[]>();
  for (const unit of visibleUnits) {
    if (!unit.parentId) continue;
    const siblings = children.get(unit.parentId) ?? [];
    siblings.push(unit);
    children.set(unit.parentId, siblings);
  }

  const lines = ["# Mindmap"];
  const visited = new Set<string>();
  const visit = (unit: ThoughtUnit, depth: number) => {
    if (visited.has(unit.id)) return;
    visited.add(unit.id);
    lines.push(...bullet(unit.text, depth));
    for (const child of children.get(unit.id) ?? []) visit(child, depth + 1);
  };

  const roots = visibleUnits.filter((unit) => {
    if (!unit.parentId) return true;
    const parent = units.get(unit.parentId);
    return !parent || !visible(parent);
  });
  for (const root of roots) visit(root, 0);
  // Malformed persisted cycles have no roots. Emit their first unvisited member and
  // let `visited` terminate the loop rather than dropping or hanging on user content.
  for (const unit of visibleUnits) visit(unit, 0);

  const relationships = snapshot.connections.flatMap((connection) => {
    const line = relationshipLine(
      { ...connection, layoutDirection: connection.layoutDirection ?? "none" },
      units,
    );
    return line ? [line] : [];
  });
  if (relationships.length) lines.push("", "## Relationships", ...relationships);
  return `${lines.join("\n")}\n`;
}
