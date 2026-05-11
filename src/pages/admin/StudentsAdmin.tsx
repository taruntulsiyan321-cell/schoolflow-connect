import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, ShieldCheck, Link2, Loader2, UserX, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";

const EMPTY = {
  full_name: "", admission_number: "", roll_number: "", class_id: "",
  parent_name: "", parent_mobile: "", address: "", date_of_birth: "",
  link_email: "",
};

export default function StudentsAdmin() {
  const [rows, setRows] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [search, setSearch] = useState("");

  const load = async () => {
    const { data } = await supabase.from("students").select("*, classes(name,section,kind,display_name)").order("created_at", { ascending: false });
    setRows(data ?? []);
    const { data: c } = await supabase.from("classes").select("*").order("created_at");
    setClasses(c ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.full_name || !form.admission_number) return toast.error("Name and admission number required");
    const { link_email, ...rest } = form;
    const payload = { ...rest, class_id: form.class_id || null, date_of_birth: form.date_of_birth || null };
    const { data: created, error } = await supabase.from("students").insert(payload).select().single();
    if (error) return toast.error(error.message);

    if (link_email?.trim()) {
      const { error: linkErr } = await supabase.functions.invoke("admin-link-account", {
        body: { kind: "student", target_id: created.id, identifier: link_email.trim(), as: "student" },
      });
      if (linkErr) toast.warning("Student created, but account linking failed: " + linkErr.message);
      else toast.success("Student created and account linked");
    } else {
      toast.success("Student added");
    }
    setAddOpen(false); setForm({ ...EMPTY }); load();
  };

  const openEdit = (r: any) => {
    setEditTarget(r);
    setForm({
      full_name: r.full_name ?? "", admission_number: r.admission_number ?? "",
      roll_number: r.roll_number ?? "", class_id: r.class_id ?? "",
      parent_name: r.parent_name ?? "", parent_mobile: r.parent_mobile ?? "",
      address: r.address ?? "", date_of_birth: r.date_of_birth ?? "",
      link_email: "",
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!form.full_name || !form.admission_number) return toast.error("Name and admission number required");
    const { link_email, ...rest } = form;
    const payload = { ...rest, class_id: form.class_id || null, date_of_birth: form.date_of_birth || null };
    const { error } = await supabase.from("students").update(payload).eq("id", editTarget.id);
    if (error) return toast.error(error.message);
    toast.success("Student updated");
    setEditOpen(false); setEditTarget(null); load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete this student? This cannot be undone.")) return;
    const { error } = await supabase.from("students").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Student deleted"); load();
  };

  const filtered = rows.filter(r =>
    !search ||
    r.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.admission_number?.includes(search)
  );

  const classLabel = (c: any) => c.kind === "batch" ? c.display_name : `Class ${c.name} - ${c.section}`;

  const fields = (
    <div className="space-y-3">
      <div><Label>Full Name *</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Admission # *</Label><Input value={form.admission_number} onChange={e => setForm({ ...form, admission_number: e.target.value })} /></div>
        <div><Label>Roll #</Label><Input value={form.roll_number} onChange={e => setForm({ ...form, roll_number: e.target.value })} /></div>
      </div>
      <div><Label>Class / Batch</Label>
        <Select value={form.class_id} onValueChange={v => setForm({ ...form, class_id: v })}>
          <SelectTrigger><SelectValue placeholder="Select class or batch" /></SelectTrigger>
          <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>{classLabel(c)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Label>Date of Birth</Label><Input type="date" value={form.date_of_birth} onChange={e => setForm({ ...form, date_of_birth: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Parent Name</Label><Input value={form.parent_name} onChange={e => setForm({ ...form, parent_name: e.target.value })} /></div>
        <div><Label>Parent Mobile</Label><Input value={form.parent_mobile} onChange={e => setForm({ ...form, parent_mobile: e.target.value })} /></div>
      </div>
      <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
    </div>
  );

  return (
    <>
      <PageHeader title="Students" subtitle={`${rows.length} enrolled`}
        action={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary text-primary-foreground"><Plus className="w-4 h-4 mr-1" /> Add Student</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New Student</DialogTitle></DialogHeader>
              {fields}
              <div className="mt-4 p-3 rounded-lg border bg-gradient-soft">
                <Label className="flex items-center gap-1.5 text-xs"><ShieldCheck className="w-3.5 h-3.5 text-primary" /> Link account (optional)</Label>
                <Input
                  className="mt-1.5"
                  placeholder="student@gmail.com or +9198…"
                  value={form.link_email}
                  onChange={e => setForm({ ...form, link_email: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  We'll create the student account immediately — no need to wait for them to sign in first.
                </p>
              </div>
              <Button className="w-full bg-gradient-primary text-primary-foreground mt-3" onClick={add}>Create Student</Button>
            </DialogContent>
          </Dialog>
        } />

      <div className="mb-4">
        <Input placeholder="Search by name or admission number…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="space-y-2">
        {filtered.map(r => (
          <Card key={r.id} className="p-4 flex items-center justify-between shadow-card">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold truncate">{r.full_name}</span>
                {r.user_id ? (
                  <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30 text-[10px]">
                    <ShieldCheck className="w-3 h-3 mr-0.5" /> Linked
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    <ShieldAlert className="w-3 h-3 mr-0.5" /> No account
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Adm# {r.admission_number} · Roll {r.roll_number || "-"} · {r.classes ? (r.classes.kind === "batch" ? r.classes.display_name : `Class ${r.classes.name}-${r.classes.section}`) : "Unassigned"}
              </div>
              {r.parent_name && <div className="text-xs text-muted-foreground mt-0.5">Parent: {r.parent_name}{r.parent_mobile ? ` · ${r.parent_mobile}` : ""}</div>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="w-4 h-4 text-primary" /></Button>
              <Button size="sm" variant="ghost" onClick={() => del(r.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <p className="text-muted-foreground text-center py-8">No students found.</p>}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Student</DialogTitle></DialogHeader>
          {fields}
          {editTarget && <StudentAccountAccess student={editTarget} onChanged={load} />}
          <Button className="w-full bg-gradient-primary text-primary-foreground mt-3" onClick={saveEdit}>Save Changes</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StudentAccountAccess({ student, onChanged }: { student: any; onChanged: () => void }) {
  const [s, setS] = useState(student);
  const [identifier, setIdentifier] = useState("");
  const [as, setAs] = useState<"student" | "parent">("student");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setS(student); }, [student]);

  const refresh = async () => {
    const { data } = await supabase.from("students").select("*").eq("id", s.id).single();
    setS(data); onChanged();
  };

  const link = async () => {
    if (!identifier.trim()) return toast.error("Email or mobile required");
    setBusy(true);
    const { error } = await supabase.functions.invoke("admin-link-account", {
      body: { kind: "student", target_id: s.id, identifier: identifier.trim(), as },
    });
    setBusy(false);
    if (error) return toast.error(error.message || "Could not link account");
    toast.success("Account linked");
    setIdentifier(""); refresh();
  };

  const revoke = async () => {
    if (!confirm("Disconnect this student's account?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_revoke_student_account", { _student_id: s.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Account disconnected");
    refresh();
  };

  const linked = !!s.user_id;
  const parentLinked = !!s.parent_user_id;

  return (
    <div className="mt-4 p-4 rounded-xl border bg-gradient-soft">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-primary" />
        <h4 className="font-semibold text-sm">Account Access</h4>
      </div>
      <div className="flex items-center gap-2 text-xs mb-3">
        <Badge variant="outline" className={linked ? "bg-accent/10 text-accent border-accent/30" : "text-muted-foreground"}>
          Student: {linked ? "Linked" : "Not linked"}
        </Badge>
        <Badge variant="outline" className={parentLinked ? "bg-accent/10 text-accent border-accent/30" : "text-muted-foreground"}>
          Parent: {parentLinked ? "Linked" : "Not linked"}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Select value={as} onValueChange={(v) => setAs(v as any)}>
          <SelectTrigger className="col-span-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="student">Student</SelectItem>
            <SelectItem value="parent">Parent</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="col-span-2"
          value={identifier} onChange={e => setIdentifier(e.target.value)}
          placeholder="Google email or mobile"
          disabled={busy}
        />
      </div>
      <div className="flex gap-2 mt-2">
        <Button onClick={link} disabled={busy} className="bg-gradient-primary text-primary-foreground flex-1">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Link2 className="w-4 h-4 mr-1" /> Link account</>}
        </Button>
        {linked && (
          <Button variant="outline" onClick={revoke} disabled={busy}>
            <UserX className="w-4 h-4 mr-1 text-destructive" /> Disconnect student
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        The account is created immediately if it doesn't exist. The user can sign in via Google or magic link with this email.
      </p>
    </div>
  );
}
