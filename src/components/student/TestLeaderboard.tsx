import { useEffect, useRef, useState } from "react";
import { Trophy, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { TestService } from "@/academic";
import { useAcademicLive } from "@/academic/live";
import type { ServiceContext } from "@/academic/services/context";
import type { TestLeaderboard as TestLeaderboardPayload } from "@/academic/services/testService";
import { toErrorMessage, toPersonName } from "@/lib/presentation";
import { cn } from "@/lib/utils";

/**
 * The floor, not the mechanism.
 *
 * `test_attempts` and `test_marks` publish to realtime (20260920080000), so a
 * classmate handing in wakes this board through `useAcademicLive` within a
 * second. This timer exists for when that does not arrive — a dropped socket,
 * a project with realtime off — because a leaderboard that silently stops
 * moving is worse than one that is a few seconds late.
 */
const POLL_MS = 30_000;

/**
 * The per-test leaderboard, and it moves while you watch it.
 *
 * ── WHY IT POLLS ────────────────────────────────────────────────────────────
 *
 * The ruling is that the board is DYNAMIC: "the first student to complete the
 * test is already shown at the top. As soon as all the students start
 * submitting, the leaderboard gets updated." Two mechanisms could deliver that
 * and only one of them can be relied on here:
 *
 *   the academic live bus   `broadcastAcademicWrite` is an in-process event.
 *                           It refreshes the tab that did the writing and
 *                           reaches no other browser, so it moves the board for
 *                           the student who just submitted and for nobody else.
 *   supabase realtime       `AcademicLiveProvider` subscribed to
 *                           `postgres_changes` on `tests` and NOT on
 *                           `test_attempts` or `test_marks`, which are the two
 *                           tables a submission writes — so a classmate
 *                           handing in emitted nothing any other browser was
 *                           listening for. Both now publish
 *                           (20260920080000) and the provider subscribes, so
 *                           `liveVersion` below moves when the class does.
 *
 * Both are used. Realtime makes it immediate; the timer is the floor for when
 * realtime does not arrive.
 */
export function TestLeaderboard({
  ctx,
  testId,
  className,
}: {
  ctx: ServiceContext;
  testId: string;
  className?: string;
}) {
  const liveVersion = useAcademicLive(["test", "profile"]);
  const [board, setBoard] = useState<TestLeaderboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** First load shows a skeleton; every later one must not blank the board. */
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      if (loadedRef.current) setRefreshing(true);
      try {
        const next = await TestService.leaderboard(ctx, testId);
        if (cancelled) return;
        setBoard(next);
        setError(null);
        loadedRef.current = true;
      } catch (e) {
        if (cancelled) return;
        // A student who has not submitted is REFUSED this board, by design
        // (20260920030000). That is not an error to shout about on a result
        // screen, so it reads as an absence rather than a failure.
        setError(toErrorMessage(e, "Could not load the leaderboard"));
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };

    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ctx, testId, liveVersion]);

  if (error && !board) {
    return (
      <Card className={cn("p-4", className)}>
        <div className="flex items-center gap-2 mb-1">
          <Trophy className="w-4 h-4 text-accent" />
          <h3 className="font-semibold text-sm">Class leaderboard</h3>
        </div>
        <p className="text-sm text-muted-foreground">{error}</p>
      </Card>
    );
  }

  if (!board) {
    return (
      <Card className={cn("p-4", className)} aria-busy="true">
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="w-4 h-4 text-accent" />
          <h3 className="font-semibold text-sm">Class leaderboard</h3>
        </div>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-7 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-accent" />
          <h3 className="font-semibold text-sm">Class leaderboard</h3>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {board.submitted_count} of {board.roll_count} handed in
          </span>
          {/* Says that it is live, and shows when it is asking. Without this a
              board that has not moved for ten seconds looks frozen. */}
          <RefreshCw
            className={cn("w-3 h-3", refreshing && "animate-spin")}
            aria-label={refreshing ? "Updating" : "Updates automatically"}
          />
        </div>
      </div>

      {board.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody has handed this test in yet.
        </p>
      ) : (
        <ol className="space-y-1">
          {board.entries.map((e) => (
            <li
              key={e.student_id}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-1.5",
                e.is_me ? "bg-primary/10 border border-primary/25" : "bg-muted/40",
              )}
            >
              <span className="w-6 text-xs font-bold tabular-nums text-muted-foreground shrink-0">
                {e.rank}
              </span>
              <span className="flex-1 min-w-0 text-sm truncate">
                {toPersonName(e.full_name, { kind: "student" })}
                {e.is_me && <span className="text-[10px] font-bold text-primary"> · you</span>}
              </span>
              {/* A mark, never a percentage of a denominator this row does not
                  carry, and never a 0 standing in for "not marked" (§7). */}
              <span className="text-sm font-bold tabular-nums shrink-0">
                {e.mark == null ? "—" : e.mark}
                {board.max_mark != null ? (
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {" "}
                    / {board.max_mark}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* The tie-break, stated. Two students on the same mark share a rank, and
          the one who finished first is above — which is the ruling, and is not
          guessable from the list alone. */}
      {board.entries.length > 1 && (
        <p className="text-[10px] text-muted-foreground mt-2">
          Equal marks share a rank; whoever handed in first is listed above.
        </p>
      )}
    </Card>
  );
}
