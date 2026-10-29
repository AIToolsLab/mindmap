/** Assistance level. L3 (checks off) is planned, not built: see docs/tools-first-pass.md §3. */
export type Level = 0 | 1 | 2;

/** One message the writer sent, exactly as typed. The model's messages never go here. */
export interface WriterMessage {
  turn: number;
  text: string;
}

/** What the handlers check against: the writer's own words, kept by the app. */
export interface WriterRecord {
  messages: WriterMessage[];
  draft: string;
}

/**
 * Where a card's words came from. Always set by code from what a handler found,
 * never passed by the model.
 */
export type Provenance =
  | { kind: "user" }
  | { kind: "combined"; messages: number }
  | { kind: "draft" }
  | { kind: "ai_suggested" };

export interface AdoptionTrace {
  /** Suggestion proposal whose wording this card took on (the original influence). */
  adoptedFrom: string;
  currentOverlap: number;
  peakOverlap: number;
}

export interface Card {
  id: string;
  text: string;
  parentId: string | null;
  provenance: Provenance;
  x: number;
  y: number;
  adoption?: AdoptionTrace;
}

export interface Link {
  id: string;
  from: string;
  to: string;
  label: string;
  provenance: { kind: "user" } | { kind: "ai_suggested" };
}

export interface MapState {
  cards: Card[];
  links: Link[];
}

export type ProposalStatus = "pending" | "accepted" | "rejected" | "dropped";

interface ProposalBase {
  id: string;
  status: ProposalStatus;
  /** Why a proposal was dropped (its card was rejected, or it no longer fits the map). */
  note?: string;
}

export type Proposal =
  | (ProposalBase & { kind: "card"; text: string; provenance: Provenance; cardId?: string })
  | (ProposalBase & { kind: "link"; from: string; to: string; label: string; provenance: Link["provenance"] })
  | (ProposalBase & { kind: "nest"; child: string; parent: string })
  | (ProposalBase & { kind: "suggestion"; text: string; nearCard: string | null; cardId?: string });

/** What the chat shows. Tool lines are part of the transcript, refusals included. */
export type TranscriptItem =
  | { kind: "writer"; text: string }
  | { kind: "coach"; text: string }
  | { kind: "tool"; name: string; summary: string; ok: boolean; reason?: string; proposalId?: string }
  | { kind: "notice"; text: string };

/** Responses API input items we keep for later turns (no reasoning items). */
export type HistoryItem =
  | { role: "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export interface Settings {
  suggestionAdoption: boolean;
}

export interface Session {
  level: Level;
  settings: Settings;
  record: WriterRecord;
  map: MapState;
  proposals: Proposal[];
  transcript: TranscriptItem[];
  history: HistoryItem[];
  /** Writer decisions on proposals the model hasn't been told about yet. */
  decisions: string[];
  counters: { card: number; link: number; proposal: number; turn: number };
  /** Map snapshots for undo, newest last. */
  undo: MapState[];
}

export function emptySession(): Session {
  return {
    level: 0,
    settings: { suggestionAdoption: true },
    record: { messages: [], draft: "" },
    map: { cards: [], links: [] },
    proposals: [],
    transcript: [],
    history: [],
    decisions: [],
    counters: { card: 0, link: 0, proposal: 0, turn: 0 },
    undo: [],
  };
}
