import { describe, expect, it } from "vitest";
import type { MapState } from "../state/types";
import { buildEdges, buildNodes, CARD_W } from "./flow";

const noop = { readOnly: false, onFinishEdit: () => {}, onDelete: () => {}, onTakeOut: () => {}, onResize: () => {} };
const card = (id: string, parentId: string | null, x = 0, y = 0) => ({ id, text: id, parentId, provenance: { kind: "user" as const }, x, y });

describe("map → canvas", () => {
  it("lists parents before children and sizes each parent to hold its children", () => {
    const map: MapState = { cards: [card("c3", "c2", 16, 48), card("c2", "c1", 16, 48), card("c1", null, 100, 100)], links: [] };
    const nodes = buildNodes(map, [], null, noop);
    expect(nodes.map((n) => n.id)).toEqual(["c1", "c2", "c3"]);
    const [outer, inner, leaf] = nodes;
    expect(leaf!.style).toBeUndefined();
    expect(inner!.style!.width).toBeGreaterThanOrEqual(16 + CARD_W);
    expect(outer!.style!.width).toBeGreaterThan(inner!.style!.width as number); // holds the inner parent too
    expect(inner!.parentId).toBe("c1");
  });

  it("a parent is at least as wide as the writer made it, and never narrower than its children need", () => {
    const wide: MapState = { cards: [{ ...card("c1", null), w: 500 }, card("c2", "c1", 16, 48)], links: [] };
    expect(buildNodes(wide, [], null, noop)[0]!.style!.width).toBe(500);
    const narrow: MapState = { cards: [{ ...card("c1", null), w: 160 }, card("c2", "c1", 16, 48)], links: [] };
    expect(buildNodes(narrow, [], null, noop)[0]!.style!.width).toBeGreaterThanOrEqual(16 + CARD_W);
  });

  it("marks AI-suggested links", () => {
    const map: MapState = { cards: [card("c1", null), card("c2", null)], links: [{ id: "l1", from: "c1", to: "c2", label: "so", provenance: { kind: "ai_suggested" } }] };
    expect(buildEdges(map, [])[0]).toMatchObject({ source: "c1", target: "c2", label: "so · AI suggested", className: "edge-ai" });
  });
});
