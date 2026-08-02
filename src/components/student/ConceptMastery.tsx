import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { Brain } from "lucide-react";
import { displayChapter, displayConcept, displaySubject } from "@/lib/academicDisplay";

function masteryTone(score: number) {
  if (score >= 75) return "text-accent";
  if (score >= 50) return "text-warning";
  return "text-destructive";
}

type Props = { compact?: boolean; limit?: number };

export function ConceptMastery({ compact = false, limit = 8 }: Props) {
  const { items, loading, error } = useConceptMastery();

  if (loading) return <p className="text-sm text-muted-foreground">Loading concept mastery…</p>;
  if (error) return <p className="text-xs text-muted-foreground">Concept mastery unavailable — apply latest migration.</p>;
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Complete DPPs, battles, or practice to build concept mastery scores.
      </p>
    );
  }

  const shown = items.slice(0, limit);

  if (compact) {
    return (
      <div className="space-y-2">
        {shown.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{displayConcept(m.concept)}</div>
              <div className="text-[11px] text-muted-foreground truncate">{displaySubject(m.subject)}{m.chapter ? ` · ${displayChapter(m.chapter)}` : ""}</div>
            </div>
            <span className={`text-sm font-bold tabular-nums ${masteryTone(m.mastery_score)}`}>{Math.round(m.mastery_score)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Card className="p-4 shadow-card">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">Concept mastery</h3>
      </div>
      <div className="space-y-3">
        {shown.map((m, i) => (
          <div key={i}>
            <div className="flex justify-between items-center mb-1">
              <div>
                <span className="font-medium text-sm">{displayConcept(m.concept)}</span>
                <span className="text-xs text-muted-foreground ml-2">{m.subject}</span>
              </div>
              <Badge variant="outline" className={masteryTone(m.mastery_score)}>{Math.round(m.mastery_score)}%</Badge>
            </div>
            <Progress value={m.mastery_score} className="h-1.5" />
            {m.mistake_count > 0 && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{m.mistake_count} mistake(s) logged</p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
