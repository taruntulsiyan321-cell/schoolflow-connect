import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { displayTopic } from "@/lib/academicPresentation";
import { formatSeconds } from "@/lib/studentAnalysisMetrics";
import type { BreakdownRow } from "@/academic/metrics/sessionAnalysis";
import { MIN_OBSERVATIONS_FOR_VERDICT } from "@/academic/metrics/thresholds";
import { FORM_LABELS, isQuestionForm } from "../../../../supabase/functions/_shared/questionForms.ts";
import type { SessionAnalysis } from "./analyseSession";

type Props = {
  analysis: SessionAnalysis;
  subjectRaw: string;
  chapterRaw: string;
  /** The concept report, which reads the session's concepts and asks the AI coach. */
  conceptReport: ReactNode;
};

const DIFFICULTY_LABELS: Record<string, string> = { easy: "Easy", medium: "Medium", hard: "Hard", unrated: "Unrated" };

type TableProps = {
  rows: BreakdownRow[];
  /** What the rows are: topic, difficulty, kind of question. */
  heading: string;
  label: (key: string) => string;
  practise?: (row: BreakdownRow) => string | null;
};

function BreakdownTable({ rows, heading, label, practise }: TableProps) {
  // A column of zeros says nothing, and on a phone it costs the room the topic needs.
  const anySkipped = rows.some((r) => r.skipped > 0);
  return (
    // relative: the scroll box is the containing block of what is placed inside
    // it absolutely (the sr-only header), so nothing escapes it and widens the page.
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="py-1.5 pr-2 font-medium">{heading}</th>
            <th scope="col" className="py-1.5 pr-2 font-medium">Right</th>
            <th scope="col" className="py-1.5 pr-2 font-medium">Wrong</th>
            {anySkipped && <th scope="col" className="py-1.5 pr-2 font-medium">Skipped</th>}
            <th scope="col" className="py-1.5 pr-2 font-medium" title={`Shown once ${MIN_OBSERVATIONS_FOR_VERDICT} questions are answered`}>Accuracy</th>
            <th scope="col" className="hidden py-1.5 pr-2 font-medium sm:table-cell">Per answer</th>
            {practise && <th scope="col" className="py-1.5 font-medium"><span className="sr-only">Practise</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = practise?.(r) ?? null;
            return (
              <tr key={r.key} className="border-t border-border/60" data-testid="breakdown-row">
                <td className="py-2 pr-2 font-medium">{label(r.key)}</td>
                <td className="py-2 pr-2 tabular-nums">{r.correct}/{r.answered}</td>
                <td className="py-2 pr-2 tabular-nums">{r.wrong}</td>
                {anySkipped && <td className="py-2 pr-2 tabular-nums">{r.skipped}</td>}
                <td className="py-2 pr-2 tabular-nums">{r.accuracy != null ? `${r.accuracy}%` : "—"}</td>
                <td className="hidden py-2 pr-2 tabular-nums sm:table-cell">{r.avgSec != null ? formatSeconds(r.avgSec) : "—"}</td>
                {practise && (
                  <td className="py-2 text-right">
                    {href && r.wrong > 0 && <Link to={href} className="text-xs font-semibold text-primary hover:underline">Practise</Link>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Where the marks went: by topic (weakest first), by difficulty, by kind of question — and the concept report. */
export function TopicsTab({ analysis, subjectRaw, chapterRaw, conceptReport }: Props) {
  const practise = (r: BreakdownRow) =>
    `/student/practice?${new URLSearchParams({
      ...(subjectRaw ? { subject: subjectRaw } : {}),
      ...(chapterRaw ? { chapter: chapterRaw } : {}),
      topic: r.key,
    })}`;
  return (
    <div className="space-y-5">
      <Card className="p-5" data-testid="topics-by-topic">
        <h3 className="mb-1 text-sm font-semibold">By topic</h3>
        <p className="mb-3 text-xs text-muted-foreground">The topic that cost you most comes first.</p>
        <BreakdownTable rows={analysis.topics} heading="Topic" label={(k) => displayTopic(k) || k} practise={practise} />
      </Card>

      {analysis.difficulty.length > 1 && (
        <Card className="p-5" data-testid="topics-by-difficulty">
          <h3 className="mb-3 text-sm font-semibold">By difficulty</h3>
          <BreakdownTable rows={analysis.difficulty} heading="Difficulty" label={(k) => DIFFICULTY_LABELS[k] ?? k} />
        </Card>
      )}

      {analysis.forms && (
        <Card className="p-5" data-testid="topics-by-form">
          <h3 className="mb-3 text-sm font-semibold">By kind of question</h3>
          <BreakdownTable rows={analysis.forms} heading="Kind" label={(k) => (isQuestionForm(k) ? FORM_LABELS[k] : k)} />
        </Card>
      )}

      {conceptReport}
    </div>
  );
}
