import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Link2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";

type Mode = { type: "student"; row: any } | { type: "parent"; row: any } | { type: "teacher"; row: any } | null;

export default function LinkUsersAdmin() {
  const [students, setStudents] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [email, setEmail] = useState("");

  const load = async () => {
    const { data: s } = await supabase.from("students").select("id, full_name, admission_number, user_id, parent_user_id, parent_name");
    setStudents(s ?? []);
    const { data: t } = await supabase.from("teachers").select("id, full_name, user_id, email");
    setTeachers(t ?? []);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!mode) return;
    if (!email.trim()) return toast.error("Email required");
    let res;
    if (mode.type === "teacher") {
      res = await supabase.rpc("admin_link_user_to_teacher", { _teacher_id: mode.row.id, _email: email.trim() });
    } else {
      res = await supabase.rpc("admin_link_user_to_student", { _student_id: mode.row.id, _email: email.trim(), _as: mode.type });
    }
    if (res.error) return toast.error(res.error.message);
    toast.success("Linked successfully");
    setMode(null); setEmail(""); load();
  };

  return (
    <>
      <PageHeader title="Link User Accounts" subtitle="Connect signed-up users to student / parent / teacher records" />

      <Card className="p-4 mb-4 bg-primary/5 border-primary/20">
        <p className="text-sm">
          <strong>How it works:</strong> Ask the user to sign up first with their email and select the right role.
          Then come here and link their email to the matching record.
        </p>
      </Card>

      <h3 className="font-semibold mb-2 mt-6">Students</h3>
      <div className="space-y-2 mb-6">
        {students.map(s => (
          <Card key={s.id} className="p-3 flex items-center justify-between gap-2 shadow-card">
            <div className="min-w-0">
              <div className="font-medium truncate">{s.full_name}</div>
              <div className="text-xs text-muted-foreground">
                Adm# {s.admission_number} ·
                {s.user_id ? <span className="text-accent"> Student linked ✓</span> : <span> Student not linked</span>} ·
                {s.parent_user_id ? <span className="text-accent"> Parent linked ✓</span> : <span> Parent {s.parent_name ? `(${s.parent_name})` : ""} not linked</span>}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="outline" onClick={() => { setMode({ type: "student", row: s }); setEmail(""); }}>
                <Link2 className="w-3.5 h-3.5 mr-1" /> Student
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setMode({ type: "parent", row: s }); setEmail(""); }}>
                <Link2 className="w-3.5 h-3.5 mr-1" /> Parent
              </Button>
            </div>
          </Card>
        ))}
        {students.length === 0 && <p className="text-muted-foreground text-sm">No students yet.</p>}
      </div>

      <h3 className="font-semibold mb-2">Teachers</h3>
      <div className="space-y-2">
        {teachers.map(t => (
          <Card key={t.id} className="p-3 flex items-center justify-between gap-2 shadow-card">
            <div className="min-w-0">
              <div className="font-medium truncate">{t.full_name}</div>
              <div className="text-xs text-muted-foreground">
                {t.user_id ? <span className="text-accent">Linked ✓</span> : "Not linked"}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => { setMode({ type: "teacher", row: t }); setEmail(t.email || ""); }}>
              <Link2 className="w-3.5 h-3.5 mr-1" /> Link
            </Button>
          </Card>
        ))}
        {teachers.length === 0 && <p className="text-muted-foreground text-sm">No teachers yet.</p>}
      </div>

      <Dialog open={!!mode} onOpenChange={(v) => !v && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Link {mode?.type} account to {mode?.row.full_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-muted text-sm flex gap-2">
              <UserCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>The user must already have signed up with this email.</span>
            </div>
            <div>
              <Label>User email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" />
            </div>
            <Button className="w-full bg-gradient-primary text-primary-foreground" onClick={submit}>Link account</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
