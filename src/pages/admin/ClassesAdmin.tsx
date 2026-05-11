import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, ChevronRight, Layers, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui-bits";

const CLASS_NAMES = ["PG", "Nursery", "KG", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const SECTIONS = ["A", "B", "C", "D"];

export default function ClassesAdmin() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [tab, setTab] = useState<"class" | "batch">("class");

  // class dialog
  const [classOpen, setClassOpen] = useState(false);
  const [className, setClassName] = useState("1");
  const [section, setSection] = useState("A");

  // batch dialog
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchEditId, setBatchEditId] = useState<string | null>(null);
  const [batchName, setBatchName] = useState("");
  const [batchCategory, setBatchCategory] = useState("");
  const [batchYear, setBatchYear] = useState(new Date().getFullYear().toString());

  const load = async () => {
    const { data } = await supabase.from("classes").select("*").order("created_at", { ascending: false });
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const addClass = async () => {
    const { error } = await supabase.from("classes").insert({ name: className, section, kind: "class" });
    if (error) return toast.error(error.message);
    toast.success("Class added"); setClassOpen(false); load();
  };

  const openBatchNew = () => {
    setBatchEditId(null); setBatchName(""); setBatchCategory("");
    setBatchYear(new Date().getFullYear().toString()); setBatchOpen(true);
  };
  const openBatchEdit = (r: any) => {
    setBatchEditId(r.id);
    setBatchName(r.display_name || ""); setBatchCategory(r.category || "");
    setBatchYear(r.academic_year || new Date().getFullYear().toString());
    setBatchOpen(true);
  };
  const saveBatch = async () => {
    if (!batchName.trim()) return toast.error("Batch name required");
    const payload = {
      kind: "batch",
      display_name: batchName.trim(),
      category: batchCategory.trim() || null,
      academic_year: batchYear || new Date().getFullYear().toString(),
      // satisfy legacy non-empty defaults
      name: batchEditId ? undefined : null,
      section: batchEditId ? undefined : null,
    };
    const { error } = batchEditId
      ? await supabase.from("classes").update({
          display_name: payload.display_name, category: payload.category, academic_year: payload.academic_year,
        }).eq("id", batchEditId)
      : await supabase.from("classes").insert(payload as any);
    if (error) return toast.error(error.message);
    toast.success(batchEditId ? "Batch updated" : "Batch created");
    setBatchOpen(false); load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete this entry?")) return;
    const { error } = await supabase.from("classes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  };

  const items = rows.filter(r => (r.kind || "class") === tab);

  return (
    <>
      <PageHeader
        title="Classes & Batches"
        subtitle="Manage school classes, coaching batches, and special programs"
        action={
          tab === "class" ? (
            <Dialog open={classOpen} onOpenChange={setClassOpen}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-primary text-primary-foreground"><Plus className="w-4 h-4 mr-1" /> Add Class</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Class</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Class</Label>
                    <Select value={className} onValueChange={setClassName}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CLASS_NAMES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Section</Label>
                    <Select value={section} onValueChange={setSection}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SECTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button className="w-full bg-gradient-primary text-primary-foreground" onClick={addClass}>Create</Button>
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <Button className="bg-gradient-primary text-primary-foreground" onClick={openBatchNew}>
              <Plus className="w-4 h-4 mr-1" /> Add Batch
            </Button>
          )
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="mb-4">
        <TabsList>
          <TabsTrigger value="class"><BookOpen className="w-4 h-4 mr-1.5" /> School Classes</TabsTrigger>
          <TabsTrigger value="batch"><Layers className="w-4 h-4 mr-1.5" /> Batches & Programs</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map(r => (
          <Card key={r.id} className="p-4 shadow-card hover:shadow-elevated transition-shadow group">
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => nav(`/admin/classes/${r.id}`)} className="flex-1 text-left min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px] uppercase">{r.kind === "batch" ? "Batch" : "Class"}</Badge>
                  {r.category && <Badge variant="secondary" className="text-[10px]">{r.category}</Badge>}
                </div>
                <div className="font-bold text-lg leading-tight truncate">
                  {r.kind === "batch" ? r.display_name : `Class ${r.name}`}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {r.kind === "batch" ? `Academic year ${r.academic_year}` : `Section ${r.section} · ${r.academic_year}`}
                </div>
              </button>
              <div className="flex items-center gap-0.5 shrink-0">
                {r.kind === "batch" && (
                  <Button size="sm" variant="ghost" onClick={() => openBatchEdit(r)}><Pencil className="w-4 h-4 text-primary" /></Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => del(r.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>
          </Card>
        ))}
        {items.length === 0 && (
          <p className="text-muted-foreground col-span-full text-center py-12 text-sm">
            {tab === "class" ? "No classes yet — add your first class to get started." : "No batches yet — create batches like “NEET Morning” or “JEE Crash Course”."}
          </p>
        )}
      </div>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{batchEditId ? "Edit Batch" : "New Batch / Program"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Batch name *</Label>
              <Input value={batchName} onChange={e => setBatchName(e.target.value)} placeholder="e.g. NEET Morning Batch" />
            </div>
            <div>
              <Label>Category (optional)</Label>
              <Input value={batchCategory} onChange={e => setBatchCategory(e.target.value)} placeholder="Coaching, Olympiad, Crash Course…" />
            </div>
            <div>
              <Label>Academic year</Label>
              <Input value={batchYear} onChange={e => setBatchYear(e.target.value)} />
            </div>
            <Button className="w-full bg-gradient-primary text-primary-foreground" onClick={saveBatch}>
              {batchEditId ? "Save changes" : "Create batch"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
