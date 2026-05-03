import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui-bits";
import { Bell, AlertCircle } from "lucide-react";

export default function MyFeesPage({ asParent = false }: { asParent?: boolean }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      if (!user) return;
      const col = asParent ? "parent_user_id" : "user_id";
      const { data: ss } = await supabase.from("students").select("id, full_name").eq(col, user.id);
      const ids = ss?.map(s => s.id) ?? [];
      if (!ids.length) return;
      const { data } = await supabase.from("fees").select("*, students(full_name)").in("student_id", ids).order("month", { ascending: false });
      setRows(data ?? []);
    })();
  }, [user, asParent]);

  const overdue = rows.filter(r => r.status !== "paid" && r.due_date && new Date(r.due_date) < new Date());

  const tone = (s: string) => s === "paid" ? "bg-accent/10 text-accent" : s === "partial" ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive";

  return (
    <>
      <PageHeader title="Fees" subtitle={asParent ? "Your child's fee status" : "Your fee status"} />

      {overdue.length > 0 && (
        <Card className="p-4 mb-4 border-destructive/30 bg-destructive/5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-destructive">{overdue.length} overdue payment{overdue.length > 1 ? "s" : ""}</div>
            <div className="text-sm text-muted-foreground">Please clear pending dues to avoid late fees.</div>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {rows.map(r => (
          <Card key={r.id} className="p-4 flex items-center justify-between gap-3 shadow-card">
            <div>
              <div className="font-semibold">{r.month}{asParent && <> · {r.students?.full_name}</>}</div>
              <div className="text-xs text-muted-foreground">
                ₹{r.paid_amount} / ₹{r.amount}
                {r.due_date && <> · Due {new Date(r.due_date).toLocaleDateString()}</>}
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${tone(r.status)}`}>{r.status}</span>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-muted-foreground text-center py-8 flex items-center justify-center gap-2"><Bell className="w-4 h-4" /> No fee records yet.</p>}
      </div>
    </>
  );
}
