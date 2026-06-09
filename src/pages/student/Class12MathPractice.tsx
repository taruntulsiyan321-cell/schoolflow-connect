import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/ui-bits";
import { CLASS12_MATH_CHAPTERS } from "@/engines/class12Math/types";
import { CLASS12_PHYSICS_CHAPTERS } from "@/lib/class12Subjects";
import { Calculator, Play, Sparkles } from "lucide-react";

const QUESTION_COUNTS = [5, 10, 15, 20];

const SUBJECTS = [
  { value: "Mathematics", label: "Mathematics" },
  { value: "Physics", label: "Physics" },
] as const;

export default function Class12MathPractice() {
  const nav = useNavigate();
  const [subject, setSubject] = useState<"Mathematics" | "Physics">("Mathematics");
  const chapters = useMemo(
    () => (subject === "Mathematics" ? CLASS12_MATH_CHAPTERS : CLASS12_PHYSICS_CHAPTERS),
    [subject],
  );
  const [chapter, setChapter] = useState<string>(chapters[0]);
  const [count, setCount] = useState(10);

  // Keep chapter valid when subject changes
  if (!chapters.includes(chapter as any)) {
    setChapter(chapters[0]);
  }

  const start = () => {
    if (subject === "Mathematics") {
      nav(`/student/practice/math12/session?chapter=${encodeURIComponent(chapter)}&count=${count}`);
    } else {
      nav(`/student/practice/ai/session?subject=${encodeURIComponent(subject)}&chapter=${encodeURIComponent(chapter)}&count=${count}`);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="CBSE · NCERT · Class 12"
        title="Practice with AI-fresh questions"
        subtitle="Every session pulls new questions — Math uses parametric templates; Physics is AI-generated and cached so the bank keeps growing."
      />

      <Card className="p-6 max-w-lg shadow-card space-y-5">
        <div className="flex items-center gap-3">
          <div className="icon-tile">
            {subject === "Mathematics" ? <Calculator className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
          </div>
          <div>
            <div className="font-semibold">Question Generation Engine</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Subject → Chapter → Practice. No repeats within a session.
            </p>
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Subject</Label>
          <Select value={subject} onValueChange={(v) => setSubject(v as any)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUBJECTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label} (Class 12)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Chapter (NCERT)</Label>
          <Select value={chapter} onValueChange={setChapter}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {chapters.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Questions per session</Label>
          <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {QUESTION_COUNTS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n} questions</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button size="lg" className="w-full btn-cta" onClick={start}>
          <Play className="w-4 h-4 mr-2" /> Start practice
        </Button>

        <p className="text-[11px] text-muted-foreground text-center">
          {subject === "Mathematics"
            ? "13 NCERT chapters · 1300+ parametric templates · CBSE aligned"
            : "14 NCERT chapters · AI-generated MCQs cached and grown automatically"}
        </p>
      </Card>

      <div className="mt-4 text-sm">
        <Link to="/student/dpp" className="text-primary hover:underline">← Back to Daily Practice</Link>
      </div>
    </>
  );
}
