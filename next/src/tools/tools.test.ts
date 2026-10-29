import { describe, expect, it } from "vitest";
import { acceptProposal } from "../state/map";
import { emptySession, type Level, type Session } from "../state/types";
import type { HandlerResult, Tool, ToolContext } from "./common";
import { proposeCard } from "./proposeCard";
import { proposeLink } from "./proposeLink";
import { proposeNest } from "./proposeNest";
import { suggestIdea } from "./suggestIdea";

function session(messages: string[], opts: { draft?: string; level?: Level } = {}): Session {
  const s = emptySession();
  return {
    ...s,
    level: opts.level ?? 0,
    record: { messages: messages.map((text, i) => ({ turn: i + 1, text })), draft: opts.draft ?? "" },
  };
}

function run(tool: Tool, args: unknown, s: Session, level: Level = s.level): HandlerResult {
  let n = s.counters.proposal;
  const ctx: ToolContext = { session: s, level, checks: true, nextProposalId: () => `p${++n}` };
  return tool.handle(args, ctx);
}

/** Adds a proposal to the session, as the loop would. */
function apply(s: Session, r: HandlerResult): Session {
  if (!r.ok) throw new Error(r.reason);
  return { ...s, proposals: [...s.proposals, r.proposal], counters: { ...s.counters, proposal: s.counters.proposal + 1 } };
}

describe("propose_card", () => {
  it("accepts verbatim pieces from any earlier message at L0", () => {
    const s = session(["I like X but I'm not sure", "because X is bad"]);
    const r = run(proposeCard, { pieces: ["I like X"] }, s);
    expect(r.ok).toBe(true);
    if (r.ok && r.proposal.kind === "card") {
      expect(r.proposal.text).toBe("I like X");
      expect(r.proposal.provenance).toEqual({ kind: "user" });
    }
  });

  it("labels a card built from two messages", () => {
    const s = session(["I like X but I'm not sure", "because X is bad"]);
    const r = run(proposeCard, { pieces: ["I like X", "because X is bad"] }, s);
    expect(r.ok && r.proposal.kind === "card" && r.proposal.provenance).toEqual({ kind: "combined", messages: 2 });
  });

  it("refuses words the writer didn't write", () => {
    const r = run(proposeCard, { pieces: ["X is good"] }, session(["I don't think X is great"]));
    expect(r).toMatchObject({ ok: false, reason: '"X is good" is not in your messages.' });
  });

  it("allows partial pieces, including one that drops a negation (documented gap)", () => {
    expect(run(proposeCard, { pieces: ["X is great"] }, session(["I don't think X is great"])).ok).toBe(true);
  });

  it("refuses a piece that starts or ends mid-word", () => {
    expect(run(proposeCard, { pieces: ["ike X"] }, session(["I like X"])).ok).toBe(false);
  });

  it("matches across case, curly quotes and extra spaces", () => {
    expect(run(proposeCard, { pieces: ["it's   GOOD"] }, session(["I think it’s good"])).ok).toBe(true);
  });

  it("says the draft can't be quoted at L0", () => {
    const r = run(proposeCard, { pieces: ["the draft line"] }, session(["hello"], { draft: "This is the draft line." }));
    expect(r).toMatchObject({ ok: false, reason: '"the draft line" is in your draft, but at L0 cards can only use your chat messages.' });
  });

  it("allows the draft at L1 and labels it", () => {
    const s = session(["hello"], { draft: "This is the draft line.", level: 1 });
    const r = run(proposeCard, { pieces: ["the draft line"] }, s);
    expect(r.ok && r.proposal.kind === "card" && r.proposal.provenance).toEqual({ kind: "draft" });
  });

  it("refuses empty pieces and duplicates", () => {
    const s = session(["I like X"]);
    expect(run(proposeCard, { pieces: [] }, s).ok).toBe(false);
    expect(run(proposeCard, { pieces: ["  ,"] }, s).ok).toBe(false);
    const withCard = apply(s, run(proposeCard, { pieces: ["I like X"] }, s));
    expect(run(proposeCard, { pieces: ["i like x"] }, withCard)).toMatchObject({ ok: false, reason: 'A card with the text "i like x" is already proposed.' });
  });
});

