import { useEffect, useRef, useState } from "react";

interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type SpeechConstructor = new () => SpeechRecognitionLike;

function appendTranscript(base: string, addition: string): string {
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) return base;
  if (!base.trim()) return trimmedAddition;
  return /\s$/.test(base) ? `${base}${trimmedAddition}` : `${base} ${trimmedAddition}`;
}

export function getSpeechConstructor(): SpeechConstructor | null {
  if (typeof window === "undefined") return null;

  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechConstructor;
    webkitSpeechRecognition?: SpeechConstructor;
  };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export interface SpeechToTextState {
  supported: boolean;
  listening: boolean;
  transcript: string;
  interim: string;
  start: (seedText?: string) => void;
  stop: () => void;
  reset: () => void;
}

/**
 * Browser speech-to-text (Web Speech API), copied from the current app's
 * `src/ui/useSpeechToText.ts` with two changes:
 * - After `reset()`, results are ignored until the next `start()`. `stop()` still
 *   delivers a final result for the words heard so far, and once the box has been sent
 *   and cleared that late result would otherwise refill it.
 * - `start()` right after `stop()` waits for the browser to end the previous session
 *   (its `end` event), because starting before then throws and nothing happened.
 */
export function useSpeechToText(): SpeechToTextState {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const discardRef = useRef(false);
  /** The browser's session is running: started, and its `end` event hasn't come yet. */
  const runningRef = useRef(false);
  /** `start()` was called while the previous session was still ending. */
  const restartRef = useRef(false);

  useEffect(() => {
    const Constructor = getSpeechConstructor();
    if (!Constructor) {
      setSupported(false);
      recognitionRef.current = null;
      return undefined;
    }

    setSupported(true);
    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      if (discardRef.current) return;
      let nextFinal = finalTranscriptRef.current;
      let nextInterim = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        if (result.isFinal) {
          nextFinal = appendTranscript(nextFinal, result[0].transcript);
        } else {
          nextInterim = appendTranscript(nextInterim, result[0].transcript);
        }
      }

      finalTranscriptRef.current = nextFinal;
      setTranscript(nextFinal);
      setInterim(nextInterim);
    };
    recognition.onend = () => {
      runningRef.current = false;
      if (!restartRef.current) {
        setListening(false);
        return;
      }
      restartRef.current = false;
      // The words the previous session was still finishing are already in the seed.
      discardRef.current = false;
      try {
        recognition.start();
        runningRef.current = true;
      } catch {
        setListening(false);
      }
    };
    // An error is followed by `end`, which starts a waiting restart.
    recognition.onerror = () => {
      if (!restartRef.current) setListening(false);
    };
    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.stop();
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    supported,
    listening,
    transcript,
    interim,
    start(seedText = "") {
      if (!recognitionRef.current || listening) return;
      const seededTranscript = seedText.trim();
      finalTranscriptRef.current = seededTranscript;
      setTranscript(seededTranscript);
      setInterim("");
      if (runningRef.current) {
        // Still ending: ignore its last results (the seed has them) and start on `end`.
        discardRef.current = true;
        restartRef.current = true;
        setListening(true);
        return;
      }
      discardRef.current = false;
      try {
        recognitionRef.current.start();
        runningRef.current = true;
        setListening(true);
      } catch {
        setListening(false);
      }
    },
    stop() {
      restartRef.current = false;
      recognitionRef.current?.stop();
      setListening(false);
    },
    reset() {
      discardRef.current = true;
      finalTranscriptRef.current = "";
      setTranscript("");
      setInterim("");
    },
  };
}
