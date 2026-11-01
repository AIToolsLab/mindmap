// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSpeechToText, type SpeechToTextState } from "./useSpeechToText";

interface MockSpeechChunk {
  transcript: string;
  isFinal: boolean;
}

class MockSpeechRecognition {
  static latest: MockSpeechRecognition | null = null;

  continuous = false;
  interimResults = false;
  onresult:
    | ((event: Event & {
        resultIndex: number;
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      }) => void)
    | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  start() {
    MockSpeechRecognition.latest = this;
  }

  stop() {
    this.onend?.();
  }

  emitResult(chunks: MockSpeechChunk[]) {
    const results = chunks.map((chunk) => ({
      0: { transcript: chunk.transcript },
      isFinal: chunk.isFinal,
    }));
    this.onresult?.({
      resultIndex: 0,
      results,
    } as unknown as Event & {
      resultIndex: number;
      results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
    });
  }

  emitError() {
    this.onerror?.();
  }
}

/** Like the browser: stop() ends the session later, and start() throws until it has. */
class SlowEndSpeechRecognition extends MockSpeechRecognition {
  running = false;
  starts = 0;

  start() {
    if (this.running) throw new Error("InvalidStateError");
    this.running = true;
    this.starts += 1;
    super.start();
  }

  stop() {}

  finishEnding() {
    this.running = false;
    this.onend?.();
  }
}

function Harness({ onChange }: { onChange: (state: SpeechToTextState) => void }) {
  onChange(useSpeechToText());
  return null;
}

describe("useSpeechToText", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestState: SpeechToTextState;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    MockSpeechRecognition.latest = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    delete (window as Window & { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition;
    delete (window as Window & { webkitSpeechRecognition?: typeof MockSpeechRecognition }).webkitSpeechRecognition;
  });

  function renderHarness() {
    act(() => {
      root.render(
        <Harness
          onChange={(state) => {
            latestState = state;
          }}
        />,
      );
    });
  }

  it("reports unsupported when no browser speech API exists", () => {
    renderHarness();

    expect(latestState.supported).toBe(false);
    expect(latestState.listening).toBe(false);
  });

  it("detects browser speech support and splits final from interim transcript", () => {
    (window as Window & { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition =
      MockSpeechRecognition;

    renderHarness();

    expect(latestState.supported).toBe(true);

    act(() => {
      latestState.start("Existing thought");
    });

    expect(latestState.listening).toBe(true);
    expect(latestState.transcript).toBe("Existing thought");

    act(() => {
      MockSpeechRecognition.latest?.emitResult([
        { transcript: "new final idea", isFinal: true },
        { transcript: "more to come", isFinal: false },
      ]);
    });

    expect(latestState.transcript).toBe("Existing thought new final idea");
    expect(latestState.interim).toBe("more to come");
  });

  it("ignores the late final result after reset, until the next start", () => {
    (window as Window & { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition =
      MockSpeechRecognition;

    renderHarness();

    act(() => {
      latestState.start();
    });

    act(() => {
      MockSpeechRecognition.latest?.emitResult([{ transcript: "words being said", isFinal: false }]);
    });

    // Sending: stop, then clear. The browser still delivers the final result after stop().
    act(() => {
      latestState.stop();
      latestState.reset();
    });

    act(() => {
      MockSpeechRecognition.latest?.emitResult([{ transcript: "words being said", isFinal: true }]);
    });

    expect(latestState.transcript).toBe("");
    expect(latestState.interim).toBe("");

    act(() => {
      latestState.start();
    });

    act(() => {
      MockSpeechRecognition.latest?.emitResult([{ transcript: "next thought", isFinal: true }]);
    });

    expect(latestState.transcript).toBe("next thought");
  });

  it("starting again before the previous session has ended waits for it, then listens", () => {
    (window as Window & { SpeechRecognition?: typeof SlowEndSpeechRecognition }).SpeechRecognition =
      SlowEndSpeechRecognition;

    renderHarness();

    act(() => {
      latestState.start();
    });
    const recognition = MockSpeechRecognition.latest as SlowEndSpeechRecognition;

    act(() => {
      recognition.emitResult([{ transcript: "hello there", isFinal: false }]);
    });

    // Mic off, then straight back on with the box's text as the seed.
    act(() => {
      latestState.stop();
    });
    act(() => {
      latestState.start("hello there");
    });

    expect(latestState.listening).toBe(true);
    expect(recognition.starts).toBe(1);

    // The ending session's final result is already in the seed, so it isn't added twice.
    act(() => {
      recognition.emitResult([{ transcript: "hello there", isFinal: true }]);
    });

    expect(latestState.transcript).toBe("hello there");

    act(() => {
      recognition.finishEnding();
    });

    expect(recognition.starts).toBe(2);
    expect(latestState.listening).toBe(true);

    act(() => {
      recognition.emitResult([{ transcript: "and more", isFinal: true }]);
    });

    expect(latestState.transcript).toBe("hello there and more");
  });

  it("stopping while a restart waits cancels it", () => {
    (window as Window & { SpeechRecognition?: typeof SlowEndSpeechRecognition }).SpeechRecognition =
      SlowEndSpeechRecognition;

    renderHarness();

    act(() => {
      latestState.start();
    });
    const recognition = MockSpeechRecognition.latest as SlowEndSpeechRecognition;

    act(() => {
      latestState.stop();
    });
    act(() => {
      latestState.start();
    });
    act(() => {
      latestState.stop();
    });
    act(() => {
      recognition.finishEnding();
    });

    expect(recognition.starts).toBe(1);
    expect(latestState.listening).toBe(false);
  });

  it("reset clears transcript state", () => {
    (window as Window & { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition =
      MockSpeechRecognition;

    renderHarness();

    act(() => {
      latestState.start("Seed text");
    });

    act(() => {
      MockSpeechRecognition.latest?.emitResult([{ transcript: "confirmed words", isFinal: true }]);
    });

    act(() => {
      latestState.reset();
    });

    expect(latestState.transcript).toBe("");
    expect(latestState.interim).toBe("");
  });

  it("clears listening state on stop and error", () => {
    (window as Window & { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition =
      MockSpeechRecognition;

    renderHarness();

    act(() => {
      latestState.start();
    });

    expect(latestState.listening).toBe(true);

    act(() => {
      latestState.stop();
    });

    expect(latestState.listening).toBe(false);

    act(() => {
      latestState.start();
    });

    expect(latestState.listening).toBe(true);

    act(() => {
      MockSpeechRecognition.latest?.emitError();
    });

    expect(latestState.listening).toBe(false);
  });
});
