/**
 * Mistake capture controls — Stage 1 tap + Stage 2 watch.
 * Binding: docs/screen-capture-mistakes-spec.md §10
 */
import { GlassCard, SectionLabel, cn } from "@/gurukul/components/shared";
import type { ScreenCaptureMistakesApi } from "@/hooks/useScreenCaptureMistakes";

export function ScreenCaptureMistakesCard({ api }: { api: ScreenCaptureMistakesApi }) {
  if (!api.available) return null;

  const c = api.counters;

  return (
    <GlassCard className="p-5">
      <SectionLabel>Capture mistakes from other apps</SectionLabel>
      <p className="text-xs text-muted-foreground mb-4">
        Tap when you get one wrong, or start a watch session. Frames from apps
        you have not allowed never leave the phone.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={api.busy}
          onClick={() => void api.showTap()}
          className={cn(
            "px-3 py-2 rounded-xl text-xs font-semibold border border-border/70",
            "bg-surface/60 hover:bg-surface text-foreground disabled:opacity-50",
          )}
        >
          Show tap button
        </button>
        <button
          type="button"
          disabled={api.busy}
          onClick={() => void api.hideTap()}
          className={cn(
            "px-3 py-2 rounded-xl text-xs font-semibold border border-border/70",
            "bg-surface/40 text-muted-foreground disabled:opacity-50",
          )}
        >
          Hide tap
        </button>
        {!api.watching ? (
          <button
            type="button"
            disabled={api.busy}
            onClick={() => void api.startWatch()}
            className={cn(
              "px-3 py-2 rounded-xl text-xs font-semibold border border-primary/30",
              "bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50",
            )}
          >
            Start watch session
          </button>
        ) : (
          <button
            type="button"
            disabled={api.busy}
            onClick={() => void api.stopWatch()}
            className={cn(
              "px-3 py-2 rounded-xl text-xs font-semibold border border-destructive/30",
              "bg-destructive/10 text-destructive disabled:opacity-50",
            )}
          >
            Stop watching
          </button>
        )}
      </div>
      {c && (c.frames_seen > 0 || api.watching) && (
        <div className="mt-3 text-[10px] text-muted-foreground font-mono">
          seen {c.frames_seen} · drop §5.1 {c.dropped_at_5_1} · §5.2 {c.dropped_at_5_2} ·
          §5.3 {c.dropped_at_5_3} · §5.4 {c.dropped_at_5_4} · sent {c.sent}
          {Number.isFinite(c.frames_sent_per_hour)
            ? ` · ~${c.frames_sent_per_hour.toFixed(1)}/hr`
            : ""}
        </div>
      )}
      {api.allowedPackages.length > 0 && (
        <div className="mt-2 text-[10px] text-muted-foreground">
          Allowed: {api.allowedPackages.join(", ")}
        </div>
      )}
    </GlassCard>
  );
}
