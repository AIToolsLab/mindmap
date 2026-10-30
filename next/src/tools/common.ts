import type { Level, Proposal, Session } from "../state/types";

/** What a handler is given. `checks: false` is reserved for L3 (spec §3), not used in v1. */
export interface ToolContext {
  session: Session;
  level: Level;
  checks: boolean;
  /** Reserves the next proposal id ("p7"). */
  nextProposalId: () => string;
}

export type HandlerResult =
  | { ok: true; proposal: Proposal; summary: string }
  | { ok: false; reason: string; summary: string };

/** A tool as the model sees it (Responses API function tool) plus its handler. */
export interface Tool {
  name: string;
  /** States the rule its handler enforces, for this level. */
  description: (level: Level) => string;
  /** Shape only (spec §2): types and required fields. Rules live in the handler. */
  parameters: Record<string, unknown>;
  handle: (args: unknown, ctx: ToolContext) => HandlerResult;
}

export function refuse(reason: string, summary: string): HandlerResult {
  return { ok: false, reason, summary };
}

export function obj(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : undefined;
}

/** How the eligible text is named in refusals, so the reason matches the level. */
export function whereFrom(level: Level): string {
  return level === 0 ? "your messages" : "your messages or draft";
}

/**
 * Refusal for a piece that isn't in the eligible text on whole-word boundaries. Says
 * so when the words are there but only inside longer words, so the model can retry.
 */
export function notFoundReason(piece: string, level: Level, inside: string | undefined): string {
  return inside
    ? `${quote(piece)} is in ${whereFrom(level)} only inside longer words (${quote(inside)}). Quote whole words, exactly as typed.`
    : `${quote(piece)} is not in ${whereFrom(level)}.`;
}

export function quote(text: string): string {
  return `"${text.length > 80 ? `${text.slice(0, 77)}…` : text}"`;
}
