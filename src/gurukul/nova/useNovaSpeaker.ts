import { useCallback, useEffect, useRef, useState } from "react";
import { novaVoiceMutedKey } from "@/lib/clientStorage";

/**
 * Nova reads its question aloud — the browser's own speech synthesis, so there
 * is no audio service and nothing leaves the device. Mute is remembered on
 * this device only; a student in a quiet classroom sets it once.
 */

function readMuted(): boolean {
  try {
    return localStorage.getItem(novaVoiceMutedKey()) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean) {
  try {
    localStorage.setItem(novaVoiceMutedKey(), muted ? "1" : "0");
  } catch {
    /* storage unavailable — the toggle still works for this visit */
  }
}

/** Markdown and the quote marks around a sentence starter read badly aloud. */
export function speakableText(text: string): string {
  return text.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
}

export function useNovaSpeaker(lang = "en-IN") {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  const [muted, setMuted] = useState(readMuted);
  const [speaking, setSpeaking] = useState(false);
  // speak() reads mute through a ref so its identity never changes with it.
  // Otherwise un-muting re-runs every effect that speaks — the opening
  // question was read out again — and a reply already in flight when the
  // student muted would still be spoken by the stale closure.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || mutedRef.current) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(speakableText(text));
      utterance.lang = lang;
      const voices = synth.getVoices();
      const voice =
        voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.toLowerCase().startsWith("en")) ?? null;
      if (voice) utterance.voice = voice;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setSpeaking(true);
      synth.speak(utterance);
    },
    [lang, supported],
  );

  const toggleMuted = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      writeMuted(next);
      if (next && supported) {
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
      return next;
    });
  }, [supported]);

  useEffect(() => stop, [stop]);

  return { supported, muted, speaking, speak, stop, toggleMuted };
}
