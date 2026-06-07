import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/ui-bits";
import { CLASS12_MATH_CHAPTERS } from "@/engines/class12Math/types";
import { Calculator, Play } from "lucide-react";

const QUESTION_COUNTS = [5, 10, 15, 20];

export default function Class12MathPractice() {
  const nav = useNavigate();
  const [chapter, setChapter] = useState(CLASS12_MATH_CHAPTERS[0]);
  const [count, setCount] = useState(10);

  const start = () => {
    nav(`/student/practice/math12/session?chapter=${encodeURIComponent(chapter)}&count=${count}`);
  };

  return (
    <>
      <PageHeader
        eyebrow="CBSE · NCERT"
        title="Class 12 Mathematics Practice"
        subtitle="Unlimited fresh MCQs — each session generates new values from 100+ templates per chapter"
      />

      <Card className="p-6 max-w-lg shadow-card space-y-5">
        <div className="flex items-center gap-3">
          <div className="icon-tile">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <div className="font-semibold">Question Generation Engine</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Subject → Chapter → Practice. Questions are never repeated verbatim.
            </p>
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Subject</Label>
          <Select value="Mathematics" disabled>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Mathematics">Mathematics (Class 12)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Chapter (NCERT)</Label>
          <Select value={chapter} onValueChange={setChapter}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CLASS12_MATH_CHAPTERS.map((c) => (
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
          Covers all 13 NCERT chapters · 100+ parametric templates each · CBSE aligned
        </p>
      </Card>

      <div className="mt-4 text-sm">
        <Link to="/student/dpp" className="text-primary hover:underline">← Back to Daily Practice</Link>
      </div>
    </>
  );
}
