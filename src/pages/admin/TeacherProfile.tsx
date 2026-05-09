import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save, Trash2, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";

const EMPTY = {
  full_name: "", subject: "", mobile: "", email: "", address: "",
  employee_id: "", department: "", qualification: "", joining_date: "",
  photo_url: "", salary: "", status: "active", notes: "",
  is_class_teacher: false, class_teacher_of: "" as string | null,
};

export default function TeacherProfile() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(EMPTY);
  const [classes, setClasses] = useState<any[]>([]);
  const [teaching, setTeaching] = useState<string[]>([]);
  const [originalCT, setOriginalCT] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: t }, { data: c }, { data: tc }] = await Promise.all([
      supabase.from("teachers").select("*").eq("id", id).single(),
      supabase.from("classes").select("*").order("name"),
      supabase.from("teacher_classes").select("class_id").eq("teacher_id", id),
    ]);
    if (!t) { toast.error("Teacher not found"); nav(-1); return; }
    setForm({
      ...EMPTY,
      ...t,
      salary: t.salary ?? "",
      joining_date: t.joining_date ?? "",
      class_teacher_of: t.class_teacher_of ?? "",
      is_class_teacher: !!t.is_class_teacher,
    });
    setOriginalCT(t.class_teacher_of ?? null);
    setClasses(c ?? []);
    setTeaching((tc ?? []).map((r: any) => r.class_id));
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.full_name?.trim()) return toast.error("Full name is required");
    setSaving(true);

    // Prevent duplicate class teacher assignment
    if (form.is_class_teacher && form.class_teacher_of && form.class_teacher_of !== originalCT) {
      const { data: dup } = await supabase
        .from("teachers")
        .select("id, full_name")
        .eq("class_teacher_of", form.class_teacher_of)
        .neq("id", id!)
        .maybeSingle();
      if (dup) {
        setSaving(false);
        return toast.error(`${dup.full_name} is already class teacher of that class`);
      }
    }

    const payload: any = {
      full_name: form.full_name.trim(),
      subject: form.subject || null,
      mobile: form.mobile || null,
      email: form.email || null,
      address: form.address || null,
      employee_id: form.employee_id || null,
      department: form.department || null,
      qualification: form.qualification || null,
      joining_date: form.joining_date || null,
      photo_url: form.photo_url || null,
      salary: form.salary === "" ? null : Number(form.salary),
      status: form.status || "active",
      notes: form.notes || null,
      is_class_teacher: form.is_class_teacher,
      class_teacher_of: form.is_class_teacher && form.class_teacher_of ? form.class_teacher_of : null,
    };
    const { error } = await supabase.from("teachers").update(payload).eq("id", id!);
    if (error) { setSaving(false); return toast.error(error.message); }

    // Sync teaching classes
    await supabase.from("teacher_classes").delete().eq("teacher_id", id!);
    if (teaching.length) {
      await supabase.from("teacher_classes").insert(
        teaching.map(cid => ({ teacher_id: id!, class_id: cid, subject: form.subject || null }))
      );
    }
    setOriginalCT(payload.class_teacher_of);
    setSaving(false);
    toast.success("Teacher profile updated");
  };

  const removeClassTeacherRole = async () => {
    if (!confirm("Remove class teacher role from this teacher?")) return;
    const { error } = await supabase
      .from("teachers")
      .update({ is_class_teacher: false, class_teacher_of: null })
      .eq("id", id!);
    if (error) return toast.error(error.message);
    set("is_class_teacher", false);
    set("class_teacher_of", "");
    setOriginalCT(null);
    toast.success("Class teacher role removed");
  };

  const deleteTeacher = async () => {
    if (!confirm("Permanently delete this teacher? This cannot be undone.")) return;
    const { error } = await supabase.from("teachers").delete().eq("id", id!);
    if (error) return toast.error(error.message);
    toast.success("Teacher deleted");
    nav(-1);
  };

  const toggleTeaching = (cid: string) => {
    setTeaching(t => t.includes(cid) ? t.filter(x => x !== cid) : [...t, cid]);
  };

  if (loading) return <p className="text-muted-foreground p-8 text-center">Loading…</p>;

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <Button size="sm" variant="ghost" onClick={() => nav(-1)}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
      </div>
      <PageHeader
        title={form.full_name || "Teacher"}
        subtitle={[form.department, form.subject, form.employee_id && `ID ${form.employee_id}`].filter(Boolean).join(" · ") || "Teacher profile"}
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={deleteTeacher}><Trash2 className="w-4 h-4 mr-1 text-destructive" /> Delete</Button>
            <Button size="sm" className="bg-gradient-primary text-primary-foreground" disabled={saving} onClick={save}>
              <Save className="w-4 h-4 mr-1" /> {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="basic" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="basic">Basic info</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="classes">Classes &amp; subjects</TabsTrigger>
          <TabsTrigger value="classteacher">Class teacher</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <Card className="p-5 space-y-3 shadow-card">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>Full name *</Label><Input value={form.full_name} onChange={e => set("full_name", e.target.value)} /></div>
              <div><Label>Mobile</Label><Input value={form.mobile} onChange={e => set("mobile", e.target.value)} /></div>
              <div><Label>Email</Label><Input value={form.email} onChange={e => set("email", e.target.value)} /></div>
              <div><Label>Photo URL</Label><Input value={form.photo_url} onChange={e => set("photo_url", e.target.value)} /></div>
              <div className="md:col-span-2"><Label>Address</Label><Textarea rows={2} value={form.address} onChange={e => set("address", e.target.value)} /></div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="employment">
          <Card className="p-5 space-y-3 shadow-card">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>Employee ID</Label><Input value={form.employee_id} onChange={e => set("employee_id", e.target.value)} /></div>
              <div><Label>Department</Label><Input value={form.department} onChange={e => set("department", e.target.value)} /></div>
              <div><Label>Qualification</Label><Input value={form.qualification} onChange={e => set("qualification", e.target.value)} /></div>
              <div><Label>Joining date</Label><Input type="date" value={form.joining_date || ""} onChange={e => set("joining_date", e.target.value)} /></div>
              <div><Label>Salary</Label><Input type="number" value={form.salary} onChange={e => set("salary", e.target.value)} /></div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="on_leave">On leave</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="classes">
          <Card className="p-5 space-y-3 shadow-card">
            <div><Label>Primary subject</Label><Input value={form.subject} onChange={e => set("subject", e.target.value)} /></div>
            <div>
              <Label>Teaches in classes</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 mt-2">
                {classes.map(c => (
                  <button key={c.id} type="button" onClick={() => toggleTeaching(c.id)}
                    className={`text-xs px-2 py-1.5 rounded border ${teaching.includes(c.id) ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>
                    {c.name}-{c.section}
                  </button>
                ))}
                {classes.length === 0 && <p className="text-xs text-muted-foreground col-span-full">No classes yet — create them first.</p>}
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="classteacher">
          <Card className="p-5 space-y-4 shadow-card">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
              <div>
                <Label className="text-base">Assigned as class teacher</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Manage class teacher role and assignment here.</p>
              </div>
              <Switch checked={form.is_class_teacher} onCheckedChange={v => { set("is_class_teacher", v); if (!v) set("class_teacher_of", ""); }} />
            </div>

            {form.is_class_teacher && (
              <div>
                <Label>Class teacher of</Label>
                <Select value={form.class_teacher_of || ""} onValueChange={v => set("class_teacher_of", v)}>
                  <SelectTrigger><SelectValue placeholder="Choose class" /></SelectTrigger>
                  <SelectContent>
                    {classes.map(c => <SelectItem key={c.id} value={c.id}>Class {c.name}-{c.section}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-2">
                  Use this to transfer responsibilities — selecting a different class on Save reassigns the class teacher role.
                  The system blocks duplicate assignments automatically.
                </p>
              </div>
            )}

            {originalCT && (
              <Button variant="outline" onClick={removeClassTeacherRole}>
                <ShieldOff className="w-4 h-4 mr-2" /> Remove class teacher role
              </Button>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card className="p-5 shadow-card">
            <Label>Internal notes / comments</Label>
            <Textarea rows={6} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Visible to admins only." />
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
