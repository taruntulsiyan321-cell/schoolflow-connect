import { REPEATED_MISTAKE_PIN, type TrendState } from "@/academic/recovery/constants";
import { trendState } from "@/lib/studentAnalysisMetrics";

/**
 * §6.3, the chapter list — "the main screen" of Analysis, and it did not
 * exist. The page had subject grids, topic groups, speed charts and
 * milestones; what it never had was the one list the section calls for: a row
 * per chapter with anything open, showing the signals side by side and
 * ranking on the clearest one.
 *
 * §6.2 governs the shape: "Do NOT compute a single weakness score per
 * chapter… Show the signals. Rank on the clearest one." So every signal below
 * is carried separately and nothing is blended; the ORDER is open mistakes,
 * with the two pins §6.3 names.
 *
 * §6.1 governs what is absent: weaknesses only. A chapter with nothing open
 * is not in this list at all — not as a green row, not as a "doing well"
 * section.
 */

export type ChapterTally = {
  chapter_id: string | null;
  attempted: number | null;
  correct: number | null;
  created_at: string | null;
};

export type ChapterMistake = {
  chapter_id: string | null;
  status: string | null;
  times_wrong: number | null;
  created_at: string | null;
  topic: string | null;
};

/** One answered or skipped question, already resolved to its chapter. */
export type ChapterAttempt = {
  chapter_id: string | null;
  topic: string | null;
  skipped: boolean | null;
  time_taken_ms: number | null;
};

export type ChapterStateRow = {
  chapter_id: string | null;
  chapter: string | null;
  subject: string | null;
  state: string | null;
  open_mistakes?: number | null;
  next_revision_at?: string | null;
  revision_stage?: number | null;
  revision_due?: boolean | null;
};

export type TopicCount = { topic: string; count: number };

export type WeakChapterRow = {
  chapterId: string;
  chapter: string;
  subject: string;
  /** §6.3 — the raw gap. */
  openMistakes: number;
  /** Of those, `times_wrong > 1`: failed after correction, the sharpest signal. */
  repeatedMistakes: number;
  /** §6.3 — the denominator: 8 of 20 is not 8 of 200. Null until something was attempted. */
  accuracyPct: number | null;
  attempted: number;
  /** §6.4, over chapter_tally: the latest three sessions against the previous three. */
  trend: TrendState;
  trendDeltaPoints: number | null;
  sessions: number;
  /** §6.3 — neglect. ISO date of the oldest open mistake. */
  oldestOpenAt: string | null;
  /** §6.3 — did it stick? Straight from chapter_state. */
  revisionState: string | null;
  revisionDue: boolean;
  nextRevisionAt: string | null;
  /** §6.6 — a distinct signal, never folded into the mistakes. */
  skipped: number;
  /** §6.5 — approximate, because topic labels are free text (§10.10). */
  mistakeTopics: TopicCount[];
  skippedTopics: TopicCount[];
  /** §6.5 — slow and correct is not mastery. Seconds, and the student's own average. */
  avgSecPerQuestion: number | null;
  ownAvgSecPerQuestion: number | null;
  /** Why this row is above the others, when it is. */
  pin: "revision_failed" | "repeated_mistakes" | null;
};

