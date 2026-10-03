import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Flag } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState, GlassCard, PageHeader, SubjectBadge, cn } from "@/gurukul/components/shared";
import { StudentErrorState, StudentListSkeleton } from "@/components/student/StudentPanelStates";
import { MathText } from "@/components/MathText";
import { displayChapter } from "@/lib/academicPresentation";
import { pluralise } from "@/lib/plural";
import { toErrorMessage } from "@/lib/presentation";
import { isSettled, listMyReports, type QuestionReport } from "@/lib/questionReports";
import { REPORT_REFRESH_MS } from "@/components/student/questionReports/useQuestionReports";
import { ReportOutcome } from "@/components/student/questionReports/ReportOutcome";

type Filter = "all" | "waiting" | "settled";

/**
 * Every question the student has reported (§10.21), what they said, and what
 * the check found — the page a report's notification opens.
 */
export default function ReportedQuestions() {
  const { user } = useAuth();
  const [reports, setReports] = useState<QuestionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    listMyReports(user.id)
      .then((r) => { if (!cancelled) { setReports(r); setError(null); } })
      .catch((e) => { if (!cancelled) setError(toErrorMessage(e, "We couldn't load your reports.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id, attempt]);

  const waiting = reports.filter((r) => !isSettled(r.status)).length;
  // While a report is being checked, look again.
  useEffect(() => {
    if (waiting === 0) return;
    const t = window.setTimeout(() => setAttempt((n) => n + 1), REPORT_REFRESH_MS);
    return () => window.clearTimeout(t);
  }, [waiting, attempt]);

  const shown = useMemo(
    () => reports.filter((r) => filter === "all" || (filter === "waiting") === !isSettled(r.status)),
    [reports, filter],
  );

  const header = (
    <PageHeader
      eyebrow="Learning"
      title="Reported Questions"
      subtitle="Questions you've reported, and what the check found."
      action={
        <Link
          to="/student/mistakes"
          className="flex items-center gap-1.5 rounded-xl border border-border bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Mistake Book
        </Link>
      }
    />
  );

  if (loading) return (<>{header}<StudentListSkeleton rows={3} /></>);
  if (error) return (<>{header}<StudentErrorState title="Couldn't load your reports" message={error} onRetry={() => setAttempt((n) => n + 1)} /></>);

  if (reports.length === 0) {
    return (
      <>
        {header}
        <GlassCard className="p-4">
          <EmptyState
            icon={<Flag className="h-6 w-6" />}
            title="No reports yet"
            sub="If a question's answer, wording or explanation looks wrong, tap the flag while practising, or Report on a question afterwards. It's checked within minutes."
          />
        </GlassCard>
      </>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
        {([
          ["all", `All (${reports.length})`],
          ["waiting", `Being checked (${waiting})`],
          ["settled", `Checked (${reports.length - waiting})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
              filter === key ? "border border-primary/40 bg-primary/15 text-primary" : "border border-border bg-muted text-muted-foreground hover:bg-secondary",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{filter === "waiting" ? "Nothing is waiting to be checked." : "None checked yet."}</p>
      ) : (
        <ul className="space-y-3" aria-label={pluralise(shown.length, "report")}>
          {shown.map((r) => (
            <li key={r.id}>
              <GlassCard className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.subject && <SubjectBadge subject={r.subject} />}
                    {r.chapter && <span className="text-[11px] text-muted-foreground">{displayChapter(r.chapter)}</span>}
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </span>
                </div>
                <MathText block className="text-sm font-medium leading-relaxed" text={r.questionText} />
                {r.options.length > 0 && (
                  <ol className="space-y-1 text-xs text-muted-foreground">
                    {r.options.map((o, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="font-semibold">{String.fromCharCode(65 + i)}.</span>
                        <MathText text={o} />
                      </li>
                    ))}
                  </ol>
                )}
                <ReportOutcome report={r} />
              </GlassCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
