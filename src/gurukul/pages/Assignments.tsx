import { useEffect, useMemo, useRef, useState } from "react";
import { withAlpha } from "@/lib/colorAlpha";
import { ClipboardList, Loader2, Send } from "lucide-react";
import {
  HOMEWORK_HAND_IN_FILE_PICKER,
  HOMEWORK_STANDING_LABELS,
  HomeworkService,
  WORK_KIND_LABELS,
  canHandIn,
  homeworkStanding,
  useAcademicLive,
  type HomeworkStanding,
  type StudentHomeworkRow,
} from "@/academic";
import { attachmentOfFile, type AcademicFile } from "@/academic/storage/academicFileUpload";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { displaySubject, presentAcademicLabel } from "@/lib/academicPresentation";
import {
  EmptyState,
  GlassCard,
  NoStudentProfile,
  PageHeader,
  PageSkeleton,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  SubjectBadge,
  subjectColor,
} from "@/gurukul/components/shared";
import { AttachmentList, OneFileField } from "@/gurukul-teacher/AttachmentUI";
import { toErrorMessage } from "@/lib/presentation";
import { StudentErrorState } from "@/components/student/StudentPanelStates";

type Filter = "all" | "to_do" | "handed_in" | "missed";

const FILTERS: { key: Filter; label: string; standings: HomeworkStanding[] }[] = [
  { key: "all", label: "All", standings: ["to_do", "rejected", "handed_in", "accepted", "not_handed_in"] },
  { key: "to_do", label: "To do", standings: ["to_do", "rejected"] },
  { key: "handed_in", label: "Handed in", standings: ["handed_in", "accepted"] },
  { key: "missed", label: "Missed", standings: ["not_handed_in"] },
];

const TONE: Record<HomeworkStanding, string> = {
  to_do: "bg-warning/15 text-warning",
  rejected: "bg-destructive/15 text-destructive",
  handed_in: "bg-primary/15 text-primary",
  accepted: "bg-success/15 text-success",
  not_handed_in: "bg-destructive/15 text-destructive",
};

