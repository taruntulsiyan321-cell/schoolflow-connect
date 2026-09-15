import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Loader2, XCircle } from "lucide-react";
import {
  AttendanceService,
  HOMEWORK_STANDING_LABELS,
  HomeworkService,
  homeworkStanding,
  type ClassStudentRow,
  type HomeworkStanding,
  type ReviewRow,
} from "@/academic";
import type { HomeworkDecision, HomeworkRecord } from "@/academic/repository/homeworkRepository";
import { homeworkReportFilename, homeworkReportRows } from "@/academic/services/homeworkReport";
import { attachmentOfFile } from "@/academic/storage/academicFileUpload";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { exportCSV } from "@/lib/exportCsv";
import { toErrorMessage, toPersonName } from "@/lib/presentation";
import { AttachmentList } from "./AttachmentUI";

/** Work waiting on the teacher first, then what can still change, then what is settled. */
const ORDER: HomeworkStanding[] = ["handed_in", "rejected", "to_do", "not_handed_in", "accepted"];

/**
 * One homework's hand-ins. The teacher does exactly two things with a hand-in
 * awaiting review: accept it or reject it. No marks, no grade, no remark.
 *
 * `canDecide` is false for a teacher of the class who does not teach the
 * homework's subject: they read every hand-in, and decide none.
 */
export function HomeworkReview({
  homework,
  classId,
  canDecide,
  onBack,
}: {
  homework: HomeworkRecord;
  classId: string;
  canDecide: boolean;
  onBack: () => void;
}) {
  const { ctx } = useAcademicContext();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [roster, setRoster] = useState<ClassStudentRow[]>([]);
  const names = useMemo(() => new Map(roster.map((s) => [s.id, s.fullName])), [roster]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!ctx) return;
    try {
      const [review, students] = await Promise.all([
        HomeworkService.listForReview(ctx, homework.id),
        AttendanceService.listClassStudents(ctx, classId),
      ]);
      setRows(review);
      setRoster(students);
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load hand-ins"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, homework.id, classId]);

  const sorted = useMemo(
    () =>
      rows
        .map((r) => ({ ...r, standing: homeworkStanding(r.standing) }))
        .sort((a, b) => ORDER.indexOf(a.standing) - ORDER.indexOf(b.standing)),
    [rows],
  );

  const decide = async (submissionId: string, decision: HomeworkDecision) => {
    if (!ctx || deciding) return;
    setDeciding(submissionId);
    setError(null);
    try {
      await HomeworkService.decide(ctx, submissionId, decision);
      await load();
    } catch (e) {
      setError(toErrorMessage(e, "Failed to record the decision"));
    } finally {
      setDeciding(null);
    }
  };

  const counts = ORDER.map((s) => [s, sorted.filter((r) => r.standing === s).length] as const);
  // Past the deadline a rejected hand-in cannot be handed in again, so the
  // database counts the rejection as missed homework and charges its XP — said
  // here before the teacher decides, where it applies.
  const rejectingCostsXp =
    canDecide && homework.missedCostsXp && rows.some((r) => r.standing.closed && r.submission?.status === "submitted");

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-[10px] font-bold text-primary">
        ← Back to list
      </button>
      <div>
        <div className="text-sm font-bold text-foreground">{homework.title}</div>
        <div className="text-[10px] text-muted-foreground">
          {homework.subject} · Deadline{" "}
          {new Date(homework.closesAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
        </div>
      </div>
      {homework.questionFile ? (
        <AttachmentList items={[attachmentOfFile(homework.questionFile)]} dense />
      ) : (
        homework.questionText && (
          <div className="text-[11px] text-muted-foreground whitespace-pre-wrap">{homework.questionText}</div>
        )
      )}
      <div className="flex flex-wrap gap-2 items-center text-[10px] text-muted-foreground">
        {counts.map(([s, n]) => (
          <span key={s} className="px-2 py-0.5 rounded-lg bg-muted">
            {HOMEWORK_STANDING_LABELS[s]}: {n}
          </span>
        ))}
        {!loading && rows.length > 0 && (
          <button
            type="button"
            onClick={() => exportCSV(homeworkReportFilename(homework), homeworkReportRows(rows, roster))}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary/15 text-primary font-bold"
          >
            <Download className="w-3 h-3" /> Download report
          </button>
        )}
      </div>
      {!canDecide && (
        <div className="text-[10px] text-muted-foreground">
          View only — hand-ins for {homework.subject} are accepted or rejected by its teachers.
        </div>
      )}
      {rejectingCostsXp && (
        <div className="text-[10px] text-muted-foreground">
          The deadline has passed, so rejected work cannot be handed in again: rejecting it now counts as missed homework
          and costs the student XP.
        </div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading hand-ins…
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((r) => (
            <div key={r.studentId} className="p-3 rounded-[2px] border border-border bg-surface space-y-2">
              <div className="flex justify-between gap-2">
                <div className="text-xs font-semibold text-foreground">
                  {toPersonName(names.get(r.studentId), { kind: "student" })}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {HOMEWORK_STANDING_LABELS[r.standing]}
                  {r.submission?.submittedAt
                    ? ` · ${new Date(r.submission.submittedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`
                    : ""}
                </div>
              </div>
              {r.submission?.file && <AttachmentList items={[attachmentOfFile(r.submission.file)]} dense />}
              {canDecide && r.submission?.status === "submitted" && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!!deciding}
                    onClick={() => void decide(r.submission!.id, "accepted")}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-success/20 text-success flex items-center gap-1 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3 h-3" /> {deciding === r.submission.id ? "…" : "Accept"}
                  </button>
                  <button
                    type="button"
                    disabled={!!deciding}
                    onClick={() => void decide(r.submission!.id, "rejected")}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-destructive/15 text-destructive flex items-center gap-1 disabled:opacity-50"
                  >
                    <XCircle className="w-3 h-3" /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
          {sorted.length === 0 && (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No student is counted on this homework — the class had no students when it was set.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
