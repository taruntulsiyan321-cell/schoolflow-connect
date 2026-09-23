import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, Check, ChevronLeft, Loader2, Mic, MicOff, Sparkles, Square, Volume2, VolumeX,
} from "lucide-react";
import { cn } from "@/gurukul/components/shared";
import {
  sendRevisionAnswer,
  type RevisionGist, type RevisionTurn,
} from "./novaRevisionClient";
import { useSpeechCapture, type CaptureError } from "./useSpeechCapture";
import { useNovaSpeaker } from "./useNovaSpeaker";

/**
 * Step 2 of revision mode: the Feynman test. Nova asks, the student explains
 * out loud, Nova judges which key ideas that explanation covered and
 * cross-questions on what is missing or wrong — until every idea is explained
 * or the student finishes.
 *
 * Answers are SPOKEN ONLY. There is no text box, by product decision: the point
 * of the exercise is saying it in your own words, and typing lets a student
 * paste the gist back. A browser without speech recognition gets a screen that
 * says so, not a keyboard.
 */

type NovaLine = { id: number; role: "nova"; feedback: string; misconception: string | null; question: string };
type StudentLine = { id: number; role: "student"; text: string };
type Line = NovaLine | StudentLine;

export type TestOutcome = { covered: number[]; corrections: string[]; answers: number };

const CAPTURE_NOTICE: Record<CaptureError, string> = {
  denied: "Microphone access is blocked. Allow it in your browser's site settings, then tap the mic again.",
  "no-speech": "I didn't hear anything. Tap the mic and try again.",
  network: "Voice needs an internet connection. Check it, then tap the mic again.",
  failed: "The microphone couldn't start. Check no other app is using it, then tap the mic again.",
};

/** What the server is told about a line — the same words the student saw. */
function toTurn(line: Line): RevisionTurn {
  if (line.role === "student") return { role: "student", text: line.text };
  return { role: "nova", text: [line.feedback, line.misconception, line.question].filter(Boolean).join(" ") };
}