function subjectAccent(raw: string): string {
  const label = displaySubject(raw) || raw;
  return subjectColor[label] ?? subjectColor[raw] ?? "hsl(var(--muted-foreground))";
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

/**
 * The student's homework — the one screen for it, at /student/homework and
 * inside Classes. Hand in ONE image or PDF before the deadline; replace it, or
 * hand in again after a rejection, until then.
 */
export default function Assignments({ embedded = false }: { embedded?: boolean }) {
  const { ctx, ready, studentId } = useAcademicContext();
  const liveVersion = useAcademicLive("homework");
  const loadedRef = useRef(false);
  const [rows, setRows] = useState<StudentHomeworkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped by the error state's Try again, so the load effect re-runs. */
  const [reloadNonce, setReloadNonce] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [file, setFile] = useState<AcademicFile | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    if (!ctx || !studentId) return;
    setRows(await HomeworkService.listForStudent(ctx, studentId));
  };

  useEffect(() => {
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      if (!loadedRef.current) setLoading(true);
      try {
        await reload();
        if (!cancelled) {
          setLoadError(null);
          loadedRef.current = true;
        }
      } catch (e) {
        if (!cancelled) setLoadError(toErrorMessage(e, "Failed to load homework"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, studentId, liveVersion, reloadNonce]);

  const withStanding = useMemo(
    () => rows.map((r) => ({ ...r, state: homeworkStanding(r.standing) })),
    [rows],
  );

  const visible = useMemo(() => {
    const allowed = FILTERS.find((f) => f.key === filter)!.standings;
    const q = search.trim().toLowerCase();
    return withStanding.filter((r) => {
      if (!allowed.includes(r.state)) return false;
      if (!q) return true;
      const title = (presentAcademicLabel(r.homework.title) || r.homework.title).toLowerCase();
      const subject = (displaySubject(r.homework.subject) || r.homework.subject).toLowerCase();
      return title.includes(q) || subject.includes(q);
    });
  }, [withStanding, filter, search]);

  const handIn = async (homeworkId: string) => {
    if (!ctx || !file) return;
    setSaving(true);
    setActionError(null);
    try {
      await HomeworkService.submit(ctx, homeworkId, file);
      setActiveId(null);
      setFile(null);
      await reload();
    } catch (e) {
      setActionError(toErrorMessage(e, "Failed to hand in homework"));
    } finally {
      setSaving(false);
    }
  };

  // The title needs no network, so it renders above every state.
  const header = embedded ? null : (
    <PageHeader eyebrow="Class" title="Homework" subtitle="Everything your teachers have set, and what you have handed in." />
  );

  if (!ready || loading) {
    return (
      <div className="space-y-4">
        {header}
        <PageSkeleton label="Loading homework">
          <SkeletonCard className="p-4 flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-20 rounded-full" />
            ))}
          </SkeletonCard>
          <SkeletonList rows={4} />
        </PageSkeleton>
      </div>
    );
  }

  if (!studentId) {
    return (
      <div className="space-y-4">
        {header}
        <NoStudentProfile />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        {header}
        <StudentErrorState
          title="Could not load your homework"
          message={loadError}
          onRetry={() => {
            // Clear first: a same-subject refetch suppresses the spinner, so
            // without this the unchanged error screen would just sit there.
            setLoadError(null);
            setReloadNonce((n) => n + 1);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      {actionError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {actionError}
        </div>
      )}
      <GlassCard className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                  filter === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="bg-muted border border-border rounded-xl px-3 py-1.5 text-[11px] text-foreground w-36"
          />
        </div>

        <div className="space-y-3">
          {visible.length === 0 && (
            <EmptyState
              variant="section"
              icon={<ClipboardList className="w-5 h-5" />}
              title={filter !== "all" || search.trim() ? "No homework matches this filter" : "No homework set yet"}
              sub={
                filter !== "all" || search.trim()
                  ? "Clear the filter or search to see everything set for your class."
                  : "Homework your teachers set for your class shows up here."
              }
            />
          )}
          {visible.map(({ homework: a, standing, submission: s, state }) => {
            const col = subjectAccent(a.subject);
            const title = presentAcademicLabel(a.title) || a.title;
            const open = canHandIn(standing);
            return (
              <div
                key={a.id}
                className={`p-4 rounded-xl border bg-muted/30 space-y-2 ${
                  state === "rejected" ? "border-destructive/40" : "border-border/70"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: withAlpha(col, 0.08), color: col }}
                  >
                    <ClipboardList className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{title}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-primary/15 text-primary">
                        {WORK_KIND_LABELS[a.workKind]}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${TONE[state]}`}>
                        {HOMEWORK_STANDING_LABELS[state]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <SubjectBadge subject={a.subject} color={col} />
                      <span className="text-[11px] text-muted-foreground">Deadline {when(a.closesAt)}</span>
                      {s?.submittedAt && (
                        <span className="text-[10px] text-muted-foreground">Handed in {when(s.submittedAt)}</span>
                      )}
                    </div>
                    {a.questionFile ? (
                      <AttachmentList items={[attachmentOfFile(a.questionFile)]} dense />
                    ) : (
                      a.questionText && (
                        <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{a.questionText}</p>
                      )
                    )}
                    {s?.file && (
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-muted-foreground">Your file</div>
                        <AttachmentList items={[attachmentOfFile(s.file)]} dense />
                      </div>
                    )}
                  </div>
                </div>
                {open &&
                  (activeId === a.id ? (
                    <div className="space-y-2">
                      <OneFileField
                        value={file}
                        onChange={setFile}
                        accept={HOMEWORK_HAND_IN_FILE_PICKER.accept}
                        kinds={HOMEWORK_HAND_IN_FILE_PICKER.kinds}
                        kindsLabel={HOMEWORK_HAND_IN_FILE_PICKER.label}
                        disabled={saving}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={saving || !file}
                          onClick={() => void handIn(a.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-primary text-primary-foreground disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          Hand in
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveId(null);
                            setFile(null);
                          }}
                          className="px-3 py-1.5 rounded-xl text-[10px] font-bold text-muted-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(a.id);
                        setFile(null);
                      }}
                      className="text-[10px] font-bold text-primary"
                    >
                      {state === "rejected" ? "Hand in again" : s?.file ? "Replace my file" : "Hand in"}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
