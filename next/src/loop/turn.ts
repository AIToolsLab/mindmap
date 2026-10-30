import type { HistoryItem, Session } from "../state/types";
import { refuse, type HandlerResult } from "../tools/common";
import { toolByName, toolDefinitions } from "../tools";
import type { ModelCall } from "./client";
import { ATTEMPT_BUDGET, instructions, stateBlock, visibleHistory } from "./context";

/** Safety cap (spec §6): a turn never makes more model calls than this, whatever happens. */
export const MAX_CALLS = 8;

interface FunctionCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

function rec(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function functionCalls(output: unknown[]): FunctionCall[] {
  return output.filter((item): item is FunctionCall => {
    const r = rec(item);
    return r?.type === "function_call" && typeof r.call_id === "string" && typeof r.name === "string" && typeof r.arguments === "string";
  });
}

function outputText(output: unknown[]): string {
  const parts: string[] = [];
  for (const item of output) {
    const r = rec(item);
    if (r?.type !== "message" || !Array.isArray(r.content)) continue;
    for (const c of r.content) {
      const cr = rec(c);
      if (cr?.type === "output_text" && typeof cr.text === "string") parts.push(cr.text);
    }
  }
  return parts.join("\n").trim();
}

export interface TurnDeps {
  callModel: ModelCall;
  /** Called after every step so the chat shows tool lines as they happen. */
  onUpdate?: (session: Session) => void;
}

/**
 * One writer turn (spec §6): record the message, then call the model until it replies
 * with text and no tool calls. Each tool call runs its handler; a refusal costs one
 * attempt and tells the model how many are left. At zero, the next call is text only.
 */
export async function runTurn(start: Session, writerText: string, deps: TurnDeps): Promise<Session> {
  const turn = start.counters.turn + 1;
  const level = start.level;
  const reported = start.decisions.length;
  let s: Session = {
    ...start,
    counters: { ...start.counters, turn },
    record: { ...start.record, messages: [...start.record.messages, { turn, text: writerText }] },
    transcript: [...start.transcript, { kind: "writer", text: writerText }],
  };
  deps.onUpdate?.(s);

  const writerItem: HistoryItem = { role: "user", content: writerText };
  const turnItems: unknown[] = []; // everything returned this turn, reasoning included
  const kept: HistoryItem[] = []; // what later turns will see (no reasoning items)
  let attemptsLeft = ATTEMPT_BUDGET;
  let calls = 0;
  let finished = false;

  const seen = visibleHistory(s.history);
  try {
    while (calls < MAX_CALLS) {
      const toolsOn = attemptsLeft > 0;
      let output: unknown[];
      try {
        output = await deps.callModel({
          instructions: instructions(level),
          // The state block is a developer message: it comes from the app, not the writer.
          input: [...seen.items, { role: "developer", content: stateBlock(s, attemptsLeft, seen.hidden) }, writerItem, ...turnItems],
          tools: toolDefinitions(level),
          toolChoice: toolsOn ? "auto" : "none",
        });
      } catch (error) {
        s = { ...s, transcript: [...s.transcript, { kind: "notice", text: `Couldn't reach the coach: ${error instanceof Error ? error.message : String(error)}` }] };
        deps.onUpdate?.(s);
        finished = true;
        break;
      }
      calls++;
      turnItems.push(...output);

      const text = outputText(output);
      if (text) {
        s = { ...s, transcript: [...s.transcript, { kind: "coach", text }] };
        kept.push({ role: "assistant", content: text });
      }

      const toolCalls = functionCalls(output);
      if (!toolCalls.length) {
        finished = true;
        break;
      }

      for (const call of toolCalls) {
        kept.push({ type: "function_call", call_id: call.call_id, name: call.name, arguments: call.arguments });
        // Checked per call: once the budget is spent, later calls in the same batch are
        // refused without running, so a batch can't exceed it.
        const result = runTool(call, s, level, attemptsLeft > 0, () => {
          const id = `p${s.counters.proposal + 1}`;
          s = { ...s, counters: { ...s.counters, proposal: s.counters.proposal + 1 } };
          return id;
        });

        let payload: Record<string, unknown>;
        if (result.ok) {
          s = {
            ...s,
            proposals: [...s.proposals, result.proposal],
            transcript: [...s.transcript, { kind: "tool", name: call.name, summary: result.summary, ok: true, proposalId: result.proposal.id }],
          };
          payload = { ok: true, proposal: result.proposal.id, shown_as: result.summary };
        } else {
          attemptsLeft = Math.max(0, attemptsLeft - 1);
          s = { ...s, transcript: [...s.transcript, { kind: "tool", name: call.name, summary: result.summary, ok: false, reason: result.reason }] };
          payload = { ok: false, reason: result.reason, attempts_left: attemptsLeft };
        }
        const outputItem: HistoryItem = { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(payload) };
        turnItems.push(outputItem);
        kept.push(outputItem);
        deps.onUpdate?.(s);
      }
    }
  } catch (error) {
    // Anything else that goes wrong mid-turn (not a failed model call, handled above):
    // say so in the chat, and still keep the turn in history below.
    s = { ...s, transcript: [...s.transcript, { kind: "notice", text: `Something went wrong in this turn: ${error instanceof Error ? error.message : String(error)}` }] };
    finished = true;
  }

  // Every kept tool call needs its result, or the next request is invalid.
  const answered = new Set(kept.flatMap((h) => ("type" in h && h.type === "function_call_output" ? [h.call_id] : [])));
  for (const h of [...kept]) {
    if ("type" in h && h.type === "function_call" && !answered.has(h.call_id)) {
      kept.push({ type: "function_call_output", call_id: h.call_id, output: JSON.stringify({ ok: false, reason: "The app hit an error before running this tool." }) });
    }
  }

  if (!finished) {
    s = { ...s, transcript: [...s.transcript, { kind: "notice", text: `The coach stopped after ${MAX_CALLS} steps without finishing its reply.` }] };
  }
  // The decisions reported in this turn's state block have now been told.
  s = { ...s, history: [...s.history, writerItem, ...kept], decisions: s.decisions.slice(reported) };
  deps.onUpdate?.(s);
  return s;
}

function runTool(call: FunctionCall, session: Session, level: Session["level"], toolsOn: boolean, nextProposalId: () => string): HandlerResult {
  if (!toolsOn) return refuse("No attempts left this turn; reply in words.", call.name);
  const tool = toolByName(call.name);
  if (!tool) return refuse(`There is no tool called "${call.name}".`, call.name);
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return refuse("The arguments were not valid JSON.", call.name);
  }
  return tool.handle(args, { session, level, checks: true, nextProposalId });
}
