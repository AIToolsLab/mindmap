import { describe, expect, it } from "vitest";
import { formatMapAsMarkdown } from "./map-export";
import type { ThoughtUnitStoreSnapshot } from "./map-store";
import type { ThoughtUnit } from "../types";

function unit(id: string, text: string, parentId?: string, role: ThoughtUnit["role"] = "node"): ThoughtUnit {
  return {
    id,
    text,
    role,
    ...(parentId ? { parentId } : {}),
    source: { utteranceIds: [], createdBy: "user" },
    roleHistory: [],
  };
}

function snapshot(
  units: ThoughtUnit[],
  connections: ThoughtUnitStoreSnapshot["connections"] = [],
): ThoughtUnitStoreSnapshot {
  return { units, positions: {}, connections };
}

describe("map Markdown export", () => {
  it("preserves root, sibling, child, and multiline store order", () => {
    expect(formatMapAsMarkdown(snapshot([
      unit("root", "Root"),
      unit("child-1", "First\ncontinued", "root", "content"),
      unit("child-2", "Second", "root", "content"),
      unit("other", "Other"),
    ]))).toBe("# Mindmap\n- Root\n  - First\n    continued\n  - Second\n- Other\n");
  });

  it("excludes label units and recovers orphans, empty cards, and malformed cycles", () => {
    const a = unit("a", "A", "b", "content");
    const b = unit("b", "B", "a", "content");
    expect(formatMapAsMarkdown(snapshot([
      unit("label", "relates", undefined, "connection_label"),
      unit("orphan", "", "missing", "content"),
      a,
      b,
    ]))).toBe("# Mindmap\n- (empty card)\n- A\n  - B\n");
  });

  it("renders directed, reversed, undirected, labelled, and unlabelled relationships", () => {
    const units = [unit("a", "Alpha"), unit("b", "Beta"), unit("c", "Gamma"), unit("l", "supports", undefined, "connection_label")];
    const base = { confirmedAt: 1, createdBy: "user" as const, labelUnitId: "l" };
    expect(formatMapAsMarkdown(snapshot(units, [
      { ...base, id: "c1", sourceId: "a", targetId: "b", layoutDirection: "source_to_target" },
      { ...base, id: "c2", sourceId: "a", targetId: "c", layoutDirection: "target_to_source" },
      { ...base, id: "c3", sourceId: "b", targetId: "c", layoutDirection: "none" },
      { ...base, id: "c4", sourceId: "a", targetId: "c", labelUnitId: "missing", layoutDirection: "source_to_target" },
    ]))).toContain("## Relationships\n- Alpha — supports → Beta\n- Gamma — supports → Alpha\n- Beta — supports — Gamma\n- Alpha → Gamma\n");
  });

  it("drops relationships whose visible endpoints no longer exist", () => {
    expect(formatMapAsMarkdown(snapshot([unit("a", "Alpha")], [{
      id: "bad", sourceId: "a", targetId: "missing", labelUnitId: "missing",
      layoutDirection: "none", confirmedAt: 1, createdBy: "user",
    }]))).toBe("# Mindmap\n- Alpha\n");
  });
});
