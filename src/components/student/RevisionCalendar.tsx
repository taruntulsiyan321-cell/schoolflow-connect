import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { GlassCard, SubjectBadge, cn } from "@/gurukul/components/shared";
import { displayChapter } from "@/lib/academicDisplay";
import { pluralise } from "@/lib/plural";
import { REVISION_CALENDAR_DAYS, revisionCalendar, type RevItem } from "@/gurukul/pages/useRevisionQueueV2";

/** "Mon 12 Oct". */
const dayName = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/**
 * The revision calendar (docs/TODO.md C6): what is due over the next two
 * weeks, not only today, so a student can see a heavy day coming and spread
 * their checks. Overdue checks are shown first, apart from the days — they are
 * still to do. Each day is a button; the one picked lists its chapters.
 *
 * The days come from revisionCalendar, which counts from the same due dates,
 * with the same day arithmetic, as the cards below it.
 */
export function RevisionCalendar({ items, today = new Date() }: { items: ReadonlyArray<RevItem>; today?: Date }) {
  const cal = revisionCalendar(items, today);
  // Start on what needs doing first: the overdue, else the first day with something due, else today.
  const firstDue = cal.overdue.length > 0 ? -1 : (cal.days.find((d) => d.items.length > 0)?.offset ?? 0);
  const [picked, setPicked] = useState<number>(firstDue);
  const pickedItems = picked === -1 ? cal.overdue : cal.days[picked]?.items ?? [];
  const pickedName = picked === -1 ? "Overdue" : picked === 0 ? "Today" : picked === 1 ? "Tomorrow" : dayName(cal.days[picked].date);

  return (
    <GlassCard className="p-4">
      <section aria-label="Revision calendar" data-testid="revision-calendar">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CalendarDays className="h-4 w-4" aria-hidden /> The next {REVISION_CALENDAR_DAYS / 7} weeks
          </div>
          {cal.overdue.length > 0 && (
            <button
              type="button"
              aria-pressed={picked === -1}
              onClick={() => setPicked(-1)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-semibold",
                picked === -1 ? "border-destructive/50 bg-destructive/15 text-foreground" : "border-destructive/30 text-foreground hover:bg-destructive/10",
              )}
            >
              {cal.overdue.length} overdue
            </button>
          )}
        </div>

        <div className="grid grid-cols-7 gap-1" role="group" aria-label="Revision due by day">
          {cal.days.map((d) => {
            const n = d.items.length;
            return (
              <button
                key={d.offset}
                type="button"
                aria-pressed={picked === d.offset}
                aria-label={`${d.offset === 0 ? "Today" : dayName(d.date)}: ${n === 0 ? "nothing due" : `${pluralise(n, "check")} due`}`}
                onClick={() => setPicked(d.offset)}
                data-testid="revision-day"
                className={cn(
                  "flex flex-col items-center rounded-lg border px-0.5 py-1.5 text-center transition-all",
                  picked === d.offset ? "border-primary/50 bg-primary/15" : "border-border/60 hover:bg-muted",
                )}
              >
                <span className="text-[10px] uppercase text-muted-foreground">{d.date.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                <span className={cn("text-sm tabular-nums", d.offset === 0 ? "font-black text-foreground" : "font-semibold text-foreground")}>
                  {d.date.getDate()}
                </span>
                <span className={cn("mt-0.5 h-4 min-w-4 rounded-full px-1 text-[10px] font-bold leading-4 tabular-nums", n > 0 ? "bg-primary text-primary-foreground" : "text-transparent")}>
                  {n > 0 ? n : "·"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 border-t border-border/60 pt-3" data-testid="revision-day-list">
          <div className="mb-1.5 text-xs font-semibold text-foreground">{pickedName}</div>
          {pickedItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing due.</p>
          ) : (
            <ul className="space-y-1.5">
              {pickedItems.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <SubjectBadge subject={r.subject} />
                  <span className="font-medium text-foreground">{displayChapter(r.chapter) || r.chapter}</span>
                </li>
              ))}
            </ul>
          )}
          {cal.later > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {pluralise(cal.later, "more check")} due after these {REVISION_CALENDAR_DAYS} days.
            </p>
          )}
        </div>
      </section>
    </GlassCard>
  );
}
