import { useEffect, useState } from "react";
import {
  HomeworkService,
  WORK_KIND_LABELS,
  normalizeWorkKind,
  useAcademicLive,
} from "@/academic";
import type { StudentHomeworkRow } from "@/academic/services/homeworkService";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { displaySubject, presentAcademicLabel } from "@/lib/academicPresentation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { NotebookPen, Clock, CheckCircle, Send, Calendar, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { StudentListSkeleton } from "@/components/student/StudentPanelStates";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { toErrorMessage } from "@/lib/presentation";

/**
 * Student homework — HomeworkService only (list / submit / feedback).
 * Embedded under Classes or standalone; no mock assignments.
 */
export default function StudentHomeworkPage({ embedded = false }: { embedded?: boolean }) {
  const { ctx, ready, studentId: ctxStudentId } = useAcademicContext();
  const liveVersion = useAcademicLive("homework");
  const [rows, setRows] = useState<StudentHomeworkRow[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate([ctxStudentId]);
  const [noClass, setNoClass] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitText, setSubmitText] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ready || !ctx || !ctxStudentId) {
      if (ready && !ctxStudentId) {
        setNoClass(true);
        endLoading(setLoading);
      }
      return;
    }
    let cancelled = false;
    (async () => {
      beginLoading(setLoading);
      try {
        setStudentId(ctxStudentId);
        setNoClass(false);
        await HomeworkService.publishDueScheduled(ctx).catch(() => 0);
        const list = await HomeworkService.listForStudent(ctx, ctxStudentId);
        if (!cancelled) setRows(list);
      } catch (e) {
        toast.error(toErrorMessage(e, "Failed to load homework"));
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) endLoading(setLoading);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, ctxStudentId, liveVersion]);

  const submitHomework = async (hwId: string) => {
    if (!studentId) return;
    if (!ctx) return toast.error("Sign in required");
    const content = submitText[hwId]?.trim() || "";
    if (!content) return toast.error("Enter your submission before sending");
    setSubmitting(hwId);

    try {
      const submission = await HomeworkService.submit(
        { ...ctx, studentId },
        { homeworkId: hwId, studentId, content },
      );
      toast.success(
        submission.version > 1 ? "Homework resubmitted!" : "Homework submitted!",
      );
      const list = await HomeworkService.listForStudent(ctx, studentId);
      setRows(list);
      setSubmitText((p) => ({ ...p, [hwId]: "" }));
    } catch (err) {
      toast.error(toErrorMessage(err, "Failed to submit"));
    }
    setSubmitting(null);
  };

  if (showLoading(loading)) {
    return (
      <>
        {!embedded && <PageHeader title="Homework" subtitle="Assigned tasks and submissions" />}
        <StudentListSkeleton rows={4} />
      </>
    );
  }

  if (noClass) {
    return (
      <>
        {!embedded && <PageHeader title="Homework" subtitle="Assigned tasks and submissions" />}
        <Card className="p-8 text-center">
          <NotebookPen className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">You need to be assigned to a class before homework appears here.</p>
        </Card>
      </>
    );
  }

  const today = new Date().toISOString().split("T")[0];
  const isLocked = (st?: string | null) =>
    !!st && ["graded", "reviewed", "completed"].includes(st);
  const pending = rows.filter((r) => {
    const st = r.submission?.status;
    if (isLocked(st) || st === "returned" || st === "submitted" || st === "late") return false;
    return !st || st === "pending"
      ? !r.homework.dueDate || r.homework.dueDate >= today
      : false;
  });
  const overdue = rows.filter((r) => {
    const st = r.submission?.status;
    if (isLocked(st) || st === "submitted" || st === "late") return false;
    const open = !st || st === "pending" || st === "returned";
    return open && !!r.homework.dueDate && r.homework.dueDate < today;
  });
  const returned = rows.filter(
    (r) =>
      r.submission?.status === "returned" &&
      (!r.homework.dueDate || r.homework.dueDate >= today),
  );
  const submitted = rows.filter(
    (r) =>
      r.submission &&
      ["submitted", "late", "reviewed", "graded", "completed"].includes(r.submission.status),
  );

  const renderMeta = (r: StudentHomeworkRow) => {
    const subject = displaySubject(r.homework.subject) || r.homework.subject;
    const title = presentAcademicLabel(r.homework.title) || r.homework.title;
    const kind = WORK_KIND_LABELS[normalizeWorkKind(r.homework.workKind)];
    return { subject, title, kind };
  };

  return (
    <>
      {!embedded && <PageHeader title="Homework" subtitle="Assigned tasks and submissions" />}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Pending"
          value={pending.length}
          tone="warning"
        />
        <StatCard
          icon={<CheckCircle className="w-5 h-5" />}
          label="Submitted"
          value={submitted.length}
          tone="accent"
        />
        <StatCard
          icon={<NotebookPen className="w-5 h-5" />}
          label="Overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? "warning" : undefined}
        />
      </div>

      {returned.length > 0 && (
        <>
          <h3 className="font-semibold mb-3 text-amber-700">Returned for correction</h3>
          <div className="space-y-3 mb-6">
            {returned.map((r) => {
              const { title, subject, kind } = renderMeta(r);
              const h = r.homework;
              const sub = r.submission;
              return (
                <Card key={h.id} className="p-4 shadow-card border-l-4 border-l-amber-500">
                  <div className="mb-2">
                    <div className="font-semibold">{title}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {subject} · {kind} · {r.displayStatus}
                    </div>
                    {sub?.teacherRemarks && (
                      <div className="text-xs mt-2 p-2 rounded bg-amber-50 border border-amber-200">
                        <span className="font-medium">Teacher:</span> {sub.teacherRemarks}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Revise and resubmit…"
                      value={submitText[h.id] || sub?.content || ""}
                      onChange={(e) => setSubmitText((p) => ({ ...p, [h.id]: e.target.value }))}
                      rows={2}
                    />
                    <Button
                      onClick={() => submitHomework(h.id)}
                      disabled={submitting === h.id}
                      className="bg-gradient-primary text-primary-foreground"
                      size="sm"
                    >
                      <Send className="w-3.5 h-3.5 mr-1" />
                      {submitting === h.id ? "Resubmitting…" : "Resubmit"}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {pending.length > 0 && (
        <>
          <h3 className="font-semibold mb-3">Pending</h3>
          <div className="space-y-3 mb-6">
            {pending.map((r) => {
              const { title, subject, kind } = renderMeta(r);
              const h = r.homework;
              return (
                <Card key={h.id} className="p-4 shadow-card border-l-4 border-l-primary">
                  <div className="mb-2">
                    <div className="font-semibold">{title}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1 flex-wrap">
                      <BookOpen className="w-3.5 h-3.5" /> {subject}
                      <Badge variant="outline" className="text-[10px]">
                        {kind}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {r.displayStatus}
                      </Badge>
                      {h.dueDate && (
                        <>
                          <Calendar className="w-3.5 h-3.5 ml-2" />
                          Due:{" "}
                          {new Date(h.dueDate).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })}
                        </>
                      )}
                    </div>
                  </div>
                  {(h.instructions || h.description) && (
                    <p className="text-sm text-muted-foreground mb-3">
                      {h.instructions || h.description}
                    </p>
                  )}
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Type your answer or notes here…"
                      value={submitText[h.id] || ""}
                      onChange={(e) => setSubmitText((p) => ({ ...p, [h.id]: e.target.value }))}
                      rows={2}
                    />
                    <Button
                      onClick={() => submitHomework(h.id)}
                      disabled={submitting === h.id}
                      className="bg-gradient-primary text-primary-foreground"
                      size="sm"
                    >
                      <Send className="w-3.5 h-3.5 mr-1" />
                      {submitting === h.id ? "Submitting…" : "Submit"}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {overdue.length > 0 && (
        <>
          <h3 className="font-semibold mb-3 text-destructive">Overdue</h3>
          <div className="space-y-3 mb-6">
            {overdue.map((r) => {
              const { title, subject, kind } = renderMeta(r);
              const h = r.homework;
              return (
                <Card key={h.id} className="p-4 shadow-card border-l-4 border-l-destructive">
                  <div className="font-semibold">{title}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {subject} · {kind} · {r.displayStatus} · Was due:{" "}
                    {h.dueDate
                      ? new Date(h.dueDate).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })
                      : "—"}
                  </div>
                  {(h.instructions || h.description) && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {h.instructions || h.description}
                    </p>
                  )}
                  {r.submission?.teacherRemarks && (
                    <div className="text-xs mt-2 p-2 rounded bg-amber-50 border border-amber-200">
                      <span className="font-medium">Teacher:</span> {r.submission.teacherRemarks}
                    </div>
                  )}
                  <div className="mt-2 space-y-2">
                    <Textarea
                      placeholder="Late submission…"
                      value={submitText[h.id] || ""}
                      onChange={(e) => setSubmitText((p) => ({ ...p, [h.id]: e.target.value }))}
                      rows={2}
                    />
                    <Button
                      onClick={() => submitHomework(h.id)}
                      disabled={submitting === h.id}
                      variant="outline"
                      size="sm"
                    >
                      <Send className="w-3.5 h-3.5 mr-1" />
                      Submit Late
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {submitted.length > 0 && (
        <>
          <h3 className="font-semibold mb-3">Submitted</h3>
          <div className="space-y-2">
            {submitted.map((r) => {
              const { title, subject, kind } = renderMeta(r);
              const h = r.homework;
              const sub = r.submission!;
              return (
                <Card key={h.id} className="p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{title}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {subject} · {kind}
                      </div>
                      {sub.content && (
                        <div className="text-xs bg-muted p-2 rounded mt-2">{sub.content}</div>
                      )}
                      {sub.teacherRemarks && (
                        <div className="text-xs mt-2 p-2 rounded bg-accent/5 border border-accent/20">
                          <span className="font-medium">Teacher:</span> {sub.teacherRemarks}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0">
                      {sub.status === "graded" || sub.status === "reviewed" ? (
                        <Badge className="bg-accent/10 text-accent border-accent/30" variant="outline">
                          {sub.grade ||
                            (sub.marksObtained != null
                              ? `${sub.marksObtained}${h.maxMarks != null ? ` / ${h.maxMarks}` : ""}`
                              : r.displayStatus)}
                        </Badge>
                      ) : sub.status === "late" ? (
                        <Badge
                          variant="outline"
                          className="bg-destructive/10 text-destructive border-destructive/30"
                        >
                          Late
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-warning/10 text-warning border-warning/30"
                        >
                          {r.displayStatus || "Pending review"}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {(sub.status === "submitted" || sub.status === "late") && (
                    <div className="mt-3 space-y-2 border-t pt-3">
                      <Textarea
                        placeholder="Replace submission before grading…"
                        value={submitText[h.id] ?? sub.content ?? ""}
                        onChange={(e) => setSubmitText((p) => ({ ...p, [h.id]: e.target.value }))}
                        rows={2}
                      />
                      <Button
                        onClick={() => submitHomework(h.id)}
                        disabled={submitting === h.id}
                        variant="outline"
                        size="sm"
                      >
                        <Send className="w-3.5 h-3.5 mr-1" />
                        {submitting === h.id ? "Updating…" : "Replace submission"}
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {rows.length === 0 && (
        <Card className="p-8 text-center">
          <NotebookPen className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No homework assigned yet.</p>
        </Card>
      )}
    </>
  );
}
