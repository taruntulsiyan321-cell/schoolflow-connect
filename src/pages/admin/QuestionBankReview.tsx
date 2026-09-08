import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CheckCircle2, XCircle, Loader2, Inbox, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  QuestionBankService,
  useAcademicContext,
  type QuestionReviewRow,
} from "@/academic";
import { toErrorMessage } from "@/lib/presentation";

/**
 * The central question bank's review queue — §10.20, "Manage the central
 * question bank", which is a super admin power and nobody else's.
 *
 * WHY THIS SCREEN EXISTS. `is_approved` defaults FALSE (20260907000000) so a
 * teacher's contribution is not broadcast to every school the instant it saves.
 * Until this page there was nothing that could ever set it true, so a
 * contribution was permanently invisible to students — KNOWN_ISSUES 15, which
 * called that "the right trade for v1" and asked for the queue.
 *
 * APPROVAL IS CENTRAL, not per school, because §10.9 makes the bank central:
 * "Centralised and shared across all schools and all users." One decision, one
 * reviewer, every school.
 *
 * REJECTION IS NOT A DELETE. It sets `is_approved = false` and records a
 * reason. §10.21 already ruled this shape for reported questions — a question
 * may sit in a student's mistake book, and removing it takes away something
 * they really got wrong.
 */
export default function QuestionBankReview() {
  const { ctx, ready } = useAcademicContext();
  const [rows, setRows] = useState<QuestionReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Per-row reject reason, keyed by question id. */
  const [notes, setNotes] = useState<Record<string, string>>({});

  const isSuperAdmin = ready && ctx?.role === "super_admin";

  const load = useCallback(async () => {
    if (!ready || !ctx || !isSuperAdmin) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRows(await QuestionBankService.listReviewQueue(ctx));
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not load the review queue"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [ready, ctx, isSuperAdmin]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (row: QuestionReviewRow, approved: boolean) => {
    if (!ctx) return;
    const note = notes[row.id] ?? "";
    if (!approved && !note.trim()) {
      // A rejection with no reason is a decision the author cannot learn from.
      return toast.error("Give a reason before rejecting — the author sees it.");
    }
    setBusyId(row.id);
    try {
      await QuestionBankService.review(ctx, row.id, approved, note);
      // Drop it from the list rather than refetching: the queue is "not
      // approved", and an approval leaves it. A reject stays out too — the
      // decision has been recorded and re-showing it invites double-clicking.
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success(approved ? "Approved — students can be served it now" : "Rejected");
    } catch (e) {
      toast.error(toErrorMessage(e, approved ? "Could not approve" : "Could not reject"));
    } finally {
      setBusyId(null);
    }
  };

  if (ready && !isSuperAdmin) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Super admin only
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          The question bank is shared by every school, so approving a question decides
          what students everywhere are served. §10.20 reserves that to the super admin.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">Question bank review</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Contributed questions waiting to be approved. The bank is shared by every
            school, so an approval here serves them all.
          </p>
        </div>
        <Badge variant="outline" className="rounded-full">{rows.length} pending</Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the queue…
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center">
          <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
          {/* An empty queue is the normal state, not a failure. */}
          <p className="mt-3 text-sm font-semibold">Nothing waiting for review</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Questions a teacher contributes appear here until they are approved.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const options = Array.isArray(row.options) ? (row.options as unknown[]) : [];
            const busy = busyId === row.id;
            return (
              <Card key={row.id} className="p-4 space-y-3" data-testid="review-card">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <Badge variant="secondary" className="rounded-full">{row.subject}</Badge>
                  {row.class_level != null && (
                    <Badge variant="outline" className="rounded-full">Class {row.class_level}</Badge>
                  )}
                  {row.chapter && <Badge variant="outline" className="rounded-full">{row.chapter}</Badge>}
                  {row.difficulty && (
                    <Badge variant="outline" className="rounded-full capitalize">{row.difficulty}</Badge>
                  )}
                  <span className="text-muted-foreground ml-auto">
                    by {row.author_name}
                  </span>
                </div>

                <p className="text-sm font-semibold leading-relaxed">{row.question}</p>

                <div className="grid gap-1.5 sm:grid-cols-2">
                  {options.map((opt, i) => (
                    <div
                      key={i}
                      className={
                        "rounded-lg border px-2.5 py-1.5 text-xs " +
                        (i === row.correct_index
                          ? "border-emerald-500/40 bg-emerald-500/10 font-semibold"
                          : "border-border")
                      }
                    >
                      {String.fromCharCode(65 + i)}. {String(opt)}
                      {i === row.correct_index && " ✓"}
                    </div>
                  ))}
                </div>

                {row.explanation && (
                  <p className="text-xs text-muted-foreground">{row.explanation}</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={notes[row.id] ?? ""}
                    onChange={(e) => setNotes((p) => ({ ...p, [row.id]: e.target.value }))}
                    placeholder="Reason (required to reject)"
                    className="h-9 flex-1 min-w-[200px] text-xs"
                    aria-label={`Reason for ${row.question.slice(0, 40)}`}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => decide(row, false)}
                  >
                    <XCircle className="mr-1.5 h-4 w-4" /> Reject
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => decide(row, true)}>
                    {busy ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    )}
                    Approve
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