describe("propose_link and propose_nest: the evidence rule", () => {
  // Two cards from the writer's words, accepted onto the map as c1 and c2.
  function withCards(messages: string[], a: string, b: string, level: Level = 0): Session {
    let s = session(messages, { level });
    s = apply(s, run(proposeCard, { pieces: [a] }, s));
    s = apply(s, run(proposeCard, { pieces: [b] }, s));
    s = acceptProposal(acceptProposal(s, "p1"), "p2");
    return s;
  }

  it("accepts a link the writer stated in one message", () => {
    const s = withCards(["I like X because X is bad"], "I like X", "X is bad");
    expect(run(proposeLink, { from_card: "c1", to_card: "c2", label: "because", evidence: ["I like X because X is bad"] }, s).ok).toBe(true);
  });

  it("accepts a link stated across two adjacent messages (the 'I like X… because X is bad' case)", () => {
    const s = withCards(["I like X but I'm not sure", "because X is bad"], "I like X", "X is bad");
    const r = run(proposeLink, { from_card: "c1", to_card: "c2", label: "because", evidence: ["I like X", "because X is bad"] }, s);
    expect(r.ok).toBe(true);
    expect(r.ok && r.proposal.kind === "link" && r.proposal.provenance).toEqual({ kind: "user" });
  });

  it("refuses two pieces from messages that aren't next to each other", () => {
    const s = withCards(["I like X", "something else", "because X is bad"], "I like X", "X is bad");
    const r = run(proposeLink, { from_card: "c1", to_card: "c2", label: "because", evidence: ["I like X", "because X is bad"] }, s);
    expect(r).toMatchObject({ ok: false, reason: "The two evidence pieces must come from two of your messages next to each other, in that order." });
  });

  it("refuses two pieces in the wrong order", () => {
    const s = withCards(["because X is bad", "I like X"], "I like X", "X is bad");
    expect(run(proposeLink, { from_card: "c1", to_card: "c2", label: "because", evidence: ["I like X", "because X is bad"] }, s).ok).toBe(false);
  });

  it("refuses a label that isn't between the two cards", () => {
    const s = withCards(["because I like X, X is bad"], "I like X", "X is bad");
    const r = run(proposeLink, { from_card: "c1", to_card: "c2", label: "because", evidence: ["because I like X, X is bad"] }, s);
    expect(r).toMatchObject({ ok: false, reason: 'The label "because" doesn\'t appear in the evidence after "I like X".' });
  });

  it("refuses a label the writer didn't write", () => {
    const s = withCards(["I like X because X is bad"], "I like X", "X is bad");
    expect(run(proposeLink, { from_card: "c1", to_card: "c2", label: "therefore", evidence: ["I like X because X is bad"] }, s).ok).toBe(false);
  });

  it("refuses evidence missing one card", () => {
    const s = withCards(["I like X", "and Y matters"], "I like X", "Y matters");
    const r = run(proposeLink, { from_card: "c1", to_card: "c2", label: "and", evidence: ["I like X"] }, s);
    expect(r.ok).toBe(false);
  });

  it("can link to a card proposed earlier in the same turn", () => {
    let s = session(["I like X because X is bad"]);
    s = apply(s, run(proposeCard, { pieces: ["I like X"] }, s));
    s = apply(s, run(proposeCard, { pieces: ["X is bad"] }, s));
    expect(run(proposeLink, { from_card: "p1", to_card: "p2", label: "because", evidence: ["I like X because X is bad"] }, s).ok).toBe(true);
  });

  it("allows free links at L2, shown as AI suggested", () => {
    const s = withCards(["I like X", "Y matters"], "I like X", "Y matters", 2);
    const r = run(proposeLink, { from_card: "c1", to_card: "c2", label: "leads to", evidence: [] }, s);
    expect(r.ok && r.proposal.kind === "link" && r.proposal.provenance).toEqual({ kind: "ai_suggested" });
  });

  it("refuses links between missing, identical or already linked cards", () => {
    const s = withCards(["I like X because X is bad"], "I like X", "X is bad", 2);
    expect(run(proposeLink, { from_card: "c9", to_card: "c2", label: "", evidence: [] }, s).ok).toBe(false);
    expect(run(proposeLink, { from_card: "c1", to_card: "c1", label: "", evidence: [] }, s).ok).toBe(false);
    const linked = apply(s, run(proposeLink, { from_card: "c1", to_card: "c2", label: "x", evidence: [] }, s));
    expect(run(proposeLink, { from_card: "c1", to_card: "c2", label: "y", evidence: [] }, linked).ok).toBe(false);
  });

  it("nests with evidence at L0 and refuses loops", () => {
    const s = withCards(["put X is bad under I like X"], "I like X", "X is bad");
    const r = run(proposeNest, { child: "c2", parent: "c1", evidence: ["put X is bad under I like X"] }, s);
    expect(r.ok).toBe(true);
    const nested = acceptProposal(apply(s, r), "p3");
    expect(run(proposeNest, { child: "c1", parent: "c2", evidence: ["put X is bad under I like X"] }, nested)).toMatchObject({ ok: false });
  });

  it("refuses nesting without evidence at L0", () => {
    const s = withCards(["I like X", "Y matters"], "I like X", "Y matters");
    expect(run(proposeNest, { child: "c2", parent: "c1", evidence: [] }, s).ok).toBe(false);
  });
});

