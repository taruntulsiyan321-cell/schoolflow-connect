/**
 * Mistake capture controls — Stage 1 tap + Stage 2 watch.
 * Binding: docs/screen-capture-mistakes-spec.md §4 / §10 / §11
 */
import { GlassCard, SectionLabel, cn } from "@/gurukul/components/shared";
import type { ScreenCaptureMistakesApi } from "@/hooks/useScreenCaptureMistakes";

export function ScreenCaptureMistakesCard({ api }: { api: ScreenCaptureMistakesApi }) {
  if (!api.available) return null;

  const c = api.counters;

  return (
    <GlassCard className="p-5">
      <SectionLabel>Capture mistakes from other apps</SectionLabel>
      <p className="text-xs text-muted-foreground mb-3">
        Tap when you get one wrong, or start a watch session. Frames from apps
        you have not allowed never leave the phone. In test mode, open the
        solutions and Gurukul will pick up your mistakes.
      </p>

      {api.usageAccess === false && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-3">
          Usage access is off — required before watching. Grant it in Settings,
          then return here.
        </p>
      )}

      <div className="mb-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
          Allowed apps
        </div>
        <div className="flex flex-col gap-1.5">
          {api.knownApps.map((app) => {
            const on = api.allowedPackages.includes(app.package_name);
            return (
              <label
                key={app.package_name}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={api.busy}
                  onChange={(e) =>
                    void api.setAppAllowed(app.package_name, app.label, e.target.checked)
                  }
                  className="rounded border-border"
                />
                <span>{app.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono truncate">
                  {app.package_name}
                </span>
              </label>
            );
          })}
        </div>
        {api.allowedPackages.length === 0 && (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
            None selected — every frame is dropped on the phone until you allow an app.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={api.busy || api.watching}
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

      {api.watching && (
        <p className="mt-2 text-[11px] text-primary font-medium">
          Watching — keep the Gurukul overlay visible. Tap capture is paused.
        </p>
      )}

      {c && (c.frames_seen > 0 || api.watching) && (
        <div className="mt-3 text-[10px] text-muted-foreground font-mono">
          seen {c.frames_seen} · drop §5.1 {c.dropped_at_5_1} · §5.2 {c.dropped_at_5_2} ·
          §5.3 {c.dropped_at_5_3} · §5.4 {c.dropped_at_5_4}
          {typeof c.dropped_duplicate === "number" ? ` · dup ${c.dropped_duplicate}` : ""}
          {" "}· sent {c.sent}
          {Number.isFinite(c.frames_sent_per_hour)
            ? ` · ~${c.frames_sent_per_hour.toFixed(1)}/hr`
            : ""}
        </div>
      )}

      {api.lastResult?.capture_question_id && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground truncate flex-1">
            Last capture saved
            {api.lastResult.question_text
              ? `: ${api.lastResult.question_text.slice(0, 48)}…`
              : ""}
          </span>
          <button
            type="button"
            disabled={api.busy}
            onClick={() => void api.deleteCapture(api.lastResult!.capture_question_id!)}
            className="text-[10px] font-semibold text-destructive px-2 py-1 rounded-lg border border-destructive/30 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      )}
    </GlassCard>
  );
}
