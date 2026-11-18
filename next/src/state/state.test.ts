import { describe, expect, it } from "vitest";
import { runOverlap } from "./adoption";
import { absolutePosition, acceptProposal, addCard, addLink, CARD_W_MAX, CARD_W_MIN, deleteCard, editCard, mergeTurn, rejectProposal, resizeCard, restoreProposal, setParent, undo } from "./map";
import { emptySession, type Proposal, type Session } from "./types";

function withProposals(proposals: Proposal[]): Session {
  return { ...emptySession(), proposals, counters: { card: 0, link: 0, proposal: proposals.length, turn: 0 } };
}

describe("proposals", () => {
  const card = (id: string, text: string): Proposal => ({ id, status: "pending", kind: "card", text, provenance: { kind: "user" }, sources: [] });

  it("accepting a card puts it on the map; a link to it can then be accepted", () => {
    let s = withProposals([card("p1", "A"), card("p2", "B"), { id: "p3", status: "pending", kind: "link", from: "p1", to: "p2", label: "so", provenance: { kind: "user" } }]);
    s = acceptProposal(s, "p3");
    expect(s.map.links).toHaveLength(0); // blocked until both cards are accepted
    s = acceptProposal(acceptProposal(acceptProposal(s, "p1"), "p2"), "p3");
    expect(s.map.links).toEqual([{ id: "l1", from: "c1", to: "c2", label: "so", provenance: { kind: "user" } }]);
    expect(s.decisions).toHaveLength(3);
  });

  it("rejecting a card drops the link and nest proposals that named it", () => {
    let s = withProposals([card("p1", "A"), { id: "p2", status: "pending", kind: "nest", child: "p1", parent: "c9", provenance: { kind: "user" } }]);
    s = rejectProposal(s, "p1");
    expect(s.proposals.map((p) => p.status)).toEqual(["rejected", "dropped"]);
  });

  it("deleting a card drops the pending link that named it, so no Accept is left that can't work", () => {
    let s = addCard(addCard(withProposals([]), "A"), "B");
    s = { ...s, proposals: [{ id: "p1", status: "pending", kind: "link", from: "c1", to: "c2", label: "so", provenance: { kind: "ai_suggested" } }] };
    s = deleteCard(s, "c2");
    expect(s.proposals[0]).toMatchObject({ status: "dropped", note: "Its card was deleted." });
    // Undo brings the card back and the link with it.
    expect(undo(s).proposals[0]?.status).toBe("pending");
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

describe("review fixes: nesting positions, marks and decisions", () => {
  const base = (): Session => ({
    ...emptySession(),
    map: { cards: [{ id: "c1", text: "A", parentId: null, provenance: { kind: "user" }, x: 100, y: 50 }, { id: "c2", text: "B", parentId: null, provenance: { kind: "user" }, x: 500, y: 50 }], links: [] },
    counters: { card: 2, link: 0, proposal: 0, turn: 0 },
  });

  it("nesting places the child inside the parent; taking it out puts it beside the parent", () => {
    let s = setParent(base(), "c2", "c1");
    const child = s.map.cards.find((c) => c.id === "c2")!;
    expect(child.parentId).toBe("c1");
    expect(absolutePosition(s.map, "c2")).toEqual({ x: 100 + child.x, y: 50 + child.y });
    s = setParent(s, "c2", null);
    const out = s.map.cards.find((c) => c.id === "c2")!;
    expect(out.parentId).toBeNull();
    expect(out.x).toBeGreaterThan(100 + 200); // to the right of the old parent, not inside it
  });

  it("the writer re-nesting a card clears an AI-suggested mark", () => {
    let s = base();
    s = { ...s, map: { ...s.map, cards: s.map.cards.map((c) => (c.id === "c2" ? { ...c, parentId: "c1", parentProvenance: { kind: "ai_suggested" as const }, x: 16, y: 48 } : c)) } };
    s = setParent(s, "c2", null);
    expect(s.map.cards.find((c) => c.id === "c2")?.parentProvenance).toBeUndefined();
  });

  it("deleting a parent keeps its children where they were on the canvas", () => {
    let s = setParent(base(), "c2", "c1");
    const before = absolutePosition(s.map, "c2");
    s = deleteCard(s, "c1");
    const child = s.map.cards.find((c) => c.id === "c2")!;
    expect(child.parentId).toBeNull();
    expect({ x: child.x, y: child.y }).toEqual(before);
  });

  it("an accepted card proposal tells the model which card it became, and keeps its sources", () => {
    const sources = [{ piece: "A", from: "chat" as const, turn: 1, allTurns: [1], inDraft: false }];
    let s = withProposals([{ id: "p1", status: "pending", kind: "card", text: "A", provenance: { kind: "user" }, sources }]);
    s = acceptProposal(s, "p1");
    expect(s.decisions).toEqual(['accepted p1 (card "A"), now card c1']);
    expect(s.map.cards[0]?.sources).toEqual(sources);
  });
});

describe("review minors: undo after Accept, editing quoted cards", () => {
  const card = (id: string, text: string): Proposal => ({ id, status: "pending", kind: "card", text, provenance: { kind: "combined", messages: 2 }, sources: [{ piece: text, from: "chat", turn: 1, allTurns: [1], inDraft: false }] });

  it("undoing an Accept makes the proposal pending again, tells the model, and keeps later proposals", () => {
    let s = acceptProposal(withProposals([card("p1", "A")]), "p1");
    // A later turn added another proposal before the writer pressed Undo.
    s = { ...s, proposals: [...s.proposals, card("p2", "B")], decisions: [] };
    s = undo(s);
    expect(s.map.cards).toHaveLength(0);
    expect(s.proposals.map((p) => `${p.id}:${p.status}`)).toEqual(["p1:pending", "p2:pending"]);
    expect(s.decisions).toEqual(['writer undid accepting p1 (card "A"); it is pending again']);
  });

  it("editing a quoted card drops its stale sources and From label; an AI suggestion keeps its label", () => {
    let s = acceptProposal(withProposals([card("p1", "A")]), "p1");
    s = editCard(s, "c1", "A, in my own words");
    expect(s.map.cards[0]).toMatchObject({ text: "A, in my own words", provenance: { kind: "user" } });
    expect(s.map.cards[0]?.sources).toBeUndefined();
    s = { ...s, map: { ...s.map, cards: s.map.cards.map((c) => ({ ...c, provenance: { kind: "ai_suggested" as const } })) } };
    s = editCard(s, "c1", "changed again");
    expect(s.map.cards[0]?.provenance).toEqual({ kind: "ai_suggested" });
  });
});

describe("demo bugs: restore a rejected card (#655), edit while the coach thinks (#654), resize (#656)", () => {
  const card = (id: string, text: string): Proposal => ({ id, status: "pending", kind: "card", text, provenance: { kind: "user" }, sources: [] });

  it("restoring a rejected card makes it pending again, with the link that was dropped because of it", () => {
    let s = withProposals([card("p1", "A"), card("p2", "B"), { id: "p3", status: "pending", kind: "link", from: "p1", to: "p2", label: "so", provenance: { kind: "user" } }]);
    s = rejectProposal(s, "p1");
    expect(s.proposals.map((p) => p.status)).toEqual(["rejected", "pending", "dropped"]);
    s = restoreProposal(s, "p1");
    expect(s.proposals.map((p) => p.status)).toEqual(["pending", "pending", "pending"]);
    expect(s.proposals[2]?.note).toBeUndefined();
    expect(s.decisions.at(-1)).toBe('writer took back rejecting p1 (card "A"); it is pending again');
    // And it can then be accepted like any pending card.
    expect(acceptProposal(s, "p1").map.cards).toHaveLength(1);
  });

  it("restoring leaves alone what was dropped for another reason, and only acts on rejected proposals", () => {
    let s = withProposals([card("p1", "A"), { id: "p2", status: "dropped", note: "Its card was deleted.", kind: "nest", child: "p1", parent: "c9", provenance: { kind: "user" } }]);
    s = rejectProposal(s, "p1");
    s = restoreProposal(s, "p1");
    expect(s.proposals[1]?.status).toBe("dropped");
    expect(restoreProposal(s, "p1")).toBe(s); // already pending: nothing to restore
  });

  it("a turn landing keeps the map and draft edits the writer made while the coach was thinking", () => {
    const start: Session = { ...addCard(withProposals([card("p1", "A")]), "mine"), record: { messages: [], draft: "old draft" } };
    // The turn works from the snapshot: it adds a message, a reply and a proposal.
    const turn: Session = {
      ...start,
      counters: { ...start.counters, turn: 1, proposal: 2 },
      record: { ...start.record, messages: [{ turn: 1, text: "hi" }] },
      transcript: [{ kind: "writer", text: "hi" }, { kind: "coach", text: "ok" }],
      proposals: [...start.proposals, card("p2", "B")],
    };
    // Meanwhile the writer typed in the draft, edited and added a card, and deleted nothing.
    let writer = { ...start, record: { ...start.record, draft: "new draft" } };
    writer = addCard(editCard(writer, "c1", "mine, edited"), "another");
    const merged = mergeTurn(writer, turn);
    expect(merged.record).toEqual({ messages: [{ turn: 1, text: "hi" }], draft: "new draft" });
    expect(merged.map.cards.map((c) => c.text)).toEqual(["mine, edited", "another"]);
    expect(merged.counters).toMatchObject({ card: 2, turn: 1, proposal: 2 });
    expect(merged.undo).toBe(writer.undo);
    expect(merged.transcript).toHaveLength(2);
    expect(merged.proposals.map((p) => p.id)).toEqual(["p1", "p2"]);
    // Merging the same turn twice (an update, then the finished turn) changes nothing more.
    expect(mergeTurn(merged, turn)).toEqual(merged);
  });

  it("a proposal the writer's mid-turn delete dropped stays dropped when the turn lands", () => {
    let start = addCard(withProposals([]), "A");
    start = { ...start, proposals: [{ id: "p1", status: "pending", kind: "link", from: "c1", to: "c1", label: "", provenance: { kind: "ai_suggested" } }] };
    const writer = deleteCard(start, "c1");
    const merged = mergeTurn(writer, { ...start, transcript: [{ kind: "coach", text: "ok" }] });
    expect(merged.proposals[0]?.status).toBe("dropped");
    expect(merged.map.cards).toHaveLength(0);
  });

  it("resizing a card keeps it within the limits and isn't an undo step", () => {
    const s = addCard(emptySession(), "A");
    expect(resizeCard(s, "c1", 300).map.cards[0]?.w).toBe(300);
    expect(resizeCard(s, "c1", 10).map.cards[0]?.w).toBe(CARD_W_MIN);
    expect(resizeCard(s, "c1", 5000).map.cards[0]?.w).toBe(CARD_W_MAX);
    expect(resizeCard(s, "c1", 300).undo).toHaveLength(s.undo.length);
    // Moving and nesting keep the width.
    const nested = setParent(addCard(resizeCard(s, "c1", 300), "B"), "c1", "c2");
    expect(nested.map.cards.find((c) => c.id === "c1")?.w).toBe(300);
  });
});
