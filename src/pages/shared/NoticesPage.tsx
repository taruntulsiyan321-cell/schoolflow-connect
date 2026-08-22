import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Bell, Pencil, Trash2, Ban, Megaphone, Clock, Users, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";
import { formatDistanceToNow } from "date-fns";
import { classLabel } from "@/lib/utils";
import { resolveParentLinkedStudentIds } from "@/lib/parentLinkedStudents";

const EMPTY = { title: "", body: "", audience: "all", class_id: "", expiresIn: "none", customExpiry: "" };

export default function NoticesPage({ canPost = false, viewerRole }: { canPost?: boolean; viewerRole?: string }) {
  const { user, role, schoolId } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(EMPTY);

  const effectiveRole = viewerRole || role;
  const isAdmin = effectiveRole === "admin";
  const isPrincipal = effectiveRole === "principal";
  const isManager = isAdmin || isPrincipal;

  const load = async () => {
    const { data } = await supabase.from("notices").select("*, classes(name,section)").order("created_at", { ascending: false }).limit(200);
    let filtered = data ?? [];

    if (!isManager) {
      // Hide revoked notices from non-admins/non-principals
      filtered = filtered.filter(n => !n.revoked_at);

      if (!canPost) {
        // Hide expired notices for end-viewers
        const now = new Date().toISOString();
        filtered = filtered.filter(n => !n.expires_at || n.expires_at > now);

        let studentClassId: string | null = null;
        if (effectiveRole === "student" && user) {
          const { data: s } = await supabase.from("students").select("class_id").eq("user_id", user.id).maybeSingle();
          studentClassId = s?.class_id || null;
        } else if (effectiveRole === "parent" && user && schoolId) {
          const childIds = await resolveParentLinkedStudentIds(schoolId, user.id);
          if (childIds.length) {
            const { data: kids } = await supabase.from("students").select("class_id").in("id", childIds);
            studentClassId = kids?.[0]?.class_id || null;
          }
        }

        filtered = filtered.filter((n) => {
          if (n.audience === "all") return true;
          if (n.audience === "students" && effectiveRole === "student") return true;
          if (n.audience === "students" && effectiveRole === "parent") return true;
          if (n.audience === "parents" && effectiveRole === "parent") return true;
          if (n.audience === "teachers" && effectiveRole === "teacher") return true;
          if ((n.audience === "class" || n.audience === "section") && n.class_id && studentClassId) {
            return n.class_id === studentClassId;
          }
          return false;
        });
      }
    }

    setRows(filtered);
  };

  useEffect(() => {
    load();
    if (canPost) supabase.from("classes").select("*").order("name").then(({ data }) => setClasses(data ?? []));
  }, [canPost, user, schoolId]);

  const computeExpiry = (): string | null => {
    if (form.expiresIn === "none") return null;
    if (form.expiresIn === "custom") return form.customExpiry ? new Date(form.customExpiry).toISOString() : null;
    const d = new Date();
    if (form.expiresIn === "1_hour") d.setHours(d.getHours() + 1);
    if (form.expiresIn === "1_day") d.setDate(d.getDate() + 1);
    if (form.expiresIn === "3_days") d.setDate(d.getDate() + 3);
    if (form.expiresIn === "1_week") d.setDate(d.getDate() + 7);
    return d.toISOString();
  };

  const submit = async () => {
    if (!form.title || !form.body) return toast.error("Title and body required");
    const needsClass = form.audience === "class" || form.audience === "section";
    if (needsClass && !form.class_id) return toast.error("Select a class");

    const payload: any = {
      title: form.title, body: form.body, audience: form.audience as any,
      class_id: needsClass ? form.class_id : null,
      expires_at: computeExpiry(),
    };

    if (editingId) {
      const { error } = await supabase.from("notices").update(payload).eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success("Notice updated");
    } else {
      payload.posted_by = user?.id;
      const { error } = await supabase.from("notices").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Notice published");
    }
    setOpen(false); setEditingId(null); setForm(EMPTY); load();
  };

  const beginEdit = (n: any) => {
    setEditingId(n.id);
    setForm({
      title: n.title, body: n.body, audience: n.audience,
      class_id: n.class_id || "",
      expiresIn: n.expires_at ? "custom" : "none",
      customExpiry: n.expires_at ? new Date(n.expires_at).toISOString().slice(0, 16) : "",
    });
    setOpen(true);
  };

  const revoke = async (n: any) => {
    if (!confirm("Revoke this notice? It will disappear from all panels immediately.")) return;
    const { error } = await supabase.from("notices").update({ revoked_at: new Date().toISOString() }).eq("id", n.id);
    if (error) return toast.error(error.message);
    toast.success("Notice revoked");
    load();
  };

  const del = async (n: any) => {
    if (!confirm("Permanently delete this notice?")) return;
    const { error } = await supabase.from("notices").delete().eq("id", n.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  const now = Date.now();
  const isMine = (n: any) => n.posted_by === user?.id;
  const canManage = (n: any) => isManager || isMine(n);
  const isExpired = (n: any) => n.expires_at && new Date(n.expires_at).getTime() <= now;
  const isRevoked = (n: any) => !!n.revoked_at;

  const active = rows.filter(n => !isExpired(n) && !isRevoked(n));
  const expired = rows.filter(n => isExpired(n) && !isRevoked(n));
  const archived = rows.filter(n => isRevoked(n));
  const pinned = active[0];
  const classNoticeCount = active.filter((n) => n.audience === "class" || n.audience === "section").length;

  const audienceTone = (audience: string) => {
    if (audience === "all") return "bg-primary/10 text-primary border-primary/20";
    if (audience === "students") return "bg-accent/10 text-accent border-accent/20";
    if (audience === "parents") return "bg-warning/10 text-warning border-warning/20";
    if (audience === "teachers") return "bg-blue-500/10 text-blue-700 border-blue-500/20";
    return "bg-secondary/10 text-secondary border-secondary/20";
  };

  const renderList = (list: any[], showState?: "expired" | "revoked") => (
    <div className="grid gap-3">
      {list.map(r => (
        <Card key={r.id} className={`overflow-hidden border-border/70 bg-card/95 p-0 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elevated ${showState ? "opacity-70" : ""}`}>
          <div className="flex items-start gap-4 p-5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/15 to-accent/15 text-primary flex items-center justify-center shrink-0 ring-1 ring-primary/10">
              <Bell className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-black text-base">{r.title}</h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap leading-relaxed">{r.body}</p>
              <div className="mt-4 flex gap-2 text-xs flex-wrap items-center">
                <span className={`px-2.5 py-1 rounded-full border font-semibold capitalize ${audienceTone(r.audience)}`}>{r.audience}</span>
                {r.classes && <span className="px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/20 font-semibold">{classLabel(r.classes)}</span>}
                {showState === "expired" && <span className="px-2.5 py-1 rounded-full bg-muted font-semibold">Expired</span>}
                {showState === "revoked" && <span className="px-2.5 py-1 rounded-full bg-destructive/10 text-destructive font-semibold">Revoked</span>}
                {!showState && r.expires_at && (
                  <span className="px-2.5 py-1 rounded-full bg-warning/10 text-warning font-semibold">
                    Expires {formatDistanceToNow(new Date(r.expires_at), { addSuffix: true })}
                  </span>
                )}
                {canPost && canManage(r) && !showState && (
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => beginEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => revoke(r)}><Ban className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => del(r)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                  </div>
                )}
                {canPost && canManage(r) && showState && (
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => del(r)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      ))}
      {list.length === 0 && (
        <Card className="p-10 text-center">
          <Megaphone className="w-10 h-10 mx-auto text-muted-foreground opacity-40 mb-2" />
          <p className="font-semibold">Nothing here.</p>
          <p className="text-sm text-muted-foreground mt-1">New announcements will appear as soon as they are posted.</p>
        </Card>
      )}
    </div>
  );

  return (
    <>
      <PageHeader title="Notice Board" subtitle="School-wide announcements"
        action={canPost && (
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditingId(null); setForm(EMPTY); } }}>
            <DialogTrigger asChild><Button className="bg-gradient-primary text-primary-foreground"><Plus className="w-4 h-4 mr-1" /> Post Notice</Button></DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editingId ? "Edit notice" : "New notice"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Title</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
                <div><Label>Message</Label><Textarea rows={5} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></div>
                <div><Label>Audience</Label>
                  <Select value={form.audience} onValueChange={v => setForm({ ...form, audience: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Entire school</SelectItem>
                      <SelectItem value="teachers">Teachers only</SelectItem>
                      <SelectItem value="students">Students only</SelectItem>
                      <SelectItem value="parents">Parents only</SelectItem>
                      <SelectItem value="class">Specific class</SelectItem>
                      <SelectItem value="section">Specific section</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Expiry</Label>
                  <Select value={form.expiresIn} onValueChange={v => setForm({ ...form, expiresIn: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Never expires</SelectItem>
                      <SelectItem value="1_hour">1 hour</SelectItem>
                      <SelectItem value="1_day">1 day</SelectItem>
                      <SelectItem value="3_days">3 days</SelectItem>
                      <SelectItem value="1_week">7 days</SelectItem>
                      <SelectItem value="custom">Custom date / time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.expiresIn === "custom" && (
                  <div><Label>Expires at</Label>
                    <Input type="datetime-local" value={form.customExpiry} onChange={e => setForm({ ...form, customExpiry: e.target.value })} />
                  </div>
                )}
                {(form.audience === "class" || form.audience === "section") && (
                  <div><Label>Class</Label>
                    <Select value={form.class_id} onValueChange={v => setForm({ ...form, class_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                      <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>{classLabel(c)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <Button className="w-full bg-gradient-primary text-primary-foreground" onClick={submit}>
                  {editingId ? "Save changes" : "Publish"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )} />

      <Card className="mb-5 overflow-hidden border-primary/20 bg-gradient-to-br from-[#083f2b] via-[#126847] to-[#b28a28] p-0 text-white shadow-elevated">
        <div className="grid gap-5 p-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white/75">
              <Megaphone className="w-3.5 h-3.5" />
              Campus updates
            </div>
            <h2 className="mt-4 text-2xl font-black">{pinned?.title || "No active notices"}</h2>
            <p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-relaxed text-white/75">
              {pinned?.body || "Important school announcements, class updates, and reminders will appear here."}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-border bg-white/10 p-3 text-center">
              <Sparkles className="w-4 h-4 mx-auto text-white/75" />
              <p className="mt-1 text-xl font-black">{active.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/65">Active</p>
            </div>
            <div className="rounded-2xl border border-border bg-white/10 p-3 text-center">
              <Users className="w-4 h-4 mx-auto text-white/75" />
              <p className="mt-1 text-xl font-black">{classNoticeCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/65">Class</p>
            </div>
            <div className="rounded-2xl border border-border bg-white/10 p-3 text-center">
              <Clock className="w-4 h-4 mx-auto text-white/75" />
              <p className="mt-1 text-xl font-black">{expired.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/65">Expired</p>
            </div>
          </div>
        </div>
      </Card>

      {canPost ? (
        <Tabs defaultValue="active" className="space-y-4">
          <TabsList>
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="expired">Expired ({expired.length})</TabsTrigger>
            <TabsTrigger value="archived">Archived ({archived.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="active">{renderList(active)}</TabsContent>
          <TabsContent value="expired">{renderList(expired, "expired")}</TabsContent>
          <TabsContent value="archived">{renderList(archived, "revoked")}</TabsContent>
        </Tabs>
      ) : renderList(active)}
    </>
  );
}
