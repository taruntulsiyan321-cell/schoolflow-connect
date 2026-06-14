import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlowPage, FlowSectionTitle, FlowTopBar } from "@/components/student/flow/FlowDesign";
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

  if (!(chapters as readonly string[]).includes(chapter)) {
    setChapter(chapters[0]);
  }

  const start = () => {
    nav(
      `/student/practice/ai/session?subject=${encodeURIComponent(subject)}&chapter=${encodeURIComponent(chapter)}&count=${count}`,
    );
  };

  return (
    <FlowPage>
      <FlowTopBar backTo="/student" />

      <section className="sp-hero rounded-3xl overflow-hidden shadow-elevated bg-gradient-to-br from-[#074b37] via-[#003324] to-[#003324]/95 text-primary-foreground p-6 sm:p-8 relative">
        <div className="absolute top-0 right-0 w-40 h-40 bg-[#b2f0d4]/15 rounded-full blur-2xl pointer-events-none" />
        <div className="relative z-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
          CBSE · NCERT · Class 12
        </p>
        <h1 className="font-['Sora'] text-2xl sm:text-3xl font-semibold mt-2 tracking-tight">Practice session</h1>
        <p className="text-sm text-primary-foreground/80 mt-2 max-w-md">
          Fresh questions every time — same quality as recovery practice.
        </p>
        </div>
      </section>

      <section className="sp-stat-card rounded-2xl border border-border/60 bg-card p-6 shadow-sm space-y-5 max-w-lg">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            {subject === "Mathematics" ? <Calculator className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
          </div>
          <div>
            <div className="font-semibold">Pick your focus</div>
            <p className="text-xs text-muted-foreground mt-0.5">Subject → Chapter → Go</p>
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Subject</Label>
          <Select value={subject} onValueChange={(v) => setSubject(v as "Mathematics" | "Physics")}>
            <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUBJECTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Chapter</Label>
          <Select value={chapter} onValueChange={setChapter}>
            <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              {chapters.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <FlowSectionTitle>Questions</FlowSectionTitle>
          <div className="flex flex-wrap gap-2">
            {QUESTION_COUNTS.map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                variant={count === n ? "default" : "outline"}
                className="rounded-full"
                onClick={() => setCount(n)}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>

        <Button className="w-full rounded-2xl h-12 text-base font-semibold" onClick={start}>
          <Play className="w-4 h-4 mr-2" /> Start practice
        </Button>
      </section>
    </FlowPage>
  );
}
