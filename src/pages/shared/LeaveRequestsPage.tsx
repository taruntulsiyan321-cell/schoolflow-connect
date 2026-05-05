import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/ui-bits";
import { Check, X, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Leave = {
  id: string; applicant_user_id: string; applicant_kind: "student" | "teacher";
  student_id: string | null; class_id: string | null;
  leave_type: string; from_date: string; to_date: string; reason: string | null;
  status: "pending" | "approved" | "rejected"; created_at: string;
};

const STATUS_TONE: Record<string, string> = {
  pending: "bg-warning/15 text-warning border-warning/30",
  approved: "bg-accent/15 text-accent border-accent/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
};

export default function LeaveRequestsPage({ canReview = false, applicantKind }: { canReview?: boolean; applicantKind?: "student" | "teacher" }) {
  const { user } = useAuth();
  const [items, setItems] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ leave_type: "general", from_date: "", to_date: "", reason: "" });
  const [studentId, setStudentId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("leave_requests").select("*").order("created_at", { ascending: false });
    setItems((data as Leave[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (applicantKind === "student" && user) {
      supabase.from("students").select("id, class_id").eq("user_id", user.id).maybeSingle()
        .then(({ data }) => { if (data) { setStudentId(data.id); setClassId(data.class_id); } });
    }
  }, [user, applicantKind]);

  const submit = async () => {
    if (!user || !applicantKind) return;
    if (!form.from_date || !form.to_date) return toast.error("Pick dates");
    const { error } = await supabase.from("leave_requests").insert({
      applicant_user_id: user.id,
      applicant_kind: applicantKind,
      student_id: applicantKind === "student" ? studentId : null,
      class_id: applicantKind === "student" ? classId : null,
      ...form,
    });
    if (error) return toast.error(error.message);
    toast.success("Leave request submitted");
    setOpen(false);
    setForm({ leave_type: "general", from_date: "", to_date: "", reason: "" });
    load();
  };

  const review = async (id: string, status: "approved" | "rejected") => {
    const { error } = await supabase.from("leave_requests").update({
      status, reviewed_by: user?.id, reviewed_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Leave ${status}`);
    load();
  };

  return (
    <>
      <PageHeader
        title="Leave Requests"
        subtitle={canReview ? "Approve or reject pending requests" : "Submit and track your leave requests"}
        action={applicantKind && (
          <Button onClick={() => setOpen(o => !o)} className="bg-gradient-primary text-primary-foreground">
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        )}
      />

      {open && applicantKind && (
        <Card className="p-5 mb-6 border-primary/20">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={form.leave_type} onValueChange={v => setForm(f => ({ ...f, leave_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="sick">Sick</SelectItem>
                  <SelectItem value="emergency">Emergency</SelectItem>
                  <SelectItem value="casual">Casual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">From</Label><Input type="date" value={form.from_date} onChange={e => setForm(f => ({ ...f, from_date: e.target.value }))} /></div>
              <div><Label className="text-xs">To</Label><Input type="date" value={form.to_date} onChange={e => setForm(f => ({ ...f, to_date: e.target.value }))} /></div>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Reason</Label>
              <Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
            </div>
          </div>
          <Button onClick={submit} className="mt-3 bg-gradient-primary text-primary-foreground">Submit</Button>
        </Card>
      )}

      {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> :
        items.length === 0 ? <p className="text-muted-foreground text-center py-10">No leave requests.</p> :
        <div className="space-y-2">
          {items.map(l => (
            <Card key={l.id} className="p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="capitalize">{l.applicant_kind}</Badge>
                    <span className="font-medium capitalize">{l.leave_type}</span>
                    <Badge variant="outline" className={STATUS_TONE[l.status]}>{l.status}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {new Date(l.from_date).toLocaleDateString()} → {new Date(l.to_date).toLocaleDateString()}
                  </div>
                  {l.reason && <div className="text-sm mt-1">{l.reason}</div>}
                </div>
                {canReview && l.status === "pending" && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="text-accent" onClick={() => review(l.id, "approved")}><Check className="w-4 h-4" /></Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => review(l.id, "rejected")}><X className="w-4 h-4" /></Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      }
    </>
  );
}
