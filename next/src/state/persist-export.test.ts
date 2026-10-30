import { describe, expect, it } from "vitest";
import { mapToMarkdown } from "./export";
import { proposalLabel } from "./labels";
import { loadSession, saveSession, STORAGE_KEY } from "./persist";
import { emptySession, type MapState } from "./types";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("browser saving", () => {
  it("saves and loads a session", () => {
    const storage = memoryStorage();
    const s = { ...emptySession(), level: 2 as const, record: { messages: [{ turn: 1, text: "hi" }], draft: "d" } };
    expect(saveSession(s, storage)).toBe(true);
    expect(loadSession(storage)).toEqual(s);
  });

  it("starts fresh on missing, malformed or wrong-shaped data", () => {
    expect(loadSession(memoryStorage())).toEqual(emptySession());
    expect(loadSession(memoryStorage({ [STORAGE_KEY]: "{not json" }))).toEqual(emptySession());
    expect(loadSession(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ level: 7 }) }))).toEqual(emptySession());
  });

  it("reports failure instead of throwing when storage is missing or blocked", () => {
    const blocked = { ...memoryStorage(), setItem: () => { throw new Error("QuotaExceeded"); } } as Storage;
    expect(saveSession(emptySession(), blocked)).toBe(false);
    expect(saveSession(emptySession(), undefined)).toBe(false);
  });
});

describe("copy map", () => {
  it("writes nesting as an indented list, then links, with provenance marks", () => {
    const map: MapState = {
      cards: [
        { id: "c1", text: "Money", parentId: null, provenance: { kind: "user" }, x: 0, y: 0 },
        { id: "c2", text: "Rent", parentId: "c1", parentProvenance: { kind: "ai_suggested" }, provenance: { kind: "combined", messages: 2 }, x: 0, y: 0 },
        { id: "c3", text: "Time", parentId: null, provenance: { kind: "draft" }, x: 0, y: 0 },
      ],
      links: [{ id: "l1", from: "c1", to: "c3", label: "outweighs", provenance: { kind: "ai_suggested" } }],
    };
    expect(mapToMarkdown(map)).toBe([
      "# Map",
      "",
      "- Money",
      "  - Rent _(From 2 messages; nesting AI suggested)_",
      "- Time _(From your draft)_",
      "",
      "## Links",
      "",
      "- Money → outweighs → Time _(AI suggested)_",
    ].join("\n"));
  });
});

describe("proposal labels in the chat", () => {
  it("shows the label the proposal will carry on the map", () => {
    const base = { id: "p1", status: "pending" as const };
    expect(proposalLabel({ ...base, kind: "card", text: "A", provenance: { kind: "combined", messages: 2 }, sources: [] })).toBe("From 2 messages");
    expect(proposalLabel({ ...base, kind: "card", text: "A", provenance: { kind: "draft" }, sources: [] })).toBe("From your draft");
    expect(proposalLabel({ ...base, kind: "card", text: "A", provenance: { kind: "user" }, sources: [] })).toBeNull();
    expect(proposalLabel({ ...base, kind: "suggestion", text: "B", nearCard: null })).toBe("AI suggestion");
    expect(proposalLabel({ ...base, kind: "link", from: "c1", to: "c2", label: "so", provenance: { kind: "ai_suggested" } })).toBe("AI suggested");
    expect(proposalLabel({ ...base, kind: "nest", child: "c1", parent: "c2", provenance: { kind: "user" } })).toBeNull();
  });
});

describe("saved undo steps from before proposal states were kept", () => {
  it("are dropped on load instead of being replayed", () => {
    const old = { ...emptySession(), undo: [{ cards: [], links: [] }] };
    expect(loadSession(memoryStorage({ [STORAGE_KEY]: JSON.stringify(old) })).undo).toEqual([]);
  });
});
