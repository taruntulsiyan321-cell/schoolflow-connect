import { useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { formatClock, voiceNoteUrl } from "@/lib/questionMarks";
import { cn } from "@/lib/utils";

/**
 * A recording in the private bucket. The link is asked for on the first tap,
 * not when the list renders: a screen of twenty marks must not sign twenty.
 */
export function VoiceNotePlayer({ path, seconds, className }: { path: string; seconds: number | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (url) {
    return <audio controls autoPlay src={url} className={cn("h-9 w-full max-w-xs", className)} aria-label="Your voice note" />;
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setFailed(false);
        try {
          setUrl(await voiceNoteUrl(path));
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-60",
        className,
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Mic className="h-3.5 w-3.5" aria-hidden />}
      {failed ? "Couldn't load — tap to retry" : `Play voice note${seconds ? ` (${formatClock(seconds)})` : ""}`}
    </button>
  );
}