export function FeynmanTest({
  gist,
  subject,
  grade,
  onBack,
  onFinish,
}: {
  gist: RevisionGist;
  subject: string;
  grade: string;
  onBack: () => void;
  onFinish: (outcome: TestOutcome) => void;
}) {
  const nextId = useRef(1);
  const [lines, setLines] = useState<Line[]>(() => [
    { id: 0, role: "nova", feedback: "", misconception: null, question: gist.opening_question },
  ]);
  const [covered, setCovered] = useState<number[]>([]);
  const [corrections, setCorrections] = useState<string[]>([]);
  const [status, setStatus] = useState<"ready" | "thinking" | "error" | "complete">("ready");
  const [errorText, setErrorText] = useState("");
  const [notice, setNotice] = useState("");
  const pendingRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const speaker = useNovaSpeaker();
  const capture = useSpeechCapture({
    onDone: (text) => submit(text),
    onError: (e) => setNotice(CAPTURE_NOTICE[e]),
  });
  // Read the opening question once. speak() cancels anything already playing,
  // so a second run of this effect cannot stack two voices.
  const { speak } = speaker;
  useEffect(() => {
    speak(gist.opening_question);
  }, [gist.opening_question, speak]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [lines, status, capture.transcript]);

  async function ask(answer: string, history: RevisionTurn[]) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("thinking");
    setErrorText("");
    const result = await sendRevisionAnswer(
      { topic: gist.title, subject, grade, points: gist.key_points, covered, history, answer },
      controller.signal,
    );
    if (!result) return; // left the screen
    if (!result.ok) {
      setStatus("error");
      setErrorText(result.error);
      return;
    }
    const turn = result.value;
    pendingRef.current = null;
    setLines((ls) => [
      ...ls,
      { id: nextId.current++, role: "nova", feedback: turn.feedback, misconception: turn.misconception, question: turn.next_question },
    ]);
    setCovered(turn.covered);
    if (turn.misconception) setCorrections((cs) => [...cs, turn.misconception as string]);
    setStatus(turn.complete ? "complete" : "ready");
    speaker.speak(`${turn.feedback} ${turn.next_question}`);
  }

  function submit(text: string) {
    const answer = text.trim();
    if (!answer || status === "thinking" || status === "complete") return;
    speaker.stop();
    setNotice("");
    const history = lines.map(toTurn);
    pendingRef.current = answer;
    setLines((ls) => [...ls, { id: nextId.current++, role: "student", text: answer }]);
    void ask(answer, history);
  }

  function retry() {
    const answer = pendingRef.current;
    if (!answer) return;
    // The failed answer is already the last line; the history is everything before it.
    void ask(answer, lines.slice(0, -1).map(toTurn));
  }

  function toggleMic() {
    if (capture.listening) {
      capture.finish();
      return;
    }
    speaker.stop();
    setNotice("");
    capture.start();
  }

  const answers = lines.filter((l) => l.role === "student").length;
  const finish = () => {
    capture.cancel();
    speaker.stop();
    abortRef.current?.abort();
    onFinish({ covered, corrections, answers });
  };
  const lastNovaId = [...lines].reverse().find((l) => l.role === "nova")?.id;
  const busy = status === "thinking";

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { capture.cancel(); speaker.stop(); onBack(); }}
            aria-label="Back to the gist"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex min-w-0 items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{gist.title}</span>
          </span>
          <div className="flex-1" />
          {speaker.supported && (
            <button
              type="button"
              onClick={speaker.toggleMuted}
              aria-label={speaker.muted ? "Unmute Nova" : "Mute Nova"}
              aria-pressed={speaker.muted}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            >
              {speaker.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className={cn("h-4 w-4", speaker.speaking && "text-primary")} />}
            </button>
          )}
          <button
            type="button"
            onClick={finish}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground transition-all hover:bg-muted"
          >
            Finish
          </button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none" aria-label="Key ideas explained">
          <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
            {covered.length}/{gist.key_points.length} ideas
          </span>
          {gist.key_points.map((p, i) => {
            const done = covered.includes(i);
            return (
              <span
                key={i}
                data-testid={done ? "idea-done" : "idea-open"}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  done ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                )}
              >
                {done && <Check className="h-3 w-3" />}
                {done ? p.heading : `Idea ${i + 1}`}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
          {lines.map((l) =>
            l.role === "nova" ? (
              <div key={l.id} className="space-y-2 rounded-2xl border border-border/70 bg-surface p-4">
                {l.feedback && <p className="text-sm leading-relaxed text-muted-foreground">{l.feedback}</p>}
                {l.misconception && (
                  <p className="flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-foreground">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <span><span className="font-semibold">Correction: </span>{l.misconception}</span>
                  </p>
                )}
                <p className={cn("font-bold text-foreground", l.id === lastNovaId ? "text-lg leading-snug" : "text-sm")}>
                  {l.question}
                </p>
              </div>
            ) : (
              <div key={l.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-primary/15 px-4 py-2.5 text-sm text-foreground">
                  {l.text}
                </div>
              </div>
            ),
          )}

          {capture.listening && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl border border-dashed border-primary/40 px-4 py-2.5 text-sm italic text-foreground">
                {capture.transcript || "Listening…"}
              </div>
            </div>
          )}

          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> Nova is thinking…
            </div>
          )}

          {status === "error" && (
            <div role="alert" className="space-y-2 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
              <p>Nova couldn't reply: {errorText}</p>
              <button type="button" onClick={retry} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
                Try again
              </button>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-4 pb-4 pt-3">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2">
          {notice && <p className="text-center text-xs text-warning">{notice}</p>}

          {status === "complete" ? (
            <button
              type="button"
              onClick={finish}
              className="w-full rounded-2xl bg-success px-4 py-3.5 text-sm font-bold text-primary-foreground transition-all hover:bg-success/90"
            >
              Every idea explained — see how you did
            </button>
          ) : !capture.supported ? (
            <div role="alert" className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
              <MicOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                Revision mode is answered out loud, and this browser can't hear you. Open Gurukul in Chrome, Edge or
                Safari to take the Feynman test.
              </span>
            </div>
          ) : (
            <>
              <span className="text-[11px] text-muted-foreground">
                {busy ? "Nova is thinking…" : capture.listening ? "Tap to finish — or just stop talking" : "Tap to start"}
              </span>
              <button
                type="button"
                onClick={toggleMic}
                disabled={busy || status === "error"}
                aria-label={capture.listening ? "Finish answer" : "Start answering"}
                className={cn(
                  "relative flex h-16 w-16 items-center justify-center rounded-full shadow-card transition-all disabled:opacity-50",
                  capture.listening ? "bg-destructive text-destructive-foreground" : "bg-foreground text-background",
                )}
              >
                {capture.listening && <span className="absolute inset-0 animate-ping rounded-full bg-destructive/40" />}
                {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : capture.listening ? <Square className="relative h-6 w-6 fill-current" /> : <Mic className="h-7 w-7" />}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
