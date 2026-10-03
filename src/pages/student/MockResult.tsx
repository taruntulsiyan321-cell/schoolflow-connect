import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Timer, XCircle, MinusCircle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QuestionRenderer, type TestQuestionShape } from "@/components/student/QuestionRenderer";
import { StudentErrorState, StudentSessionSkeleton } from "@/components/student/StudentPanelStates";
import { ExplanationText } from "@/components/ExplanationText";
import { displaySubject } from "@/lib/academicDisplay";
import { formatSessionDuration } from "@/lib/practiceSessionStats";
import { toErrorMessage } from "@/lib/presentation";
import { MockError, fetchMockResult, type MockResult as MockResultShape } from "@/lib/mockTest";

/**
 * A marked mock paper: the score, and every question with the right answer.
 *
 * The right answers arrive here and nowhere earlier — rpc_mock_result refuses
 * until the paper is submitted, and the paper the student sits carries no
 * answer at all. Marks per question come from the server too, so this screen
 * cannot disagree with the total it is showing.
 */
const FILTERS = ["all", "wrong", "unanswered", "right"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  wrong: "Wrong",
  unanswered: "Left blank",
  right: "Right",
};

export default function MockResult() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [result, setResult] = useState<MockResultShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void (async () => {
      try {
        const r = await fetchMockResult(id);
        if (alive) setResult(r);
      } catch (e) {
        if (!alive) return;
        if (e instanceof MockError && e.refusal === "mock_not_submitted") {
          // Still open: the paper is where they should be, not here.
          nav(`/student/mock/${id}`, { replace: true });
          return;
        }
        setError(e instanceof MockError ? e.message : toErrorMessage(e, "Could not load the result"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, nav]);

  const shown = useMemo(() => {
    if (!result) return [];
    return result.questions.filter((q) => {
      if (filter === "all") return true;
      if (filter === "wrong") return q.is_correct === false;
      if (filter === "right") return q.is_correct === true;
      return q.choice == null;   // left blank
    });
  }, [result, filter]);

  if (error) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <StudentErrorState title="Could not load the result" message={error} />
        <div className="text-center">
          <Button variant="outline" size="sm" asChild>
            <Link to="/student/mocks">Back to Mock Tests</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!result) return <StudentSessionSkeleton label="Loading your result…" />;

  const accuracy = result.correct + result.wrong > 0
    ? Math.round((result.correct / (result.correct + result.wrong)) * 100)
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {displaySubject(result.subject) || result.subject} mock test
        </div>
        <h1 className="text-3xl font-black leading-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
          {result.score} <span className="text-lg font-bold text-muted-foreground">of {result.max_score}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {result.auto_submitted ? "Submitted when the hour ran out." : "Submitted by you."}{" "}
          {formatSessionDuration(result.seconds_taken * 1000)} on the paper.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="mock-result-counts">
        <Card className="p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-accent" /> Right
          </div>
          <div className="text-xl font-black text-foreground">{result.correct}</div>
          <div className="text-[10px] text-muted-foreground">+{result.marks_correct} each</div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <XCircle className="h-3.5 w-3.5 text-destructive" /> Wrong
          </div>
          <div className="text-xl font-black text-foreground">{result.wrong}</div>
          <div className="text-[10px] text-muted-foreground">{result.marks_wrong} each</div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MinusCircle className="h-3.5 w-3.5" /> Left blank
          </div>
          <div className="text-xl font-black text-foreground">{result.unanswered}</div>
          <div className="text-[10px] text-muted-foreground">0 each</div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Timer className="h-3.5 w-3.5" /> Accuracy
          </div>
          <div className="text-xl font-black text-foreground">{accuracy == null ? "—" : `${accuracy}%`}</div>
          <div className="text-[10px] text-muted-foreground">of what you answered</div>
        </Card>
      </div>

      {result.voided > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground" data-testid="mock-voided-note">
          <Ban className="h-4 w-4 shrink-0" />
          {result.voided === 1
            ? "One question was withdrawn from the bank after your paper was made. It carried no marks either way."
            : `${result.voided} questions were withdrawn from the bank after your paper was made. They carried no marks either way.`}
        </p>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg border px-3 py-1 text-xs font-semibold ${
              filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="space-y-3" data-testid="mock-review">
        {shown.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing in this group.</p>
        )}
        {shown.map((q) => {
          const renderer: TestQuestionShape = {
            id: q.id,
            order_index: q.order,
            question_format: "mcq",
            question: q.question ?? "",
            options: q.options,
            correct: q.correct ? { indexes: [q.correct.index] } : null,
            marks: result.marks_correct,
          };
          return (
            <Card key={q.id} className="p-4">
              <div className="mb-2 flex items-start justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  Question {q.order}
                  {q.chapter ? ` · ${q.chapter}` : ""}
                  {/* A topic named as its chapter is said once, not twice. */}
                  {q.topic && q.topic.trim().toLowerCase() !== (q.chapter ?? "").trim().toLowerCase() ? ` · ${q.topic}` : ""}
                </span>
                <span
                  className={
                    q.is_correct === true
                      ? "font-semibold text-accent"
                      : q.is_correct === false
                        ? "font-semibold text-destructive"
                        : ""
                  }
                >
                  {q.marks > 0 ? `+${q.marks}` : q.marks} {q.marks === 1 || q.marks === -1 ? "mark" : "marks"}
                </span>
              </div>

              {q.available ? (
                <>
                  <QuestionRenderer
                    question={renderer}
                    mode="review"
                    value={q.choice == null ? {} : { indexes: [q.choice] }}
                    isCorrect={q.is_correct}
                  />
                  {q.choice == null && (
                    <p className="mt-2 text-xs text-muted-foreground">You left this one blank.</p>
                  )}
                  {q.explanation && (
                    <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm text-foreground">
                      <ExplanationText text={q.explanation} />
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This question was withdrawn from the bank, so it cannot be reviewed.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <div className="mt-6 text-center">
        <Button variant="outline" asChild>
          <Link to="/student/mocks">Back to Mock Tests</Link>
        </Button>
      </div>
    </div>
  );
}
