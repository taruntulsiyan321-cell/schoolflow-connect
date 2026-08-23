import { useCallback, useEffect, useState } from "react";
import { PracticeService } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-bits";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { Link } from "react-router-dom";
import { BookMarked, RotateCcw, Wrench } from "lucide-react";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { displayChapter } from "@/lib/academicDisplay";
import { toErrorMessage } from "@/lib/presentation";

type MistakeRow = Awaited<ReturnType<typeof PracticeService.listMistakeBook>>[number];

/**
 * Mistake Book — derived, never manually maintained.
 *
 * A question appears here while its current status is "wrong" and leaves
 * automatically once the student answers it correctly. There is deliberately
 * no "mark as mastered" action: mastery is demonstrated by answering, not
 * asserted by clicking.
 */
export default function MistakeBank() {
  const { ctx, ready } = useAcademicContext();
  const [rows, setRows] = useState<MistakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ready || !ctx) return;
    setLoading(true);
    setLoadError(null);
    try {
      setRows(await PracticeService.listMistakeBook(ctx, { limit: 50 }));
    } catch (e) {
      setLoadError(toErrorMessage(e, "Could not load your mistakes."));
    } finally {
      setLoading(false);
    }
  }, [ctx, ready]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageHeader
        title="My Mistake Book"
        subtitle="Questions you got wrong. Answer one correctly and it clears itself from here."
        action={
          <Button size="sm" asChild>
            <Link to="/student/recovery"><Wrench className="w-4 h-4 mr-1" /> Recovery zone</Link>
          </Button>
        }
      />
      {loading && <StudentListSkeleton rows={4} />}
      {!loading && loadError && (
        <StudentErrorState title="Could not load mistakes" message={loadError} onRetry={load} />
      )}
      {!loading && !loadError && rows.length === 0 && (
        <Card className="p-8 text-center">
          <BookMarked className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">
            Nothing to review. Wrong answers from practice, DPPs and battles appear here
            automatically, and disappear once you get them right.
          </p>
        </Card>
      )}
      {!loading && !loadError && rows.length > 0 && (
        <>
          <div className="flex justify-end mb-3">
            <Button size="sm" variant="outline" asChild>
              <Link to="/student/practice?mode=incorrect">
                <RotateCcw className="w-4 h-4 mr-1" /> Practice all ({rows.length})
              </Link>
            </Button>
          </div>
          <div className="space-y-4">
            {rows.map((m) => (
              <Card key={m.id} className="p-4 shadow-card">
                <div className="flex flex-wrap gap-2 mb-2">
                  <Badge>{m.subject}</Badge>
                  {m.chapter && <Badge variant="outline">{displayChapter(m.chapter)}</Badge>}
                  {m.difficulty && <Badge variant="outline">{m.difficulty}</Badge>}
                  <Badge variant="outline" className="text-warning">
                    wrong ×{m.wrong_count}
                  </Badge>
                </div>
                <p className="font-medium">{m.question}</p>
                {m.explanation && (
                  <p className="text-sm text-muted-foreground mt-2">{m.explanation}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  <ExplainPanel
                    question={m.question}
                    options={Array.isArray(m.options) ? (m.options as string[]) : []}
                    correctIndex={m.correct_index}
                    selectedIndex={m.selected_index}
                    wasCorrect={false}
                    subject={m.subject}
                    chapter={m.chapter ?? undefined}
                  />
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/student/practice?mode=incorrect">
                      <RotateCcw className="w-4 h-4 mr-1" /> Practice again
                    </Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
