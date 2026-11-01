import { useRef, type KeyboardEvent, type PointerEvent } from "react";

export const DRAFT_WIDTH_DEFAULT = 320;
export const DRAFT_WIDTH_MIN = 240;
/** However wide the draft gets, the map keeps at least this much room. */
export const MAP_MIN_WIDTH = 280;
const KEY_STEP = 24;
const STORAGE_KEY = "mindmap-next:draft-width:v1";

/** A draft width within bounds, next to a chat column `chatWidth` wide in a window `viewport` wide. */
export function clampDraftWidth(width: number, viewport: number, chatWidth: number): number {
  const max = Math.max(DRAFT_WIDTH_MIN, viewport - chatWidth - MAP_MIN_WIDTH);
  return Math.round(Math.min(Math.max(width, DRAFT_WIDTH_MIN), max));
}

/** The writer's last draft width in this browser. A layout preference, kept apart from the session. */
export function loadDraftWidth(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved >= DRAFT_WIDTH_MIN ? saved : DRAFT_WIDTH_DEFAULT;
  } catch {
    return DRAFT_WIDTH_DEFAULT;
  }
}

export function saveDraftWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // No storage: the width just isn't remembered.
  }
}

function chatWidth(el: Element): number {
  return el.closest(".app")?.querySelector(".chat")?.getBoundingClientRect().width ?? 340;
}

/**
 * The draft's width as drawn. It can be less than the saved width when the window got
 * narrower (CSS min()), and resizing has to start from what the writer sees.
 */
function drawnWidth(el: Element, saved: number): number {
  return el.closest(".draft")?.getBoundingClientRect().width || saved;
}

/**
 * The draft panel's left edge: drag it to make the draft wider or narrower, use the
 * arrow keys when it has focus, or double-click it to go back to the default width.
 */
export function DraftResizer({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number; chat: number } | null>(null);

  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    document.body.classList.remove("resizing");
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The panel is on the right, so moving its edge left makes it wider.
    const change = e.key === "ArrowLeft" ? KEY_STEP : e.key === "ArrowRight" ? -KEY_STEP : 0;
    if (!change) return;
    e.preventDefault();
    onResize(clampDraftWidth(drawnWidth(e.currentTarget, width) + change, window.innerWidth, chatWidth(e.currentTarget)));
  };

  return (
    <div
      className="draft-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the draft panel"
      aria-valuenow={width}
      aria-valuemin={DRAFT_WIDTH_MIN}
      tabIndex={0}
      title="Drag to resize the draft · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width: drawnWidth(e.currentTarget, width), chat: chatWidth(e.currentTarget) };
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) onResize(clampDraftWidth(d.width + (d.x - e.clientX), window.innerWidth, d.chat));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onResize(DRAFT_WIDTH_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  );
}
