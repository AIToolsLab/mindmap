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

/** Mark for model-made structure (a link, or a nesting) the writer accepted at L2. */
export type StructureProvenance = { kind: "user" } | { kind: "ai_suggested" };

/**
 * Where one piece of a card's text was found (spec §5.1): the most recent match, and
 * every match. Recorded by the handler, never passed by the model.
 */
export interface PieceSource {
  piece: string;
  /** Where the most recent match is: chat wins over the draft. */
  from: "chat" | "draft";
  /** Turn of the most recent chat match, or null when the piece is only in the draft. */
  turn: number | null;
  /** Every writer turn whose message contains the piece, most recent first. */
  allTurns: number[];
  /** Whether the current draft also contains it (L1 and L2 only). */
  inDraft: boolean;
}

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
  /** Set when the coach proposed this card's current nesting (L2) and the writer accepted it. */
  parentProvenance?: StructureProvenance;
  provenance: Provenance;
  /** Where the card's words came from, for cards proposed from the writer's words. */
  sources?: PieceSource[];
  /** Position, relative to the parent card when nested. */
  x: number;
  y: number;
  adoption?: AdoptionTrace;
}

export interface Link {
  id: string;
  from: string;
  to: string;
  label: string;
  provenance: StructureProvenance;
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
  | (ProposalBase & { kind: "card"; text: string; provenance: Provenance; sources: PieceSource[]; cardId?: string })
  | (ProposalBase & { kind: "link"; from: string; to: string; label: string; provenance: StructureProvenance })
  | (ProposalBase & { kind: "nest"; child: string; parent: string; provenance: StructureProvenance })
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

/**
 * One undo step: the map, plus each proposal's state at that moment, so undoing an
 * Accept also makes that proposal pending again.
 */
export interface UndoEntry {
  map: MapState;
  proposals: Pick<Proposal, "id" | "status" | "note">[];
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
  /** Undo steps, newest last. */
  undo: UndoEntry[];
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