describe("suggest_idea", () => {
  it("is refused at L0 and L1", () => {
    expect(run(suggestIdea, { text: "Try Z", near_card: null }, session([], { level: 0 }))).toMatchObject({ ok: false, reason: "suggest_idea isn't available at L0." });
    expect(run(suggestIdea, { text: "Try Z", near_card: null }, session([], { level: 1 }))).toMatchObject({ ok: false, reason: "suggest_idea isn't available at L1." });
  });

  it("works at L2", () => {
    const r = run(suggestIdea, { text: "Try Z", near_card: null }, session([], { level: 2 }));
    expect(r.ok && r.proposal.kind).toBe("suggestion");
  });
});

describe("review fixes: sources and nesting marks", () => {
  it("records the most recent match and every match for each piece (spec §5.1)", () => {
    const s = session(["I like X", "honestly I like X", "because X is bad"], { draft: "I like X a lot", level: 1 });
    const r = run(proposeCard, { pieces: ["I like X", "X is bad"] }, s);
    expect(r.ok && r.proposal.kind === "card" && r.proposal.sources).toEqual([
      { piece: "I like X", from: "chat", turn: 2, allTurns: [2, 1], inDraft: true },
      { piece: "X is bad", from: "chat", turn: 3, allTurns: [3], inDraft: false },
    ]);
  });

  it("marks a nesting proposed at L2 as AI suggested, and keeps the mark once accepted", () => {
    let s = session(["A and B"], { level: 2 });
    s = { ...s, map: { cards: [{ id: "c1", text: "A", parentId: null, provenance: { kind: "user" }, x: 0, y: 0 }, { id: "c2", text: "B", parentId: null, provenance: { kind: "user" }, x: 300, y: 0 }], links: [] }, counters: { ...s.counters, card: 2 } };
    const r = run(proposeNest, { child: "c2", parent: "c1", evidence: [] }, s);
    expect(r.ok && r.proposal.kind === "nest" && r.proposal.provenance).toEqual({ kind: "ai_suggested" });
    s = acceptProposal(apply(s, r), "p1");
    expect(s.map.cards.find((c) => c.id === "c2")).toMatchObject({ parentId: "c1", parentProvenance: { kind: "ai_suggested" } });
  });

  it("a nesting the writer stated (L0) carries no AI mark", () => {
    let s = session(["B is part of A"]);
    s = { ...s, map: { cards: [{ id: "c1", text: "A", parentId: null, provenance: { kind: "user" }, x: 0, y: 0 }, { id: "c2", text: "B", parentId: null, provenance: { kind: "user" }, x: 300, y: 0 }], links: [] }, counters: { ...s.counters, card: 2 } };
    const r = run(proposeNest, { child: "c2", parent: "c1", evidence: ["B is part of A"] }, s);
    s = acceptProposal(apply(s, r), "p1");
    expect(s.map.cards.find((c) => c.id === "c2")?.parentProvenance).toBeUndefined();
  });
});
