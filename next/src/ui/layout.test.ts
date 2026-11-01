import { describe, expect, it } from "vitest";
import { clampDraftWidth, DRAFT_WIDTH_MIN, MAP_MIN_WIDTH } from "./DraftResizer";

describe("draft width", () => {
  const viewport = 1440;
  const chat = 432;

  it("keeps a width that fits", () => {
    expect(clampDraftWidth(500, viewport, chat)).toBe(500);
  });

  it("never goes below the minimum", () => {
    expect(clampDraftWidth(100, viewport, chat)).toBe(DRAFT_WIDTH_MIN);
  });

  it("stops where the map would get narrower than its minimum", () => {
    expect(clampDraftWidth(5000, viewport, chat)).toBe(viewport - chat - MAP_MIN_WIDTH);
  });

  it("keeps the minimum even when the window is too narrow for both", () => {
    expect(clampDraftWidth(400, 800, 340)).toBe(DRAFT_WIDTH_MIN);
  });
});
