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
import { Plus, Bell } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";
import { formatDistanceToNow } from "date-fns";

export default function NoticesPage({ canPost = false }: { canPost?: boolean }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", audience: "all", class_id: "" });

  const load = async () => {
    const { data } = await supabase.from("notices").select("*, classes(name,section)").order("created_at", { ascending: false }).limit(100);
    setRows(data ?? []);
  };
  useEffect(() => {
    load();
    if (canPost) supabase.from("classes").select("*").order("name").then(({ data }) => setClasses(data ?? []));
  }, [canPost]);

  const post = async () => {
    if (!form.title || !form.body) return toast.error("Title and body required");
    const needsClass = form.audience === "class" || form.audience === "section";
    if (needsClass && !form.class_id) return toast.error("Select a class");
    const { error } = await supabase.from("notices").insert({
      title: form.title, body: form.body, audience: form.audience as any,
      class_id: needsClass ? form.class_id : null,
      posted_by: user?.id,
    });
    if (error) return toast.error(error.message);
    toast.success("Notice posted");
    setOpen(false);
    setForm({ title: "", body: "", audience: "all", class_id: "" });
    load();
  };

  return (
    <>
      <PageHeader title="Notice Board" subtitle="School-wide announcements"
        action={canPost && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="bg-gradient-primary text-primary-foreground"><Plus className="w-4 h-4 mr-1" /> Post Notice</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New notice</DialogTitle></DialogHeader>
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
                {(form.audience === "class" || form.audience === "section") && (
                  <div><Label>Class</Label>
                    <Select value={form.class_id} onValueChange={v => setForm({ ...form, class_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                      <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>Class {c.name}-{c.section}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <Button className="w-full bg-gradient-primary text-primary-foreground" onClick={post}>Publish</Button>
              </div>
            </DialogContent>
          </Dialog>
        )} />

      <div className="space-y-3">
        {rows.map(r => (
          <Card key={r.id} className="p-5 shadow-card">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><Bell className="w-5 h-5" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-semibold">{r.title}</h3>
                  <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{r.body}</p>
                <div className="mt-2 flex gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary capitalize">{r.audience}</span>
                  {r.classes && <span className="px-2 py-0.5 rounded bg-accent/10 text-accent">Class {r.classes.name}-{r.classes.section}</span>}
                </div>
              </div>
            </div>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-muted-foreground text-center py-12">No notices yet.</p>}
      </div>
    </>
  );
}