function countTopics(rows: Array<{ topic: string | null }>): TopicCount[] {
  const byTopic = new Map<string, number>();
  for (const r of rows) {
    const topic = (r.topic ?? "").trim();
    if (!topic) continue;
    byTopic.set(topic, (byTopic.get(topic) ?? 0) + 1);
  }
  return [...byTopic.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Seconds per question, from the timings that exist.
 *
 * A question with no timing is left out rather than counted as zero: an
 * untimed attempt is not an instant one, and averaging zeros in would make
 * every chapter look faster than the student is.
 */
function avgSeconds(attempts: ChapterAttempt[]): number | null {
  const timed = attempts
    .map((a) => a.time_taken_ms)
    .filter((ms): ms is number => typeof ms === "number" && ms > 0);
  const avg = mean(timed);
  return avg == null ? null : Math.round(avg / 100) / 10;
}

export function deriveWeakChapters(input: {
  states: ChapterStateRow[];
  tallies: ChapterTally[];
  mistakes: ChapterMistake[];
  attempts: ChapterAttempt[];
}): WeakChapterRow[] {
  const { states, tallies, mistakes, attempts } = input;

  const byChapter = <T extends { chapter_id: string | null }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      if (!r.chapter_id) continue;
      const list = map.get(r.chapter_id) ?? [];
      list.push(r);
      map.set(r.chapter_id, list);
    }
    return map;
  };

  const talliesOf = byChapter(tallies);
  const mistakesOf = byChapter(mistakes);
  const attemptsOf = byChapter(attempts);
  const ownAvgSec = avgSeconds(attempts);

  const rows: WeakChapterRow[] = [];
  for (const state of states) {
    if (!state.chapter_id) continue;
    const chapterTallies = (talliesOf.get(state.chapter_id) ?? [])
      .slice()
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
    const chapterMistakes = mistakesOf.get(state.chapter_id) ?? [];
    const open = chapterMistakes.filter((m) => (m.status ?? "open") === "open");
    const chapterAttempts = attemptsOf.get(state.chapter_id) ?? [];
    const skipped = chapterAttempts.filter((a) => a.skipped === true);

    const attempted = chapterTallies.reduce((s, t) => s + (t.attempted ?? 0), 0);
    const correct = chapterTallies.reduce((s, t) => s + (t.correct ?? 0), 0);

    // One session's accuracy, per §6.4's "accuracy across the last N
    // sessions" — a tally row IS a session's work in this chapter, which is
    // why the trend can follow a chapter practised inside a whole-subject
    // session. A session that attempted nothing here has no accuracy to add.
    const series = chapterTallies
      .filter((t) => (t.attempted ?? 0) > 0)
      .map((t) => (100 * (t.correct ?? 0)) / (t.attempted as number));
    const { state: trend, deltaPoints } = trendState(series);

    const oldestOpenAt = open
      .map((m) => m.created_at)
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? null;

    const openMistakes = open.length > 0 ? open.length : (state.open_mistakes ?? 0);
    const repeatedMistakes = open.filter((m) => (m.times_wrong ?? 1) > 1).length;

    // §6.1: this list is what needs work. A chapter with nothing open, nothing
    // skipped and no failed revision does not appear at all.
    const hasSomethingOpen =
      openMistakes > 0 || skipped.length > 0 || state.state === "revision_failed";
    if (!hasSomethingOpen) continue;

    rows.push({
      chapterId: state.chapter_id,
      chapter: state.chapter ?? "",
      subject: state.subject ?? "",
      openMistakes,
      repeatedMistakes,
      accuracyPct: attempted > 0 ? Math.round((100 * correct) / attempted) : null,
      attempted,
      trend,
      trendDeltaPoints: deltaPoints,
      sessions: series.length,
      oldestOpenAt,
      revisionState: state.state ?? null,
      revisionDue: state.revision_due === true,
      nextRevisionAt: state.next_revision_at ?? null,
      skipped: skipped.length,
      mistakeTopics: countTopics(open),
      skippedTopics: countTopics(skipped),
      avgSecPerQuestion: avgSeconds(chapterAttempts),
      ownAvgSecPerQuestion: ownAvgSec,
      pin:
        state.state === "revision_failed"
          ? "revision_failed"
          : repeatedMistakes >= REPEATED_MISTAKE_PIN
            ? "repeated_mistakes"
            : null,
    });
  }

  // §6.3: "Sorted by open_mistakes descending, with two pins to the top:
  // 1. any chapter with revision_failed, 2. any chapter with
  // repeated_mistakes >= 3." The pins are an ORDER, not a score — a pinned
  // chapter still shows its own numbers and is still ranked among its peers
  // by the same rule.
  const pinRank = (row: WeakChapterRow) =>
    row.pin === "revision_failed" ? 0 : row.pin === "repeated_mistakes" ? 1 : 2;

  return rows.sort(
    (a, b) =>
      pinRank(a) - pinRank(b) ||
      b.openMistakes - a.openMistakes ||
      b.skipped - a.skipped ||
      a.chapter.localeCompare(b.chapter),
  );
}
