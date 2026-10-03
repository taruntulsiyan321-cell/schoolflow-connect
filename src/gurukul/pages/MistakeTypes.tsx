import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronRight, Tag } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState, GlassCard, PageHeader, ProgressBar, SubjectBadge, cn } from "@/gurukul/components/shared";
import { StudentErrorState, StudentListSkeleton } from "@/components/student/StudentPanelStates";
import { QuestionText } from "@/components/QuestionText";
import { displayChapter, displaySubject } from "@/lib/academicPresentation";
import { pluralise } from "@/lib/plural";
import { NO_TAG, bucketMarks } from "@/lib/questionMarks";
import { QuestionMarkBar } from "@/components/student/questionMarks/QuestionMarkBar";
import { useQuestionMarks } from "@/components/student/questionMarks/useQuestionMarks";

export default function MistakeTypes() {
  const { user } = useAuth();
  const { tags, marks, loading, error, setMark, retry } = useQuestionMarks(user?.id);
  const [subject, setSubject] = useState("all");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const all = useMemo(() => [...marks.values()], [marks]);
  const subjects = useMemo(
    () => ["all", ...new Set(all.map((m) => m.subject).filter((s): s is string => Boolean(s && displaySubject(s))))],
    [all],
  );
  const shown = useMemo(() => (subject === "all" ? all : all.filter((m) => m.subject === subject)), [all, subject]);
  const buckets = useMemo(() => bucketMarks(shown, tags), [shown, tags]);
  const tagged = buckets.filter((b) => b.key !== NO_TAG);
  const top = tagged[0]?.marks.length ?? 0;
  // The biggest group starts open, unless the student has chosen another.
  const expanded = openKey ?? tagged[0]?.key ?? buckets[0]?.key ?? null;

  const header = (
    <PageHeader
      eyebrow="Learning"
      title="Mistake Types"
      subtitle="Every question you've marked, grouped by why it went wrong."
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

  if (loading) return (<>{header}<StudentListSkeleton rows={4} /></>);
  if (error) return (<>{header}<StudentErrorState title="Couldn't load your marks" message={error} onRetry={retry} /></>);

  if (all.length === 0) {
    return (
      <>
        {header}
        <GlassCard className="p-4">
          <EmptyState
            icon={<Tag className="h-6 w-6" />}
            title="Nothing marked yet"
            sub="After a practice session, tap Mark on a question to say why it went wrong. You can mark questions in your Mistake Book too."
          />
        </GlassCard>
      </>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      {subjects.length > 2 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Subject">
          {subjects.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={subject === s}
              onClick={() => { setSubject(s); setOpenKey(null); }}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                subject === s ? "border border-primary/40 bg-primary/15 text-primary" : "border border-border bg-muted text-muted-foreground hover:bg-secondary",
              )}
            >
              {s === "all" ? "All Subjects" : displaySubject(s)}
            </button>
          ))}
        </div>
      )}

      <GlassCard className="p-5">
        <div className="mb-4 text-xs uppercase tracking-[0.15em] text-muted-foreground">
          {pluralise(shown.length, "question")} marked
        </div>
        {tagged.length === 0 ? (
          <p className="text-sm text-muted-foreground">None of these has a tag yet — edit a mark to add one.</p>
        ) : (
          <div className="space-y-3">
            {tagged.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setOpenKey(b.key)}
                className="flex w-full items-center gap-3 text-left"
              >
                <span className="w-36 shrink-0 text-xs font-semibold text-foreground">{b.label}</span>
                <span className="flex-1"><ProgressBar value={b.marks.length} max={top} /></span>
                <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums">{b.marks.length}</span>
              </button>
            ))}
          </div>
        )}
      </GlassCard>

      <div className="space-y-3">
        {buckets.map((b) => {
          const isOpen = expanded === b.key;
          return (
            <GlassCard key={b.key} className="overflow-hidden">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenKey(isOpen ? "" : b.key)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
              >
                <span className="font-semibold">{b.label}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {pluralise(b.marks.length, "question")}
                  {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                </span>
              </button>
              {isOpen && user && (
                <ul className="divide-y divide-border border-t border-border">
                  {b.marks.map((m) => (
                    <li key={m.ref.id} className="space-y-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {m.subject && <SubjectBadge subject={m.subject} />}
                        {m.chapter && <span className="text-[11px] text-muted-foreground">{displayChapter(m.chapter)}</span>}
                      </div>
                      <QuestionText compact className="text-sm font-medium leading-snug" text={m.questionText} />
                      <QuestionMarkBar
                        userId={user.id}
                        questionRef={m.ref}
                        question={{ text: m.questionText, subject: m.subject, chapter: m.chapter }}
                        mark={m}
                        tags={tags}
                        onChange={(next) => setMark(m.ref.id, next)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}
