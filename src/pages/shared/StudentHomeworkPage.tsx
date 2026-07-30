import { useEffect, useState } from "react";
import { HomeworkService } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { NotebookPen, Clock, CheckCircle, Send, Calendar, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { StudentListSkeleton } from "@/components/student/StudentPanelStates";

interface HomeworkItem {
  id: string;
  subject: string;
  title: string;
  description: string;
  due_date: string | null;
  created_at: string;
  submission?: {
    id: string;
    status: string;
    content: string;
    grade: string | null;
    teacher_remarks: string | null;
    submitted_at: string | null;
  } | null;
}

export default function StudentHomeworkPage({ embedded = false }: { embedded?: boolean }) {
  const { ctx, ready, studentId: ctxStudentId } = useAcademicContext();
  const [homework, setHomework] = useState<HomeworkItem[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [noClass, setNoClass] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitText, setSubmitText] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ready || !ctx || !ctxStudentId) {
      if (ready && !ctxStudentId) {
        setNoClass(true);
        setLoading(false);
      }
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        setStudentId(ctxStudentId);
        setNoClass(false);
        const rows = await HomeworkService.listForStudent(ctx, ctxStudentId);
        if (cancelled) return;
        setHomework(
          rows.map(({ homework: h, submission: sub }) => ({
            id: h.id,
            subject: h.subject,
            title: h.title,
            description: h.description ?? "",
            due_date: h.dueDate,
            created_at: "",
            submission: sub
              ? {
                  id: sub.id,
                  status: sub.status,
                  content: sub.content || "",
                  grade: sub.grade,
                  teacher_remarks: sub.teacherRemarks,
                  submitted_at: sub.submittedAt,
                }
              : null,
          })),
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load homework");
        if (!cancelled) setHomework([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, ctxStudentId]);

  const submitHomework = async (hwId: string) => {
    if (!studentId) return;
    if (!ctx) return toast.error("Sign in required");
    const content = submitText[hwId]?.trim() || "";
    setSubmitting(hwId);

    try {
      const submission = await HomeworkService.submit(
        { ...ctx, studentId },
        { homeworkId: hwId, studentId, content },
      );
      toast.success("Homework submitted!");
      setHomework((prev) =>
        prev.map((h) =>
          h.id === hwId
            ? {
                ...h,
                submission: {
                  id: submission.id,
                  status: submission.status,
                  content: submission.content || "",
                  grade: submission.grade,
                  teacher_remarks: submission.teacherRemarks,
                  submitted_at: submission.submittedAt,
                },
              }
            : h,
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit");
    }
    setSubmitting(null);
  };

  if (loading) {
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
  const pending = homework.filter(
    (h) => (!h.submission || h.submission.status === "pending") && (!h.due_date || h.due_date >= today)
  );
  const submitted = homework.filter(
    (h) => h.submission && h.submission.status !== "pending"
  );
  const overdue = homework.filter(
    (h) => (!h.submission || h.submission.status === "pending") && h.due_date && h.due_date < today
  );

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

      {/* Pending homework */}
      {pending.length > 0 && (
        <>
          <h3 className="font-semibold mb-3">📋 Pending</h3>
          <div className="space-y-3 mb-6">
            {pending.map((h) => (
              <Card key={h.id} className="p-4 shadow-card border-l-4 border-l-primary">
                <div className="mb-2">
                  <div className="font-semibold">{h.title}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                    <BookOpen className="w-3.5 h-3.5" /> {h.subject}
                    {h.due_date && (
                      <>
                        <Calendar className="w-3.5 h-3.5 ml-2" />
                        Due: {new Date(h.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </>
                    )}
                  </div>
                </div>
                {h.description && (
                  <p className="text-sm text-muted-foreground mb-3">{h.description}</p>
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
            ))}
          </div>
        </>
      )}

      {/* Overdue */}
      {overdue.length > 0 && (
        <>
          <h3 className="font-semibold mb-3 text-destructive">⚠️ Overdue</h3>
          <div className="space-y-3 mb-6">
            {overdue.map((h) => (
              <Card key={h.id} className="p-4 shadow-card border-l-4 border-l-destructive">
                <div className="font-semibold">{h.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {h.subject} · Was due: {h.due_date ? new Date(h.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}
                </div>
                {h.description && <p className="text-sm text-muted-foreground mt-1">{h.description}</p>}
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
            ))}
          </div>
        </>
      )}

      {/* Submitted */}
      {submitted.length > 0 && (
        <>
          <h3 className="font-semibold mb-3">✅ Submitted</h3>
          <div className="space-y-2">
            {submitted.map((h) => (
              <Card key={h.id} className="p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{h.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">{h.subject}</div>
                    {h.submission?.content && (
                      <div className="text-xs bg-muted p-2 rounded mt-2">{h.submission.content}</div>
                    )}
                    {h.submission?.teacher_remarks && (
                      <div className="text-xs mt-2 p-2 rounded bg-accent/5 border border-accent/20">
                        <span className="font-medium">Teacher:</span> {h.submission.teacher_remarks}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    {h.submission?.status === "graded" ? (
                      <Badge className="bg-accent/10 text-accent border-accent/30" variant="outline">
                        {h.submission.grade || "Graded"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                        Pending review
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {homework.length === 0 && (
        <Card className="p-8 text-center">
          <NotebookPen className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No homework assigned yet. Enjoy your free time! 🎉</p>
        </Card>
      )}
    </>
  );
}
