import { describe, expect, it } from "vitest";
import { runOverlap } from "./adoption";
import { acceptProposal, addCard, addLink, deleteCard, editCard, rejectProposal, setParent, undo } from "./map";
import { emptySession, type Proposal, type Session } from "./types";

function withProposals(proposals: Proposal[]): Session {
  return { ...emptySession(), proposals, counters: { card: 0, link: 0, proposal: proposals.length, turn: 0 } };
}

describe("proposals", () => {
  const card = (id: string, text: string): Proposal => ({ id, status: "pending", kind: "card", text, provenance: { kind: "user" } });

  it("accepting a card puts it on the map; a link to it can then be accepted", () => {
    let s = withProposals([card("p1", "A"), card("p2", "B"), { id: "p3", status: "pending", kind: "link", from: "p1", to: "p2", label: "so", provenance: { kind: "user" } }]);
    s = acceptProposal(s, "p3");
    expect(s.map.links).toHaveLength(0); // blocked until both cards are accepted
    s = acceptProposal(acceptProposal(acceptProposal(s, "p1"), "p2"), "p3");
    expect(s.map.links).toEqual([{ id: "l1", from: "c1", to: "c2", label: "so", provenance: { kind: "user" } }]);
    expect(s.decisions).toHaveLength(3);
  });

  it("rejecting a card drops the link and nest proposals that named it", () => {
    let s = withProposals([card("p1", "A"), { id: "p2", status: "pending", kind: "nest", child: "p1", parent: "c9" }]);
    s = rejectProposal(s, "p1");
    expect(s.proposals.map((p) => p.status)).toEqual(["rejected", "dropped"]);
  });

  it("an accepted suggestion becomes an AI-suggested card", () => {
    const s = acceptProposal(withProposals([{ id: "p1", status: "pending", kind: "suggestion", text: "Try Z", nearCard: null }]), "p1");
    expect(s.map.cards[0]?.provenance).toEqual({ kind: "ai_suggested" });
  });
});

describe("writer map actions", () => {
  it("add, edit, link, nest, delete and undo", () => {
    let s = addCard(addCard(emptySession(), "A"), "B");
    s = addLink(s, "c1", "c2", "so");
    s = setParent(s, "c2", "c1");
    expect(setParent(s, "c1", "c2")).toBe(s); // would loop
    s = editCard(s, "c1", "A2");
    s = deleteCard(s, "c1");
    expect(s.map.cards).toEqual([expect.objectContaining({ id: "c2", parentId: null })]);
    expect(s.map.links).toHaveLength(0);
    s = undo(s);
    expect(s.map.cards.map((c) => c.text)).toEqual(["A2", "B"]);
  });
});

describe("suggestion adoption (three-word runs)", () => {
  it("measures the share of card words inside shared runs of three or more", () => {
    expect(runOverlap("the real topic is flaws", "maybe the real topic is X")).toBeCloseTo(4 / 5);
    expect(runOverlap("the cat sat", "a cat that sat")).toBe(0); // no shared three-word run
    expect(runOverlap("flaws", "focus on flaws")).toBe(1); // short card: whole card appears
  });

  it("marks a card the writer types from a visible suggestion, only when its text changed", () => {
    let s = withProposals([{ id: "p1", status: "rejected", kind: "suggestion", text: "maybe the real topic is flaws", nearCard: null }]);
    s = addCard(s, "the real topic is flaws");
    expect(s.map.cards[0]).toMatchObject({ provenance: { kind: "ai_suggested" }, adoption: { adoptedFrom: "p1" } });
    s = editCard(s, "c1", "my own idea entirely");
    expect(s.map.cards[0]).toMatchObject({ provenance: { kind: "ai_suggested" }, adoption: { currentOverlap: 0, peakOverlap: 1 } });
  });

  it("does nothing when the setting is off", () => {
    const base = withProposals([{ id: "p1", status: "pending", kind: "suggestion", text: "the real topic is flaws", nearCard: null }]);
    const s = addCard({ ...base, settings: { suggestionAdoption: false } }, "the real topic is flaws");
    expect(s.map.cards[0]?.provenance).toEqual({ kind: "user" });
  });
});
