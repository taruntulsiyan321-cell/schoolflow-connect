import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The student's voice, as text — the browser's own speech recognition.
 *
 * Chrome (desktop and Android), Edge and Safari have it; Firefox does not. The
 * caller checks `supported` and offers typing instead. Nothing is recorded or
 * uploaded by this app: the browser returns text and only the text is sent.
 *
 * ── When does an answer end? ─────────────────────────────────────────────
 * The student taps to finish, OR stops talking: `silenceMs` after the last
 * word the answer is sent on its own. That is the "when the student stops, the
 * app understands" behaviour. Pausing to think for a second or two does not
 * end it.
 *
 * ── Two browser quirks this handles ──────────────────────────────────────
 * 1. Android Chrome ends a session on its own after a short pause, even in
 *    continuous mode. An end the student did not ask for is restarted, and the
 *    words so far are carried over, so their answer is not cut in half.
 * 2. Android Chrome can report each final result CUMULATIVELY ("the",
 *    "the hypotenuse", "the hypotenuse is…"). A final that starts with the
 *    previous one replaces it instead of being appended.
 */

type Alternative = { transcript: string };
type ResultLike = { isFinal: boolean; 0: Alternative; length: number };
type ResultEventLike = { resultIndex: number; results: ArrayLike<ResultLike> };
export type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: ResultEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => RecognitionLike;

export type CaptureError = "denied" | "no-speech" | "network" | "failed";

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Drops a segment when the next one starts with it — Android's cumulative finals. */
export function mergeFinals(segments: string[]): string[] {
  const out: string[] = [];
  for (const raw of segments) {
    const s = raw.trim();
    if (!s) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && s.toLowerCase().startsWith(prev.toLowerCase())) out[out.length - 1] = s;
    else out.push(s);
  }
  return out;
}

const MAX_RESTARTS = 12;

function orderedFinals(finals: Map<number, string>): string[] {
  return [...finals.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

export function useSpeechCapture(opts: {
  lang?: string;
  /** Silence after the last word that ends the answer. */
  silenceMs?: number;
  /** Silence at the very start after which we give up — nothing was said. */
  startSilenceMs?: number;
  /** Hard cap on one answer. */
  maxMs?: number;
  onDone: (text: string) => void;
  onError: (error: CaptureError) => void;
}) {
  const { lang = "en-IN", silenceMs = 3500, startSilenceMs = 9000, maxMs = 120_000 } = opts;
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const supported = getRecognitionCtor() !== null;

  const onDoneRef = useRef(opts.onDone);
  const onErrorRef = useRef(opts.onError);
  onDoneRef.current = opts.onDone;
  onErrorRef.current = opts.onError;

  const recRef = useRef<RecognitionLike | null>(null);
  /** Text from sessions that ended and were restarted. */
  const carriedRef = useRef<string[]>([]);
  /** Final results of the current session, by result index. */
  const finalsRef = useRef<Map<number, string>>(new Map());
  const interimRef = useRef("");
  const wantStopRef = useRef(false);
  const cancelledRef = useRef(false);
  const errorRef = useRef<CaptureError | null>(null);
  const restartsRef = useRef(0);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const compose = useCallback(
    () => mergeFinals([...carriedRef.current, ...orderedFinals(finalsRef.current), interimRef.current]).join(" "),
    [],
  );

  const clearTimers = useCallback(() => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (capTimer.current) clearTimeout(capTimer.current);
    silenceTimer.current = null;
    capTimer.current = null;
  }, []);

  const finish = useCallback(() => {
    wantStopRef.current = true;
    clearTimers();
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, [clearTimers]);

  const armSilence = useCallback(
    (ms: number) => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(finish, ms);
    },
    [finish],
  );

  const open = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return false;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    finalsRef.current = new Map();
    interimRef.current = "";

    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r?.[0]?.transcript ?? "";
        if (r.isFinal) finalsRef.current.set(i, text);
        else interim += text;
      }
      interimRef.current = interim;
      setTranscript(compose());
      armSilence(silenceMs);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        errorRef.current = "denied";
        wantStopRef.current = true;
      } else if (e.error === "network") {
        errorRef.current = "network";
        wantStopRef.current = true;
      } else if (e.error === "audio-capture") {
        errorRef.current = "failed";
        wantStopRef.current = true;
      }
      // "no-speech" and "aborted" end the session; onend decides what that means.
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      if (!wantStopRef.current && !cancelledRef.current && restartsRef.current < MAX_RESTARTS) {
        // An end the student did not ask for (quirk 1). Keep the words, go again.
        carriedRef.current = mergeFinals([...carriedRef.current, ...orderedFinals(finalsRef.current), interimRef.current]);
        restartsRef.current += 1;
        if (open()) return;
      }
      clearTimers();
      recRef.current = null;
      setListening(false);
      if (cancelledRef.current) return;
      const text = compose().trim();
      if (text) onDoneRef.current(text);
      else onErrorRef.current(errorRef.current ?? "no-speech");
    };

    recRef.current = rec;
    try {
      rec.start();
      return true;
    } catch {
      recRef.current = null;
      return false;
    }
  }, [armSilence, clearTimers, compose, lang, silenceMs]);

  const start = useCallback(() => {
    if (recRef.current) return;
    carriedRef.current = [];
    wantStopRef.current = false;
    cancelledRef.current = false;
    errorRef.current = null;
    restartsRef.current = 0;
    setTranscript("");
    if (!open()) {
      onErrorRef.current("failed");
      return;
    }
    setListening(true);
    armSilence(startSilenceMs);
    capTimer.current = setTimeout(finish, maxMs);
  }, [armSilence, finish, maxMs, open, startSilenceMs]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    wantStopRef.current = true;
    clearTimers();
    const rec = recRef.current;
    recRef.current = null;
    try {
      rec?.abort();
    } catch {
      /* already gone */
    }
    setListening(false);
    setTranscript("");
  }, [clearTimers]);

  useEffect(() => cancel, [cancel]);

  return { supported, listening, transcript, start, finish, cancel };
}
