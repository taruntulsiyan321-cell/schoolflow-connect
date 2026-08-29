import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, QuestionBankService } from "@/academic";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Database, Upload, Check, Trash2, Library, Target, Brain, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { normalizeIncomingAcademicTerm, presentAcademicLabel } from "@/lib/academicPresentation";
import { fixUtf8Content } from "@/lib/utf8Text";
import { supabase } from "@/integrations/supabase/client";
import "@/pages/teacher/teacher-premium.css";
import { toErrorMessage } from "@/lib/presentation";

/** Radix forbids an empty SelectItem value; this stands in for "no class filter". */
const ANY_CLASS = "any";

const SUBJECTS = [
  "Mathematics",
  "Science",
  "Physics",
  "Chemistry",
  "Biology",
  "English",
  "Hindi",
  "Social Studies",
  "General Knowledge",
  "Computer Science",
  "Economics",
  "Accountancy",
  "Business Studies",
];
const DIFFS = ["easy", "medium", "hard"];

type DraftQ = {
  question: string;
  options: string[];
  correct_index: number;
  explanation?: string;
  include: boolean;
};

export default function QuestionBankPage() {
  const { user } = useAuth();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [tab, setTab] = useState("generate");

  // shared meta
  const [subject, setSubject] = useState("Mathematics");
  /**
   * "" means "any class". Radix reserves the empty string for "clear the
   * selection", and rendering `<SelectItem value="">` throws — which used to
   * white-screen this whole page. The sentinel below keeps "any" expressible
   * in the dropdown while the state stays "" for every downstream consumer
   * (`classLevel ? Number(classLevel) : null`).
   */
  const [classLevel, setClassLevel] = useState<string>("10");
  const [chapter, setChapter] = useState("");
  const [difficulty, setDifficulty] = useState("medium");

  // AI generation
  const [topic, setTopic] = useState("");
  const [url, setUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [count, setCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftQ[]>([]);
  const [saving, setSaving] = useState(false);

  // CSV
  const [csv, setCsv] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);

  // Bank summary
  const [summary, setSummary] = useState<{ subject: string; count: number }[]>([]);
  const [total, setTotal] = useState(0);

  const loadSummary = async () => {
    if (!academicReady || !ctx) {
      setSummary([]);
      setTotal(0);
      return;
    }
    try {
      const rows = await QuestionBankService.listSummary(ctx);
      setSummary(rows);
      setTotal(rows.reduce((n, r) => n + r.count, 0));
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not load question bank"));
      setSummary([]);
      setTotal(0);
    }
  };
  useEffect(() => { void loadSummary(); }, [academicReady, ctx?.schoolId]);

  const generate = async () => {
    if (!topic.trim() && !url.trim() && !sourceText.trim()) {
      return toast.error("Enter a topic, paste a URL, or add source text");
    }
    if (url.trim() && !/^https?:\/\//i.test(url.trim())) {
      return toast.error("URL must start with http:// or https://");
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("test-generate-questions", {
        body: {
          topic: topic.trim(), subject, chapter: chapter.trim(),
          difficulty, count, source_text: sourceText.trim(), source_url: url.trim(),
        },
      });
      if (error) return toast.error(toErrorMessage(error, "Question generation failed"));
      const arr = (data?.questions ?? []) as Array<{ question: string; options: string[]; correct_index: number; explanation?: string }>;
      if (arr.length === 0) return toast.error(data?.error ?? "No questions returned");
      setDrafts(arr.map((a) => ({
        question: a.question,
        options: (a.options ?? []).slice(0, 4),
        correct_index: Math.max(0, Math.min(3, a.correct_index ?? 0)),
        explanation: a.explanation ?? "",
        include: true,
      })));
      toast.success(`Generated ${arr.length} questions — review & save`);
    } catch (e) {
      toast.error(toErrorMessage(e, "Question generation failed"));
    } finally {
      setBusy(false);
    }
  };

  const saveDrafts = async () => {
    const chosen = drafts.filter((d) => d.include && d.question.trim() && d.options.filter(Boolean).length >= 2);
    if (chosen.length === 0) return toast.error("Nothing selected to save");
    if (!academicReady || !ctx) return toast.error("Academic context not ready");
    setSaving(true);
    const rows = chosen.map((d) => ({
      class_level: classLevel ? Number(classLevel) : null,
      subject: presentAcademicLabel(subject, "subject") || subject,
      chapter: chapter.trim() ? normalizeIncomingAcademicTerm(chapter, "chapter") : null,
      topic: topic.trim() ? normalizeIncomingAcademicTerm(topic, "topic") : null,
      concept: topic.trim() ? normalizeIncomingAcademicTerm(topic, "concept") : null,
      difficulty,
      question: fixUtf8Content(d.question),
      options: d.options.map((o) => fixUtf8Content(o)),
      correct_index: d.correct_index,
      explanation: d.explanation?.trim() ? fixUtf8Content(d.explanation) : null,
      source: "ai", created_by: user?.id ?? null,
    }));
    try {
      const { count } = await QuestionBankService.insert(ctx, rows);
      toast.success(`Saved ${count} questions to the bank`);
      setDrafts([]);
      void loadSummary();
    } catch (e) {
      toast.error(toErrorMessage(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const importCsv = async () => {
    const { rows, skipped } = parseCsv(csv, { subject, classLevel, chapter, difficulty, userId: user?.id ?? null });
    const skipSummary = summarizeSkippedRows(skipped);
    if (rows.length === 0) {
      return toast.error(
        skipped.length > 0
          ? `No valid rows found — ${skipSummary}`
          : "No valid rows found. Check the format below.",
      );
    }
    if (!academicReady || !ctx) return toast.error("Academic context not ready");
    setCsvBusy(true);
    try {
      const { count } = await QuestionBankService.insert(ctx, rows);
      if (skipped.length > 0) {
        toast.warning(`Imported ${count} questions, but skipped ${skipped.length} row(s) — ${skipSummary}`);
      } else {
        toast.success(`Imported ${count} questions`);
      }
      setCsv("");
      void loadSummary();
    } catch (e) {
      toast.error(toErrorMessage(e, "Import failed"));
    } finally {
      setCsvBusy(false);
    }
  };

  const metaBar = (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div>
        <Label className="text-xs">Subject</Label>
        <Select value={subject} onValueChange={setSubject}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>{SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Class</Label>
        <Select
          value={classLevel || ANY_CLASS}
          onValueChange={(v) => setClassLevel(v === ANY_CLASS ? "" : v)}
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_CLASS}>Any</SelectItem>
            {[6, 7, 8, 9, 10, 11, 12].map((c) => <SelectItem key={c} value={String(c)}>Class {c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Chapter</Label>
        <Input className="h-9" value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="Optional" />
      </div>
      <div>
        <Label className="text-xs">Difficulty</Label>
        <Select value={difficulty} onValueChange={setDifficulty}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>{DIFFS.map((d) => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
  const topSubject = summary[0]?.subject ?? subject;

  return (
    <div className="teacher-premium tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10 grid lg:grid-cols-[1fr_0.9fr] gap-5">
          <div>
            <div className="tp-kicker mb-4">Question Bank</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Build questions around concepts.</h1>
            <p className="text-sm text-foreground/75 mt-2 max-w-2xl">Generate, import, preview, and organize questions for practice, recovery assignments, and live battles.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold">{total}</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">Questions</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold">{summary.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">Subjects</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold capitalize">{difficulty}</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">Level</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <BankMetric icon={<Database className="w-5 h-5" />} label="Question Pool" value={total} sub="ready to assign" />
        <BankMetric icon={<Brain className="w-5 h-5" />} label="Top Subject" value={topSubject} sub="largest pool" />
        <BankMetric icon={<Target className="w-5 h-5" />} label="Class" value={classLevel ? `Class ${classLevel}` : "Any"} sub="current filter" />
        <BankMetric icon={<SlidersHorizontal className="w-5 h-5" />} label="Mode" value={tab === "generate" ? "Generate" : "Import"} sub="creation workflow" />
      </div>

      {/* Bank summary */}
      <Card className="tp-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">Bank contains</span>
          <Badge variant="secondary">{total} questions</Badge>
        </div>
        {summary.length === 0 ? (
          <p className="text-sm text-muted-foreground">Empty — generate or import to get started.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {summary.map((s) => (
              <span key={s.subject} className="text-xs px-2.5 py-1 rounded-full bg-muted font-medium">
                {s.subject}: <b>{s.count}</b>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card className="tp-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <p className="tp-label">Question filters</p>
            <h3 className="tp-display text-xl mt-1">Choose subject, chapter, concept level</h3>
          </div>
          <Badge variant="outline" className="rounded-full">Assignment ready</Badge>
        </div>
        {metaBar}
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="generate"><Sparkles className="w-4 h-4 mr-1.5" /> Generate</TabsTrigger>
          <TabsTrigger value="csv"><Upload className="w-4 h-4 mr-1.5" /> CSV Import</TabsTrigger>
        </TabsList>

        {/* AI GENERATE */}
        <TabsContent value="generate" className="space-y-4">
          <Card className="tp-card p-5 border-primary/30 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Generate from a topic, URL, or notes</span>
            </div>
            <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
              <div>
                <Label className="text-xs">Topic</Label>
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={`e.g. ${subject} — ${chapter || "chapter"}`} />
              </div>
              <div>
                <Label className="text-xs">Count</Label>
                <Input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-20 h-9" />
              </div>
              <Button size="sm" onClick={generate} disabled={busy}>{busy ? "Generating…" : "Generate"}</Button>
            </div>
            <div>
              <Label className="text-xs">Source URL (Wikipedia, NCERT page, article…)</Label>
              <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://en.wikipedia.org/wiki/..." />
            </div>
            <div>
              <Label className="text-xs">Or paste reference text / notes</Label>
              <Textarea value={sourceText} onChange={(e) => setSourceText(e.target.value)} rows={3} placeholder="Paste a chapter excerpt or existing MCQs to extract." />
            </div>
          </Card>

          {drafts.length > 0 && (
            <Card className="tp-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{drafts.filter((d) => d.include).length} of {drafts.length} selected</span>
                <Button size="sm" onClick={saveDrafts} disabled={saving}>
                  <Check className="w-4 h-4 mr-1.5" /> {saving ? "Saving…" : "Save to bank"}
                </Button>
              </div>
              <div className="space-y-3">
                {drafts.map((d, i) => (
                  <div key={i} className={`tp-row ${d.include ? "border-primary/30 bg-primary/5" : "border-border opacity-60"}`}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={d.include} onChange={(e) => setDrafts((p) => p.map((q, k) => k === i ? { ...q, include: e.target.checked } : q))} className="mt-1.5" />
                      <div className="flex-1 min-w-0 space-y-2">
                        <Textarea value={d.question} onChange={(e) => setDrafts((p) => p.map((q, k) => k === i ? { ...q, question: e.target.value } : q))} rows={2} className="text-sm" />
                        <div className="grid sm:grid-cols-2 gap-2">
                          {d.options.map((opt, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setDrafts((p) => p.map((q, k) => k === i ? { ...q, correct_index: oi } : q))}
                                className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs shrink-0 ${d.correct_index === oi ? "bg-accent text-accent-foreground border-accent" : ""}`}
                              >
                                {String.fromCharCode(65 + oi)}
                              </button>
                              <Input value={opt} onChange={(e) => setDrafts((p) => p.map((q, k) => {
                                if (k !== i) return q;
                                const next = [...q.options]; next[oi] = e.target.value; return { ...q, options: next };
                              }))} className="h-8 text-sm" />
                            </div>
                          ))}
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => setDrafts((p) => p.filter((_, k) => k !== i))}>
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Discard
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        {/* CSV IMPORT */}
        <TabsContent value="csv" className="space-y-4">
          <Card className="tp-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Library className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Paste CSV rows</span>
            </div>
            <p className="text-xs text-muted-foreground">
              One question per line. Columns: <code className="bg-muted px-1 rounded">question, optionA, optionB, optionC, optionD, correctIndex(0-3), explanation</code>.
              Subject / class / chapter / difficulty above are applied to all rows. A header row is auto-skipped.
            </p>
            <Textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              placeholder={`What is 2+2?,2,3,4,5,2,Basic addition\nCapital of India?,Mumbai,New Delhi,Chennai,Kolkata,1,New Delhi is the capital`}
            />
            <Button size="sm" onClick={importCsv} disabled={csvBusy || !csv.trim()}>
              <Upload className="w-4 h-4 mr-1.5" /> {csvBusy ? "Importing…" : "Import to bank"}
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BankMetric({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub: string }) {
  return (
    <Card className="tp-metric">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tp-label">{label}</p>
          <p className="text-2xl font-bold mt-2 truncate">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        </div>
        <div className="tp-icon">{icon}</div>
      </div>
    </Card>
  );
}

type SkippedRow = { line: number; reason: string };

type CsvQuestionRow = {
  class_level: number | null;
  subject: string;
  chapter: string | null;
  difficulty: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  source: string;
  created_by: string | null;
};

// Minimal CSV parser supporting quoted fields.
function parseCsv(
  text: string,
  meta: { subject: string; classLevel: string; chapter: string; difficulty: string; userId: string | null },
): { rows: CsvQuestionRow[]; skipped: SkippedRow[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: CsvQuestionRow[] = [];
  const skipped: SkippedRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    // skip header
    if (i === 0 && /question/i.test(cells[0]) && /option/i.test(cells[1])) continue;
    if (cells.length < 6) {
      skipped.push({ line: i + 1, reason: `expected 6+ columns, found ${cells.length}` });
      continue;
    }
    const [q, a, b, c, d, idxRaw, explanation] = cells;
    // Repair UTF-8-as-CP1252 paste corruption at ingest (never store à¤… for Hindi).
    const options = [a, b, c, d].map((x) => fixUtf8Content(x ?? ""));
    const correct_index = Math.max(0, Math.min(3, parseInt(idxRaw, 10) || 0));
    if (!q?.trim()) {
      skipped.push({ line: i + 1, reason: "missing question text" });
      continue;
    }
    if (options.filter(Boolean).length < 2) {
      skipped.push({ line: i + 1, reason: "fewer than 2 non-empty options" });
      continue;
    }
    rows.push({
      class_level: meta.classLevel ? Number(meta.classLevel) : null,
      subject: presentAcademicLabel(meta.subject, "subject") || meta.subject,
      chapter: meta.chapter.trim()
        ? normalizeIncomingAcademicTerm(meta.chapter, "chapter")
        : null,
      difficulty: meta.difficulty,
      question: fixUtf8Content(q),
      options,
      correct_index,
      explanation: explanation?.trim() ? fixUtf8Content(explanation) : null,
      source: "csv",
      created_by: meta.userId,
    });
  }
  return { rows, skipped };
}

// Builds a short, human-readable summary of skipped rows for toast messages.
function summarizeSkippedRows(skipped: SkippedRow[], maxShown = 3): string {
  const shown = skipped
    .slice(0, maxShown)
    .map((s) => `line ${s.line} (${s.reason})`)
    .join(", ");
  const extra = skipped.length > maxShown ? `, +${skipped.length - maxShown} more` : "";
  return `${shown}${extra}`;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
