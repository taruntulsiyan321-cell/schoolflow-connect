import { useCallback, useEffect, useRef, useState } from "react";
import { VOICE_MAX_SECONDS } from "@/lib/questionMarks";

/**
 * Records one voice note of at most VOICE_MAX_SECONDS, then stops by itself.
 *
 * This keeps the AUDIO — the student hears their own explanation back. It is
 * not useSpeechCapture, which turns speech into text and keeps nothing.
 */
export type VoiceRecorderState = "idle" | "recording" | "recorded";
export type VoiceRecorderError = "denied" | "no_mic" | "too_short" | "failed";

export const VOICE_RECORDER_MESSAGES: Record<VoiceRecorderError, string> = {
  denied: "Allow the microphone for this site to record a voice note.",
  no_mic: "No microphone was found.",
  too_short: "That was too short — hold on a moment longer.",
  failed: "The recording didn't work. Please try again.",
};

/** 32 kbit/s: a minute of speech is ~240 KB, well inside the bucket's cap. */
const BITS_PER_SECOND = 32_000;
const MIN_MS = 700;
const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

export function voiceRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

function pickType(): string | undefined {
  const can = window.MediaRecorder.isTypeSupported?.bind(window.MediaRecorder);
  return can ? PREFERRED_TYPES.find((t) => can(t)) : undefined;
}

export function useVoiceNoteRecorder() {
  const supported = voiceRecordingSupported();
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<VoiceRecorderError | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const startedAt = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    if (limit.current) clearTimeout(limit.current);
    ticker.current = null;
    limit.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (!supported || state === "recording") return;
    setError(null);
    setBlob(null);
    setSeconds(0);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "no_mic" : "failed");
      return;
    }
    stream.current = media;
    const type = pickType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(media, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: BITS_PER_SECOND });
    } catch {
      release();
      setError("failed");
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };
    rec.onstop = () => {
      const elapsed = Date.now() - startedAt.current;
      release();
      recorder.current = null;
      const out = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
      if (elapsed < MIN_MS || out.size === 0) {
        setState("idle");
        setSeconds(0);
        setError("too_short");
        return;
      }
      setSeconds(Math.min(VOICE_MAX_SECONDS, Math.max(1, Math.round(elapsed / 1000))));
      setBlob(out);
      setState("recorded");
    };
    recorder.current = rec;
    startedAt.current = Date.now();
    rec.start();
    setState("recording");
    ticker.current = setInterval(() => {
      setSeconds(Math.min(VOICE_MAX_SECONDS, Math.floor((Date.now() - startedAt.current) / 1000)));
    }, 250);
    limit.current = setTimeout(() => stop(), VOICE_MAX_SECONDS * 1000);
  }, [supported, state, release, stop]);

  // Throws away a recording, or one still being made: its onstop is detached
  // first, or it would land as "recorded" after the student said no.
  const discard = useCallback(() => {
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    recorder.current = null;
    release();
    setBlob(null);
    setSeconds(0);
    setError(null);
    setState("idle");
  }, [release]);

  // Leaving the screen mid-recording lets go of the microphone.
  useEffect(() => () => {
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    release();
  }, [release]);

  return { supported, state, seconds, blob, error, start, stop, discard };
}
