import { describe, expect, it } from "vitest";
import { emptySession, type HistoryItem, type Session } from "../state/types";
import { visibleHistory } from "./context";
import type { ModelCall, ModelRequest } from "./client";
import { MAX_CALLS, runTurn } from "./turn";

const call = (id: string, name: string, args: unknown) => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });
const say = (text: string) => ({ type: "message", content: [{ type: "output_text", text }] });

/** A fake model that returns scripted outputs in order and records each request. */
function fake(outputs: unknown[][]): { model: ModelCall; requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let i = 0;
  return {
    requests,
    model: async (req) => {
      requests.push(req);
      return outputs[Math.min(i++, outputs.length - 1)]!;
    },
  };
}

function start(messages: string[] = []): Session {
  const s = emptySession();
  return { ...s, record: { messages: messages.map((text, i) => ({ turn: i + 1, text })), draft: "" }, counters: { ...s.counters, turn: messages.length } };
}

describe("runTurn", () => {
  it("records the writer's message, runs tools, and ends on text", async () => {
    const { model } = fake([[call("a", "propose_card", { pieces: ["X is bad"] })], [say("Does that capture it?")]]);
    const s = await runTurn(start(), "because X is bad", { callModel: model });
    expect(s.record.messages.at(-1)).toEqual({ turn: 1, text: "because X is bad" });
    expect(s.proposals).toHaveLength(1);
    expect(s.transcript.map((t) => t.kind)).toEqual(["writer", "tool", "coach"]);
  });

  it("tells the model how many attempts are left, and goes text-only at zero", async () => {
    const refused = call("x", "suggest_idea", { text: "idea", near_card: null });
    const { model, requests } = fake([[refused], [{ ...refused, call_id: "y" }], [{ ...refused, call_id: "z" }], [say("Let's find it together.")]]);
    const s = await runTurn(start(), "hi", { callModel: model });
    const outputs = s.history.filter((h): h is { type: "function_call_output"; call_id: string; output: string } => "type" in h && h.type === "function_call_output");
    expect(outputs.map((o) => JSON.parse(o.output).attempts_left)).toEqual([2, 1, 0]);
    expect(requests.map((r) => r.toolChoice)).toEqual(["auto", "auto", "auto", "none"]);
    expect(s.transcript.at(-1)).toEqual({ kind: "coach", text: "Let's find it together." });
  });

  it("refused attempts don't stop successful ones in the same turn", async () => {
    const { model } = fake([
      [call("a", "suggest_idea", { text: "idea", near_card: null }), call("b", "propose_card", { pieces: ["I like X"] })],
      [say("ok")],
    ]);
    const s = await runTurn(start(["I like X"]), "more", { callModel: model });
    expect(s.transcript.filter((t) => t.kind === "tool").map((t) => t.kind === "tool" && t.ok)).toEqual([false, true]);
  });

  it("stops after the call cap even if the model never finishes", async () => {
    const { model, requests } = fake([[call("a", "propose_card", { pieces: ["I like X"] })]]);
    const s = await runTurn(start(["I like X"]), "go", { callModel: model });
    expect(requests).toHaveLength(MAX_CALLS);
    expect(s.transcript.at(-1)).toMatchObject({ kind: "notice" });
  });

  it("sends the state block before the new message, and the history after the turn", async () => {
    const { model, requests } = fake([[say("hello")]]);
    const s = await runTurn(start(), "first", { callModel: model });
    const input = requests[0]!.input as Array<{ content?: string }>;
    expect(input.at(-2)?.content).toContain("[Current state");
    expect(input.at(-1)).toEqual({ role: "user", content: "first" });
    expect(s.history).toEqual([{ role: "user", content: "first" }, { role: "assistant", content: "hello" }]);
  });

  it("refuses unknown tools and bad JSON", async () => {
    const { model } = fake([[call("a", "delete_everything", {}), { type: "function_call", call_id: "b", name: "propose_card", arguments: "{not json" }], [say("sorry")]]);
    const s = await runTurn(start(), "x", { callModel: model });
    const reasons = s.transcript.filter((t) => t.kind === "tool").map((t) => (t.kind === "tool" ? t.reason : ""));
    expect(reasons).toEqual(['There is no tool called "delete_everything".', "The arguments were not valid JSON."]);
  });

  it("reports writer decisions once, then clears them", async () => {
    const { model, requests } = fake([[say("noted")]]);
    const s = await runTurn({ ...start(), decisions: ["accepted p1 (card \"X\")"] }, "x", { callModel: model });
    expect((requests[0]!.input as Array<{ content?: string }>).some((i) => i.content?.includes("accepted p1"))).toBe(true);
    expect(s.decisions).toEqual([]);
  });

  it("shows a notice when the backend can't be reached", async () => {
    const s = await runTurn(start(), "x", { callModel: async () => { throw new Error("Backend 401: nope"); } });
    expect(s.transcript.at(-1)).toEqual({ kind: "notice", text: "Couldn't reach the coach: Backend 401: nope" });
  });
});

