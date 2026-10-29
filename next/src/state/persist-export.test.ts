import { describe, expect, it } from "vitest";
import { mapToMarkdown } from "./export";
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
