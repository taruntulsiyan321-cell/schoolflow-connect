import { Link } from "react-router-dom";
import { BarChart2, HelpCircle, History, Lightbulb, Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/student/ScoreRing";
import { displayTopic } from "@/lib/academicPresentation";
import { UNFILED } from "@/academic/metrics/sessionAnalysis";
import { formatSeconds } from "@/lib/studentAnalysisMetrics";
import { pluralise } from "@/lib/plural";
import type { NoteKey, SessionAnalysis } from "./analyseSession";
import { ANSWER_NOTES, sideText } from "./analyseSession";

type Props = {
  analysis: SessionAnalysis;
  stats: {
    total: number;
    correct: number;
    wrong: number;
    skipped: number;
    accuracyLabel: string;
    durationLabel: string;
    /** Left out where nothing earns XP — a mock paper. */
    xpLabel?: string;
    avgSec: number | null;
  };
  subjectRaw: string;
  chapterRaw: string;
  /**
   * What the comparison with the last time is against, in the caller's words —
   * "your last session on Ratio Analysis", "your last Accountancy paper" — and
   * what to say when there is no last time. Null shows no comparison.
   */
  compare: { title: string; first: string } | null;
  recommendations: string[];
  insights: { headline?: string | null; bullets?: string[] | null } | null | undefined;
  onShowQuestions: (filter: NoteKey) => void;
};

/** "+4 marks", "−1 mark", "0 points" — signed, and singular for one. */
const signed = (n: number, one: string, many: string) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)} ${Math.abs(n) === 1 ? one : many}`;

/** The session at a glance, and what to do about it. Numbers and movement only — §10.8, no praise. */
export function SummaryTab({ analysis, stats, subjectRaw, chapterRaw, compare, recommendations, insights, onShowQuestions }: Props) {
  const { marks, comparison, metBefore, fix, paper, guesses } = analysis;
  const practiseHref = fix && fix.key !== UNFILED
    ? `/student/practice?${new URLSearchParams({
        ...(subjectRaw ? { subject: subjectRaw } : {}),
        ...(chapterRaw ? { chapter: chapterRaw } : {}),
        topic: fix.key,
      })}`
    : null;
  const metCounts = metBefore
    ? (["fixed", "stillWrong", "slipped"] as const).map((k) => ({ key: k, n: metBefore[k].length })).filter((x) => x.n > 0)
    : [];

  return (
    <div className="space-y-5">
      <Card className="flex flex-col items-center gap-6 p-6 sm:flex-row" data-testid="summary-score">
        <ScoreRing value={stats.correct} max={stats.total || 1} size={132} label="correct" />
        <dl className="grid w-full flex-1 grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ["Accuracy", stats.accuracyLabel],
            ["Right", `${stats.correct}/${stats.total}`],
            ["Wrong", String(stats.wrong)],
            ["Skipped", String(stats.skipped)],
            ["Time", stats.durationLabel],
            ["Per answer", stats.avgSec != null ? formatSeconds(stats.avgSec) : "—"],
            ...(stats.xpLabel != null ? [["XP earned", stats.xpLabel]] : []),
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {marks && paper && (
        <Card className="p-5" data-testid="summary-marks">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Target className="h-4 w-4" aria-hidden /> On the real paper</h3>
          <p className="text-2xl font-black tabular-nums">{marks.score} <span className="text-base font-semibold text-muted-foreground">/ {marks.max} marks</span></p>
          <p className="mt-1 text-sm text-muted-foreground">
            Marked as CUET marks it: +{paper.marks_correct} for each of {marks.correct} right, −{Math.abs(paper.marks_wrong)} for each of {marks.wrong} wrong, 0 for {pluralise(marks.left, "question")} left.
          </p>
        </Card>
      )}

      {/* The "I'm guessing" tap's reading — only for a session that offered it. */}
      {guesses && (
        <Card className="p-5" data-testid="summary-guesses">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><HelpCircle className="h-4 w-4" aria-hidden /> Your guesses</h3>
          {guesses.marked > 0 ? (
            <>
              <p className="text-sm">
                {pluralise(guesses.marked, "answer")} marked as a guess: {guesses.lucky.length} right, {guesses.missed.length} wrong
                {guesses.net != null ? `, which came to ${signed(guesses.net, "mark", "marks")} on the real paper` : ""}.
              </p>
              {/* C2 (20261152000000): a right answer marked as a guess goes to the Mistake Book. */}
              {guesses.lucky.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground" data-testid="summary-lucky-to-book">
                  {guesses.lucky.length === 1
                    ? "The one right by a guess is in your Mistake Book, so recovery and revision will ask it again."
                    : `The ${guesses.lucky.length} right by a guess are in your Mistake Book, so recovery and revision will ask them again.`}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {(["lucky", "unmarkedWrong", "missed"] as const).filter((k) => guesses[k].length > 0).map((k) => (
                  <Button key={k} variant="outline" size="sm" onClick={() => onShowQuestions(k)} title={ANSWER_NOTES[k].help}>
                    {ANSWER_NOTES[k].label}: {guesses[k].length}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              You marked no answer as a guess. Tap “I'm guessing” before you answer, and this shows which right answers were luck.
            </p>
          )}
        </Card>
      )}

      {/* Only once the server's context is in: without it nothing is known
          about earlier sessions, and "your first session" would be a guess. */}
      {compare && paper && (
        <Card className="p-5" data-testid="summary-comparison">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" aria-hidden /> Since {compare.title}</h3>
          {comparison ? (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Last time: {new Date(comparison.finishedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Right</div>
                  <div className="font-bold tabular-nums">{sideText(comparison.then)} → {sideText(comparison.now)}</div>
                  {comparison.accuracyChange != null && (
                    <div className="text-xs text-muted-foreground">{signed(comparison.accuracyChange, "point", "points")}</div>
                  )}
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Per answer</div>
                  <div className="font-bold tabular-nums">
                    {comparison.then.avgSec != null ? formatSeconds(comparison.then.avgSec) : "—"} → {comparison.now.avgSec != null ? formatSeconds(comparison.now.avgSec) : "—"}
                  </div>
                  {comparison.paceChange != null && comparison.paceChange !== 0 && (
                    <div className="text-xs text-muted-foreground">{Math.abs(comparison.paceChange)} s {comparison.paceChange > 0 ? "slower" : "quicker"}</div>
                  )}
                </div>
              </div>
              {comparison.topics.length > 0 && (
                <table className="w-full text-left text-sm" data-testid="comparison-topics">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="py-1 font-medium">Topic</th>
                      <th className="py-1 font-medium">Last time</th>
                      <th className="py-1 font-medium">This time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.topics.map((t) => (
                      <tr key={t.topic} className="border-t border-border/60">
                        <td className="py-1.5 pr-2">{displayTopic(t.topic) || t.topic}</td>
                        <td className="py-1.5 tabular-nums">{sideText(t.then)}</td>
                        <td className="py-1.5 tabular-nums">{sideText(t.now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{compare.first}</p>
          )}
        </Card>
      )}

      {metCounts.length > 0 && (
        <Card className="p-5" data-testid="summary-met-before">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><BarChart2 className="h-4 w-4" aria-hidden /> Questions you had met before</h3>
          <div className="flex flex-wrap gap-2">
            {metCounts.map(({ key, n }) => (
              <Button key={key} variant="outline" size="sm" onClick={() => onShowQuestions(key)} title={ANSWER_NOTES[key].help}>
                {ANSWER_NOTES[key].label}: {n}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {(fix || recommendations.length > 0 || insights?.headline || insights?.bullets?.length) && (
        <Card className="border-primary/20 bg-primary/5 p-5" data-testid="summary-next">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4" aria-hidden /> What to do next</h3>
          {fix && practiseHref && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/60 p-3">
              <p className="text-sm">
                <span className="font-semibold">{displayTopic(fix.key) || fix.key}</span> cost you {fix.wrong} of {pluralise(fix.answered, "answer")}.
              </p>
              <Button asChild size="sm">
                <Link to={practiseHref}>Practise {displayTopic(fix.key) || fix.key}</Link>
              </Button>
            </div>
          )}
          {insights?.headline && <p className="mb-2 text-sm font-medium">{insights.headline}</p>}
          {(insights?.bullets?.length || recommendations.length > 0) && (
            <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              {[...(insights?.bullets ?? []), ...recommendations].map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
