import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { toEnumLabel } from "@/lib/presentation";

type CaseStatus = "open" | "in_progress" | "resolved" | "closed";
const STATUS_OPTIONS: CaseStatus[] = ["open", "in_progress", "resolved", "closed"];

const db = supabase as unknown as { from: (table: string) => ReturnType<typeof supabase.from> };

function statusTone(s: string) {
  if (s === "open") return "bg-destructive/10 text-destructive border-destructive/30";
  if (s === "in_progress") return "bg-warning/10 text-warning border-warning/30";
  if (s === "resolved") return "bg-accent/10 text-accent border-accent/30";
  return "bg-muted text-muted-foreground";
}

type InquiryRow = {
  id: string;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  grade_interest: string | null;
  message: string;
  status: CaseStatus;
  created_at: string;
};

type ComplaintRow = {
  id: string;
  complainant_name: string;
  subject: string;
  body: string;
  category: string;
  status: CaseStatus;
  created_at: string;
  students?: { full_name: string } | null;
};

export function InquiriesReport() {
  const [rows, setRows] = useState<InquiryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await db.from("school_inquiries").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRows((data as InquiryRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    reload();
  }, []);

  const updateStatus = async (id: string, status: CaseStatus) => {
    const { error } = await db.from("school_inquiries").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Updated");
      reload();
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground py-8 text-center">Loading inquiries…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground py-8 text-center">No inquiries recorded.</p>;

  return (
    <div>
      {rows.map((r) => (
        <Card key={r.id} className="p-4 shadow-card space-y-2">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <div className="font-semibold">{r.contact_name}</div>
              <div className="text-xs text-muted-foreground">
                {[r.contact_phone, r.contact_email, r.grade_interest ? `Grade ${r.grade_interest}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
              </div>
            </div>
            <Badge variant="outline" className={statusTone(r.status)}>
              {toEnumLabel(r.status, "case_status")}
            </Badge>
          </div>
          <p className="text-sm">{r.message}</p>
          <Select value={r.status} onValueChange={(v) => updateStatus(r.id, v as CaseStatus)}>
            <SelectTrigger className="max-w-xs h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {toEnumLabel(s, "case_status")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Card>
      ))}
    </div>
  );
}

export function ComplaintsReport({ allowSubmit = false }: { allowSubmit?: boolean }) {
  const { user, schoolId } = useAuth();
  const [rows, setRows] = useState<ComplaintRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ subject: "", body: "", category: "general", complainant_name: "" });

  const reload = async () => {
    setLoading(true);
    const { data, error } = await db.from("school_complaints").select("*, students(full_name)").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRows((data as ComplaintRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    reload();
  }, []);

  const updateStatus = async (id: string, status: CaseStatus) => {
    const { error } = await db.from("school_complaints").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Updated");
      reload();
    }
  };

  const submit = async () => {
    if (!user || !form.subject.trim() || !form.body.trim()) return;
    if (!schoolId) {
      toast.error("Missing school context. Sign in again.");
      return;
    }
    const { error } = await db.from("school_complaints").insert({
      subject: form.subject.trim(),
      body: form.body.trim(),
      category: form.category,
      complainant_name: form.complainant_name.trim() || "Parent",
      submitted_by: user.id,
      school_id: schoolId,
      status: "open",
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Complaint submitted");
      setForm({ subject: "", body: "", category: "general", complainant_name: "" });
      reload();
    }
  };

  return (
    <div className="space-y-4">
      {allowSubmit && (
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold text-sm">File a complaint</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Name</Label>
            <Input value={form.complainant_name} onChange={(e) => setForm({ ...form, complainant_name: e.target.value })} />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["general", "academic", "discipline", "facilities", "fees"].map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Subject</Label>
          <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </div>
        <div>
          <Label>Details</Label>
          <Textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </div>
        <Button onClick={submit} className="bg-gradient-primary text-primary-foreground">
          Submit complaint
        </Button>
      </Card>
      )}
      {loading ? (
        <p className="text-center py-6 text-muted-foreground text-sm">Loading…</p>
      ) : !rows.length ? (
        <p className="text-center py-6 text-muted-foreground text-sm">No complaints yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="p-4 shadow-card space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <div>{r.subject}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.complainant_name}
                    {r.students?.full_name ? ` · ${r.students.full_name}` : ""}
                    {" · "}
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </div>
                </div>
                <Badge variant="outline" className={statusTone(r.status)}>
                  {toEnumLabel(r.status, "case_status")}
                </Badge>
              </div>
              <p className="text-sm">{r.body}</p>
              <Select value={r.status} onValueChange={(v) => updateStatus(r.id, v as CaseStatus)}>
                <SelectTrigger className="max-w-xs h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {toEnumLabel(s, "case_status")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
