import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/ui-bits";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Sparkles, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const subjects = ["Math", "Science", "Physics", "Chemistry", "Biology", "English", "Social Studies", "Computer", "GK"];

type Q = {
  id?: string;
  order_index: number;
  kind: "mcq" | "multi" | "numerical" | "short";
  question: string;
  options: string[];
  correct: any;
  marks: number;
  explanation?: string;
};

const blankQ = (i: number): Q => ({
  order_index: i, kind: "mcq", question: "", options: ["", "", "", ""],
  correct: { indexes: [0] }, marks: 1, explanation: "",
});

export default function DppEditor() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const [dpp, setDpp] = useState<any>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [tab, setTab] = useState("details");
  const [saving, setSaving] = useState(false);
  const [pickCount, setPickCount] = useState(5);
  const [pickDiff, setPickDiff] = useState<string>("any");
  // AI generation state
  const [aiTopic, setAiTopic] = useState("");
  const [aiCount, setAiCount] = useState(5);
  const [aiSource, setAiSource] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const reload = async () => {
    if (!id) return;
    const { data: d } = await supabase.from("dpps").select("*").eq("id", id).maybeSingle();
    setDpp(d);
    const { data: qs } = await supabase.from("dpp_questions").select("*").eq("dpp_id", id).order("order_index");
    setQuestions((qs ?? []).map(q => ({
      id: q.id, order_index: q.order_index, kind: q.kind as any,
      question: q.question, options: Array.isArray(q.options) ? (q.options as string[]) : [],
      correct: q.correct as any, marks: Number(q.marks), explanation: q.explanation ?? "",
    })));
  };

  useEffect(() => {
    reload();
    (async () => {
      if (!user) return;
      const { data: t } = await supabase.from("teachers").select("id, class_teacher_of").eq("user_id", user.id).maybeSingle();
      const ids = new Set<string>();
      if (t?.class_teacher_of) ids.add(t.class_teacher_of);
      const { data: tc } = await supabase.from("teacher_classes").select("class_id").eq("teacher_id", t?.id);
      tc?.forEach(r => ids.add(r.class_id));
      if (ids.size === 0) return;
      const { data: cls } = await supabase.from("classes").select("id,name,section").in("id", Array.from(ids));
      setClasses(cls ?? []);
    })();
  }, [id, user]);

  const saveDetails = async () => {
    if (!dpp) return;
    setSaving(true);
    const { error } = await supabase.from("dpps").update({
      title: dpp.title, subject: dpp.subject, chapter: dpp.chapter, topic: dpp.topic,
      class_id: dpp.class_id, difficulty: dpp.difficulty, instructions: dpp.instructions,
      due_at: dpp.due_at, duration_sec: dpp.duration_sec, negative_marking: dpp.negative_marking,
      is_published: dpp.is_published,
    }).eq("id", dpp.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  };

  const addQuestion = () => setQuestions(qs => [...qs, blankQ(qs.length)]);

  const updateQ = (i: number, patch: Partial<Q>) =>
    setQuestions(qs => qs.map((q, idx) => idx === i ? { ...q, ...patch } : q));

  const removeQ = async (i: number) => {
    const q = questions[i];
    if (q.id) await supabase.from("dpp_questions").delete().eq("id", q.id);
    setQuestions(qs => qs.filter((_, idx) => idx !== i).map((q, idx) => ({ ...q, order_index: idx })));
  };

  const saveQuestions = async () => {
    if (!id) return;
    setSaving(true);
    for (const q of questions) {
      const payload = {
        dpp_id: id, order_index: q.order_index, kind: q.kind,
        question: q.question, options: q.options as any, correct: q.correct as any,
        marks: q.marks, explanation: q.explanation || null,
      };
      if (q.id) await supabase.from("dpp_questions").update(payload).eq("id", q.id);
      else await supabase.from("dpp_questions").insert(payload);
    }
    const total = questions.reduce((a, b) => a + Number(b.marks), 0);
    await supabase.from("dpps").update({ question_count: questions.length, total_marks: total }).eq("id", id);
    setSaving(false);
    toast.success("Questions saved");
    reload();
  };

  const pickFromBank = async () => {
    if (!id) return;
    const { data, error } = await supabase.rpc("rpc_dpp_pick_from_bank", {
      _dpp_id: id, _count: pickCount, _difficulty: pickDiff === "any" ? null : pickDiff,
    });
    if (error) return toast.error(error.message);
    toast.success(`Added ${data} questions from bank`);
    reload();
  };

  const generateWithAI = async () => {
    if (!id || !dpp) return;
    if (!aiTopic.trim() && !aiSource.trim()) {
      return toast.error("Enter a topic or paste source material");
    }
    setAiBusy(true);
    const { data, error } = await supabase.functions.invoke("dpp-generate-questions", {
      body: {
        topic: aiTopic.trim(),
        subject: dpp.subject,
        chapter: dpp.chapter ?? "",
        difficulty: dpp.difficulty ?? "medium",
        count: aiCount,
        source_text: aiSource.trim(),
      },
    });
    setAiBusy(false);
    if (error) return toast.error(error.message ?? "AI generation failed");
    const arr = (data?.questions ?? []) as Array<{
      question: string; options: string[]; correct_index: number; explanation?: string;
    }>;
    if (arr.length === 0) return toast.error("No questions returned");
    setQuestions(qs => {
      const start = qs.length;
      const added: Q[] = arr.map((a, k) => ({
        order_index: start + k,
        kind: "mcq",
        question: a.question,
        options: (a.options ?? []).slice(0, 4),
        correct: { indexes: [Math.max(0, Math.min(3, a.correct_index ?? 0))] },
        marks: 1,
        explanation: a.explanation ?? "",
      }));
      return [...qs, ...added];
    });
    toast.success(`Generated ${arr.length} questions — review & save`);
    setTab("questions");
  };

  if (!dpp) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/teacher/dpp"><ArrowLeft className="w-4 h-4" /> All DPPs</Link></Button>
      <PageHeader
        title={dpp.title || "Untitled DPP"}
        subtitle={`${dpp.subject} · ${dpp.question_count} questions · ${dpp.is_published ? "Published" : "Draft"}`}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="questions">Questions ({questions.length})</TabsTrigger>
          <TabsTrigger value="publish">Publish</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card className="p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Title</Label>
                <Input value={dpp.title} onChange={e => setDpp({ ...dpp, title: e.target.value })} />
              </div>
              <div>
                <Label>Class</Label>
                <Select value={dpp.class_id} onValueChange={v => setDpp({ ...dpp, class_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>Class {c.name}-{c.section}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Subject</Label>
                <Select value={dpp.subject} onValueChange={v => setDpp({ ...dpp, subject: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{subjects.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Chapter</Label>
                <Input value={dpp.chapter ?? ""} onChange={e => setDpp({ ...dpp, chapter: e.target.value })} placeholder="Optional" />
              </div>
              <div>
                <Label>Difficulty</Label>
                <Select value={dpp.difficulty} onValueChange={v => setDpp({ ...dpp, difficulty: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Duration (minutes)</Label>
                <Input type="number" value={Math.round(dpp.duration_sec / 60)}
                  onChange={e => setDpp({ ...dpp, duration_sec: Number(e.target.value) * 60 })} />
              </div>
              <div>
                <Label>Negative marking (per wrong)</Label>
                <Input type="number" step="0.25" value={dpp.negative_marking}
                  onChange={e => setDpp({ ...dpp, negative_marking: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Due date</Label>
                <Input type="datetime-local"
                  value={dpp.due_at ? new Date(dpp.due_at).toISOString().slice(0, 16) : ""}
                  onChange={e => setDpp({ ...dpp, due_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              </div>
            </div>
            <div>
              <Label>Instructions</Label>
              <Textarea value={dpp.instructions ?? ""} onChange={e => setDpp({ ...dpp, instructions: e.target.value })} rows={3} />
            </div>
            <Button onClick={saveDetails} disabled={saving}>{saving ? "Saving…" : "Save details"}</Button>
          </Card>
        </TabsContent>

        <TabsContent value="questions">
          <Card className="p-4 mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Pick from question bank</span>
              </div>
              <div>
                <Label className="text-xs">Count</Label>
                <Input type="number" value={pickCount} onChange={e => setPickCount(Number(e.target.value))} className="w-20 h-9" />
              </div>
              <div>
                <Label className="text-xs">Difficulty</Label>
                <Select value={pickDiff} onValueChange={setPickDiff}>
                  <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={pickFromBank}>Add</Button>
              <Button size="sm" variant="outline" onClick={addQuestion}><Plus className="w-4 h-4" /> Manual</Button>
            </div>
          </Card>

          <div className="space-y-4">
            {questions.map((q, i) => (
              <Card key={i} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">Q{i + 1}</Badge>
                  <div className="flex items-center gap-2">
                    <Select value={q.kind} onValueChange={(v) => {
                      const correct = v === "mcq" ? { indexes: [0] }
                        : v === "multi" ? { indexes: [] }
                        : v === "numerical" ? { value: 0, tolerance: 0 }
                        : { text: "" };
                      updateQ(i, { kind: v as any, correct });
                    }}>
                      <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mcq">MCQ</SelectItem>
                        <SelectItem value="multi">Multi-select</SelectItem>
                        <SelectItem value="numerical">Numerical</SelectItem>
                        <SelectItem value="short">Short answer</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input type="number" className="w-16 h-8 text-xs" value={q.marks}
                      onChange={e => updateQ(i, { marks: Number(e.target.value) })} />
                    <Button variant="ghost" size="sm" onClick={() => removeQ(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                </div>
                <Textarea placeholder="Question" value={q.question} onChange={e => updateQ(i, { question: e.target.value })} />

                {(q.kind === "mcq" || q.kind === "multi") && (
                  <div className="space-y-2">
                    {q.options.map((opt, oi) => {
                      const isRight = (q.correct?.indexes ?? []).includes(oi);
                      return (
                        <div key={oi} className="flex items-center gap-2">
                          <button type="button" onClick={() => {
                            if (q.kind === "mcq") updateQ(i, { correct: { indexes: [oi] } });
                            else {
                              const cur: number[] = q.correct?.indexes ?? [];
                              updateQ(i, { correct: { indexes: cur.includes(oi) ? cur.filter(x => x !== oi) : [...cur, oi] } });
                            }
                          }} className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs ${isRight ? "bg-accent text-accent-foreground border-accent" : ""}`}>
                            {String.fromCharCode(65 + oi)}
                          </button>
                          <Input value={opt} onChange={e => {
                            const next = [...q.options]; next[oi] = e.target.value;
                            updateQ(i, { options: next });
                          }} placeholder={`Option ${oi + 1}`} />
                        </div>
                      );
                    })}
                    <Button variant="ghost" size="sm" onClick={() => updateQ(i, { options: [...q.options, ""] })}>+ option</Button>
                  </div>
                )}

                {q.kind === "numerical" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Correct value</Label>
                      <Input type="number" value={q.correct?.value ?? 0}
                        onChange={e => updateQ(i, { correct: { ...q.correct, value: Number(e.target.value) } })} />
                    </div>
                    <div>
                      <Label className="text-xs">Tolerance ±</Label>
                      <Input type="number" value={q.correct?.tolerance ?? 0}
                        onChange={e => updateQ(i, { correct: { ...q.correct, tolerance: Number(e.target.value) } })} />
                    </div>
                  </div>
                )}

                {q.kind === "short" && (
                  <Input placeholder="Expected answer" value={q.correct?.text ?? ""}
                    onChange={e => updateQ(i, { correct: { text: e.target.value } })} />
                )}

                <Textarea placeholder="Explanation (optional)" value={q.explanation ?? ""}
                  onChange={e => updateQ(i, { explanation: e.target.value })} rows={2} />
              </Card>
            ))}
          </div>

          <div className="sticky bottom-4 mt-6 flex justify-end">
            <Button onClick={saveQuestions} disabled={saving || questions.length === 0}>
              {saving ? "Saving…" : "Save questions"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="publish">
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">Publish to class</div>
                <div className="text-sm text-muted-foreground">Once published, students can see and attempt this DPP.</div>
              </div>
              <Switch checked={!!dpp.is_published} onCheckedChange={v => setDpp({ ...dpp, is_published: v })} />
            </div>
            <div className="text-sm grid grid-cols-2 gap-2">
              <div>Questions: <b>{dpp.question_count}</b></div>
              <div>Total marks: <b>{dpp.total_marks}</b></div>
              <div>Duration: <b>{Math.round(dpp.duration_sec / 60)} min</b></div>
              <div>Negative: <b>{dpp.negative_marking}</b></div>
            </div>
            <Button onClick={saveDetails} disabled={saving || dpp.question_count === 0}>
              {dpp.is_published ? "Update" : "Publish"}
            </Button>
            {dpp.question_count === 0 && <p className="text-xs text-warning">Add and save questions before publishing.</p>}
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
