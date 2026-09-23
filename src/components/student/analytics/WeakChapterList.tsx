import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ChevronDown, ChevronRight, SkipForward } from "lucide-react";
import { cn } from "@/gurukul/components/shared";
import { displayChapter, displaySubject, displayTopic } from "@/lib/academicDisplay";
import { ListFailed, ListLoading } from "@/gurukul/components/PracticeLists";
import { listItems, type ListState } from "@/lib/listState";
import { pluralise } from "@/lib/plural";
import { toEnumLabel } from "@/lib/presentation";
import type { WeakChapterRow } from "@/lib/weakChapters";

/**
 * §6.3's chapter list — the main screen of Analysis.
 *
 * One row per chapter with anything open, ranked by open mistakes with the
 * two pins §6.3 names, and every signal shown SEPARATELY (§6.2: "Do not
 * compute a single weakness score… Show the signals. Rank on the clearest
 * one."). There is no score here, no bar, and no chapter the student is doing
 * well in (§6.1).
 *
 * Opening a row is §6.5 — mistakes by topic, the topics skipped most, and the
 * pace of the chapter against the student's own — and §6.6's offer to retry
 * what they skipped.
 */

const TREND_LABEL: Record<WeakChapterRow["trend"], string> = {
  improving: "Improving",
  worsening: "Getting worse",
  stuck: "Not moving",
  not_enough_data: "Not enough sessions yet",
};

