import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { premiumChanged, usePremiumStatus } from "@/hooks/usePremiumStatus";
import { refusalFor, usesLeft, type PlanLimit } from "@/lib/premium";
import {
  AI_PRACTICE_PROMPT_MAX,
  listRecentAIPractice,
  requestAIPractice,
  type AIPracticeHistoryItem,
  type AIPracticeResult,
} from "@/lib/aiPractice";
import { PlanLimitNotice } from "@/gurukul/components/PlanLimitNotice";
import { withAlpha } from "@/lib/colorAlpha";
import { cn } from "@/gurukul/components/shared";

const EXAMPLES = [
  "20 medium questions on goodwill valuation",
  "10 hard questions on ratio analysis",
  "15 questions on Fayol's principles of management",
  "Mixed questions on national income accounting",
];

/** What the student sees while the function works — it does not stream, so honest stages. */
const STAGES = [
  "Reading your request…",
  "Looking for matching questions in the bank…",
  "Writing new questions…",
  "Double-checking every answer…",
];

/**
 * AI Practice: the student says what to practise, in their own words, and
 * gets a session of it (owner's ruling 2026-10-02). The bank's questions come
 * first; new ones are written by AI and kept only when an independent check
 * reaches the same answer.
 */
export function AIPracticeRequest({
  accentColor,
  onReady,
}: {
  accentColor: string;
  onReady: (result: AIPracticeResult) => void;
}) {
  const { user } = useAuth();
  const { status: premium } = usePremiumStatus();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [planRefusal, setPlanRefusal] = useState<PlanLimit | null>(null);
  const [recent, setRecent] = useState<AIPracticeHistoryItem[]>([]);

  const planLimit = planRefusal ?? refusalFor(premium, "ai_practice.request");
  const left = usesLeft(premium, "ai_practice.request");

  useEffect(() => {
    if (!user) return;
    let gone = false;
    void listRecentAIPractice(user.id).then((r) => { if (!gone) setRecent(r); });
    return () => { gone = true; };
  }, [user]);

  useEffect(() => {
    if (!busy) return;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(STAGES.length - 1, s + 1)), 6000);
    return () => clearInterval(t);
  }, [busy]);

  async function submit() {
    const text = prompt.trim();
    if (text.length < 3 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await requestAIPractice(text);
      premiumChanged();
      if (!r.ok) {
        if (r.planLimit) setPlanRefusal(r.planLimit);
        else setMessage(r.error);
        return;
      }
      const { result } = r;
      if (result.status === "refused" || result.status === "failed" || result.questionIds.length === 0) {
        setMessage(result.message ?? "AI Practice couldn't make a session of that. Try asking a little differently.");
        return;
      }
      if (result.status === "short" && result.message) toast.message(result.message);
      onReady(result);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center gap-2 text-sm font-bold text-foreground">
          <Sparkles className="h-4 w-4" style={{ color: accentColor }} aria-hidden /> Tell AI what to practise
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Name a chapter or topic from your syllabus, and say how many questions and how hard, if you like.
          Questions from the bank come first; new ones are written by AI and kept only when a second check gets the same answer.
        </p>
        <label htmlFor="ai-practice-prompt" className="sr-only">What do you want to practise?</label>
        <textarea
          id="ai-practice-prompt"
          value={prompt}
          maxLength={AI_PRACTICE_PROMPT_MAX}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. 20 medium questions on goodwill valuation"
          rows={3}
          className="w-full resize-none rounded-xl border border-border bg-muted p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              disabled={busy}
              onClick={() => setPrompt(e)}
              className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50"
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {planLimit && <PlanLimitNotice limit={planLimit} />}

      <button
        type="button"
        disabled={busy || prompt.trim().length < 3 || planLimit !== null}
        onClick={() => void submit()}
        className={cn("flex w-full items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-bold transition-all disabled:opacity-50")}
        style={{ borderColor: withAlpha(accentColor, 0.3), background: withAlpha(accentColor, 0.08), color: accentColor }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
        {busy ? STAGES[stage] : "Make my practice session"}
      </button>
      {busy && <p className="text-center text-xs text-muted-foreground">This can take up to a minute when new questions are written.</p>}
      {!busy && !planLimit && left && <p className="text-xs text-muted-foreground">{left.note}</p>}
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}

      {recent.length > 0 && !busy && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Asked before</div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setPrompt(r.prompt)}
                className="max-w-full truncate rounded-lg border border-border bg-muted px-2.5 py-1 text-xs text-foreground hover:bg-secondary"
              >
                {r.prompt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
