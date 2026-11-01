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
 * `src/ui/useSpeechToText.ts` with one change: after `reset()`, results are ignored
 * until the next `start()`. `stop()` still delivers a final result for the words
 * heard so far, and once the box has been sent and cleared that late result would
 * otherwise refill it.
 */
export function useSpeechToText(): SpeechToTextState {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const discardRef = useRef(false);

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
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
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
      discardRef.current = false;
      finalTranscriptRef.current = seededTranscript;
      setTranscript(seededTranscript);
      setInterim("");
      try {
        recognitionRef.current.start();
        setListening(true);
      } catch {
        setListening(false);
      }
    },
    stop() {
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