const TREND_TONE: Record<WeakChapterRow["trend"], string> = {
  improving: "text-success",
  worsening: "text-destructive",
  stuck: "text-muted-foreground",
  not_enough_data: "text-muted-foreground",
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

function Signal({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="min-w-[84px]">
      <div className={cn("text-sm font-black tabular-nums", tone ?? "text-foreground")}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function TopicCounts({ title, rows, empty }: { title: string; rows: { topic: string; count: number }[]; empty: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted-foreground mb-1">{title}</div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 5).map((t) => (
            <li key={t.topic} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-foreground truncate">{displayTopic(t.topic)}</span>
              <span className="tabular-nums text-muted-foreground shrink-0">{t.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WeakChapterList({ list, onRetry }: { list: ListState<WeakChapterRow>; onRetry: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = listItems(list);

  if (list.status === "loading") return <ListLoading />;
  if (list.status === "failed") return <ListFailed onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        Nothing is open. Chapters appear here when a mistake, a skipped question or a
        failed revision check leaves something to do.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="weak-chapter-list">
      {rows.map((row) => {
        const isOpen = open === row.chapterId;
        const neglected = daysSince(row.oldestOpenAt);
        const slower =
          row.avgSecPerQuestion != null && row.ownAvgSecPerQuestion != null
            ? Math.round(row.avgSecPerQuestion - row.ownAvgSecPerQuestion)
            : null;
        return (
          <div key={row.chapterId} className="rounded-xl border border-border/70 bg-surface/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : row.chapterId)}
              aria-expanded={isOpen}
              data-testid="weak-chapter-row"
              className="w-full text-left p-3 flex items-start gap-3 hover:bg-muted/40 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-foreground truncate">{displayChapter(row.chapter)}</span>
                  {row.pin === "revision_failed" && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
                      REVISION FAILED
                    </span>
                  )}
                  {row.pin === "repeated_mistakes" && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20">
                      KEEPS COMING BACK
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">{displaySubject(row.subject)}</div>
              </div>
              <div className="hidden sm:flex items-start gap-4 shrink-0">
                <Signal label="Open mistakes" value={row.openMistakes} tone="text-destructive" />
                <Signal label="Of those, repeated" value={row.repeatedMistakes} tone={row.repeatedMistakes > 0 ? "text-warning" : undefined} />
                {/* §6.3's denominator. "—" while nothing has been attempted:
                    an accuracy with no questions behind it is not a fact. */}
                <Signal
                  label={row.attempted > 0 ? `Accuracy of ${row.attempted}` : "Accuracy"}
                  value={row.accuracyPct == null ? "—" : `${row.accuracyPct}%`}
                />
                <Signal label="Trend" value={TREND_LABEL[row.trend]} tone={TREND_TONE[row.trend]} />
              </div>
              {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />}
            </button>

            {/* The same signals, stacked, on a phone. */}
            <div className="sm:hidden px-3 pb-2 flex flex-wrap gap-x-4 gap-y-1">
              <Signal label="Open mistakes" value={row.openMistakes} tone="text-destructive" />
              <Signal label="Repeated" value={row.repeatedMistakes} tone={row.repeatedMistakes > 0 ? "text-warning" : undefined} />
              <Signal label="Accuracy" value={row.accuracyPct == null ? "—" : `${row.accuracyPct}%`} />
              <Signal label="Trend" value={TREND_LABEL[row.trend]} tone={TREND_TONE[row.trend]} />
            </div>

            {isOpen && (
              <div className="border-t border-border/60 p-3 space-y-3 bg-muted/20">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted-foreground">
                  {neglected != null && (
                    <span>Oldest open mistake: <span className="text-foreground">{pluralise(neglected, "day")} ago</span></span>
                  )}
                  {row.trend !== "not_enough_data" && row.trendDeltaPoints != null && (
                    <span>
                      Trend across {pluralise(row.sessions, "session")}:{" "}
                      <span className="text-foreground">{row.trendDeltaPoints > 0 ? "+" : ""}{row.trendDeltaPoints} pts</span>
                    </span>
                  )}
                  {row.trend === "not_enough_data" && (
                    <span>{pluralise(row.sessions, "session")} so far — a trend needs more.</span>
                  )}
                  {row.revisionState && (
                    <span>Revision: <span className="text-foreground">{row.revisionDue ? "due now" : toEnumLabel(row.revisionState, "chapter_state")}</span></span>
                  )}
                </div>

                {/* §6.5 — and it says it is approximate, because topic labels
                    are free text (§10.10). */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <TopicCounts title="Mistakes by topic (approximate)" rows={row.mistakeTopics} empty="No topic recorded against these mistakes." />
                  <TopicCounts title="Skipped most (approximate)" rows={row.skippedTopics} empty="Nothing skipped in this chapter." />
                </div>

                {/* §6.5 — slow and correct is not mastery, and an accuracy
                    figure cannot show it. */}
                {row.avgSecPerQuestion != null && (
                  <p className="text-[11px] text-muted-foreground">
                    About {row.avgSecPerQuestion}s a question here
                    {slower != null && row.ownAvgSecPerQuestion != null && (
                      <> — your own average is {row.ownAvgSecPerQuestion}s{slower > 0 ? `, so this chapter takes you ${slower}s longer` : ""}.</>
                    )}
                  </p>
                )}

                {/* §6.6 — skipping is its own signal, never forced into
                    recovery, and offered back as a question. */}
                {row.skipped > 0 && (
                  <div className="flex items-center gap-3 flex-wrap rounded-lg border border-warning/20 bg-warning/5 px-3 py-2">
                    <SkipForward className="w-4 h-4 text-warning shrink-0" />
                    <span className="text-[11px] text-foreground">
                      You skipped {pluralise(row.skipped, "question")} in {displayChapter(row.chapter)}.
                    </span>
                    <Link
                      to="/student/practice?mode=skipped"
                      className="ml-auto text-[11px] font-bold text-primary hover:underline"
                    >
                      Try the ones you skipped
                    </Link>
                  </div>
                )}

                {row.openMistakes > 0 && (
                  <div className="flex items-center gap-3 flex-wrap rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                    <span className="text-[11px] text-foreground">
                      {pluralise(row.openMistakes, "question")} still open here.
                    </span>
                    <Link to="/student/mistakes" className="ml-auto text-[11px] font-bold text-primary hover:underline">
                      Open the mistake book
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