describe("review fixes: declined list, history trimming, budget in one batch", () => {
  it("keeps what the writer declined in every later state block, not just the next one", async () => {
    let s = start();
    s = { ...s, proposals: [{ id: "p1", status: "rejected", kind: "card", text: "X is bad", provenance: { kind: "user" }, sources: [] }], counters: { ...s.counters, proposal: 1 } };
    const first = fake([[say("ok")]]);
    s = await runTurn(s, "hi", { callModel: first.model });
    const second = fake([[say("ok")]]);
    await runTurn(s, "again", { callModel: second.model });
    const stateOf = (r: ModelRequest) => (r.input as { role?: string; content?: string }[]).find((i) => i.role === "developer")!.content!;
    expect(stateOf(second.requests[0]!)).toContain('Declined by the writer earlier');
    expect(stateOf(second.requests[0]!)).toContain('p1 card "X is bad"');
  });

  it("shows the model only recent turns, never splitting a tool call from its result", () => {
    const history: HistoryItem[] = [];
    for (let t = 1; t <= 45; t++) {
      history.push({ role: "user", content: `m${t}` });
      history.push({ type: "function_call", call_id: `c${t}`, name: "propose_card", arguments: "{}" });
      history.push({ type: "function_call_output", call_id: `c${t}`, output: "{}" });
      history.push({ role: "assistant", content: `r${t}` });
    }
    const seen = visibleHistory(history, 40);
    expect(seen.hidden).toBe(5);
    expect(seen.items[0]).toEqual({ role: "user", content: "m6" });
    const calls = seen.items.filter((h) => "type" in h && h.type === "function_call").length;
    const outputs = seen.items.filter((h) => "type" in h && h.type === "function_call_output").length;
    expect(calls).toBe(outputs);
  });

  it("refuses calls past the budget in the same batch without running them", async () => {
    const bad = (id: string) => call(id, "suggest_idea", { text: "idea", near_card: null });
    const { model } = fake([[bad("a"), bad("b"), bad("c"), call("d", "propose_card", { pieces: ["I like X"] })], [say("ok")]]);
    const s = await runTurn(start(["I like X"]), "hi", { callModel: model });
    expect(s.proposals).toHaveLength(0); // the fourth call came after the budget was spent
    const last = s.transcript.filter((t) => t.kind === "tool").at(-1);
    expect(last).toMatchObject({ ok: false, reason: "No attempts left this turn; reply in words." });
  });
});

describe("review minors: errors mid-turn", () => {
  it("reports an unexpected error in the chat and still keeps the turn in history", async () => {
    const { model } = fake([[call("a", "propose_card", { pieces: ["I like X"] })], [say("ok")]]);
    let updates = 0;
    const s = await runTurn(start(["I like X"]), "hi", {
      callModel: model,
      onUpdate: () => {
        if (++updates === 2) throw new Error("render failed"); // after the first tool result
      },
    });
    expect(s.transcript.at(-1)).toEqual({ kind: "notice", text: "Something went wrong in this turn: render failed" });
    expect(s.history[0]).toEqual({ role: "user", content: "hi" });
    const calls = s.history.filter((h) => "type" in h && h.type === "function_call").length;
    const outputs = s.history.filter((h) => "type" in h && h.type === "function_call_output").length;
    expect(outputs).toBe(calls);
  });
});
