import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
// The STUDENT panel header, not ui-bits'. Both export a `PageHeader` with the
// same props and different designs — text-3xl display face with a 0.2em eyebrow
// here, text-[28px] with a bottom rule and a primary eyebrow there — so a
// student crossing from a gurukul screen into this one saw the page title
// change size, weight and typeface. That is the two-halves split in one import.
import { EmptyState, GlassCard, PageHeader } from "@/gurukul/components/shared";
import { AlertCircle, CheckCircle2, CreditCard, ReceiptText, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { StudentListSkeleton } from "@/components/student/StudentPanelStates";
import { resolveParentLinkedStudentIds } from "@/lib/parentLinkedStudents";
import { cn } from "@/lib/utils";
import { toEnumLabel } from "@/lib/presentation";

type FeeStudent = { full_name?: string | null } | null;

type FeeRow = {
  id: string;
  month: string;
  amount: number;
  paid_amount: number;
  status: string;
  due_date: string | null;
  students?: FeeStudent;
};

export default function MyFeesPage({ asParent = false, embedded = false }: { asParent?: boolean; embedded?: boolean }) {
  const { user, schoolId } = useAuth();
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      let ids: string[];
      if (asParent) {
        ids = schoolId ? await resolveParentLinkedStudentIds(schoolId, user.id) : [];
        if (cancelled) return;
      } else {
        const { data: ss, error: studentErr } = await supabase
          .from("students")
          .select("id")
          .eq("user_id", user.id);
        if (cancelled) return;
        if (studentErr) {
          setRows([]);
          setLoading(false);
          toast.error(studentErr.message || "Could not load student fee profile");
          return;
        }
        ids = ss?.map((s) => s.id) ?? [];
      }
      if (!ids.length) {
        setRows([]);
        setLoading(false);
        return;
      }
      const { data, error: feesErr } = await supabase
        .from("fees")
        .select("*, students(full_name)")
        .in("student_id", ids)
        .order("month", { ascending: false });
      if (cancelled) return;
      if (feesErr) {
        setRows([]);
        toast.error(feesErr.message || "Could not load fee records");
      } else {
        setRows((data as FeeRow[] | null) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, asParent, schoolId]);

  const overdue = rows.filter((r) => r.status !== "paid" && r.due_date && new Date(r.due_date) < new Date());
  const totalAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const paidAmount = rows.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
  const pendingAmount = rows.reduce(
    (sum, row) => sum + Math.max(0, Number(row.amount || 0) - Number(row.paid_amount || 0)),
    0,
  );
  const paidCount = rows.filter((row) => row.status === "paid").length;

  const tone = (s: string) =>
    s === "paid"
      ? "bg-accent/10 text-accent"
      : s === "partial"
        ? "bg-warning/10 text-warning"
        : "bg-destructive/10 text-destructive";

  return (
    <>
      {!embedded && <PageHeader title="Fees" subtitle={asParent ? "Your child's fee status" : "Your fee status"} />}

      {loading && <StudentListSkeleton rows={4} />}

      {!loading && (
        <div className="space-y-4">
          {/* DARK TEXT ON A DARK CARD — the hero was unreadable.
              It hard-coded `bg-[#083f2b]` (near-black green) and then set every
              line inside it with `text-foreground/70`, `/75` and `/65`. The
              student theme's `--foreground` is `199 38% 13%`, a near-black
              navy: the eyebrow, the headline and the caption were all dark ink
              on a dark ground. A bulk swap from hard-coded `text-white/xx` to
              theme tokens did this — on a surface that hard-codes its own
              background, the theme's foreground is the wrong end of the scale
              by definition.

              Rather than re-pin white text onto a one-off dark card, the hero
              now uses the surface every other student screen uses. Both the
              ground and the ink come from the same token set, so it cannot
              drift apart again, and the figure carries the meaning through
              colour the way Attendance's does. */}
          <GlassCard glow={pendingAmount > 0 ? "amber" : "green"} className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Fee wallet
                </p>
                <h2
                  className="mt-1 text-3xl font-black"
                  style={{
                    color: pendingAmount > 0 ? "hsl(var(--warning))" : "hsl(var(--success))",
                    fontFamily: "var(--font-display)",
                  }}
                >
                  {pendingAmount > 0 ? `₹${pendingAmount}` : "All clear"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pendingAmount > 0 ? "Pending school fee balance" : "No pending dues right now"}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { value: `₹${totalAmount}`, label: "Total" },
                  { value: `₹${paidAmount}`, label: "Paid" },
                  { value: `${paidCount}/${rows.length}`, label: "Cleared" },
                ].map((tile) => (
                  <div key={tile.label} className="rounded-2xl border border-border/70 bg-muted/40 px-3 py-2">
                    <p className="text-lg font-black text-foreground tabular-nums">{tile.value}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{tile.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>

          {overdue.length > 0 && (
            <Card className="p-4 border-destructive/30 bg-destructive/5 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-destructive">
                  {overdue.length} overdue payment{overdue.length > 1 ? "s" : ""}
                </div>
                <div className="text-sm text-muted-foreground">Please clear pending dues to avoid late fees.</div>
              </div>
            </Card>
          )}

          <div className="grid gap-3">
            {rows.map((r) => {
              const due = Math.max(0, Number(r.amount || 0) - Number(r.paid_amount || 0));
              const pct = Number(r.amount)
                ? Math.round((Number(r.paid_amount || 0) / Number(r.amount)) * 100)
                : 0;
              return (
                <Card key={r.id} className="overflow-hidden p-4 shadow-card border-border/70 bg-card/95">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={cn(
                          "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0",
                          r.status === "paid" ? "bg-accent/10 text-accent" : "bg-warning/10 text-warning",
                        )}
                      >
                        {r.status === "paid" ? <CheckCircle2 className="w-5 h-5" /> : <ReceiptText className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold">
                            {r.month}
                            {asParent && <> · {r.students?.full_name}</>}
                          </h3>
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${tone(r.status)}`}>
                            {toEnumLabel(r.status, "fee_status")}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Paid ₹{r.paid_amount} of ₹{r.amount}
                          {r.due_date && <> · Due {new Date(r.due_date).toLocaleDateString()}</>}
                        </div>
                        <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", r.status === "paid" ? "bg-accent" : "bg-warning")}
                            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Balance</p>
                        <p className="text-lg font-black">{due > 0 ? `₹${due}` : "₹0"}</p>
                      </div>
                      {r.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled
                          title="Online fee payment is not connected yet. Pay at the school office."
                          className="h-8"
                        >
                          <CreditCard className="w-3.5 h-3.5 mr-1" />
                          Pay at office
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* The shared empty state, and one icon rather than two contradictory
              ones — this drew a faded wallet AND a bell on the same line, the
              bell being the notifications icon with nothing to do with fees.
              "No fee records yet." also ended the conversation; an empty
              surface should say what fills it. */}
          {rows.length === 0 && (
            <GlassCard className="p-4">
              <EmptyState
                icon={<Wallet className="w-6 h-6" />}
                title="No fee records yet"
                sub={
                  asParent
                    ? "Invoices appear here once the school raises them for your child."
                    : "Invoices appear here once your school raises them. Nothing is due from you right now."
                }
              />
            </GlassCard>
          )}
        </div>
      )}
    </>
  );
}
