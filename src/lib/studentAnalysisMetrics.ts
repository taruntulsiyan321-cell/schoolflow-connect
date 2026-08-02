/**
 * Student Analysis derivation — pure metrics from real attempts / sessions / activity.
 * Never invent peer ranks, mistake-type splits, or placeholder zeros that imply movement.
 */

import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type {
  PracticeTrendPoint,
  WeeklyActivityPoint,
  SubjectChartPoint,
} from "@/hooks/useStudentPerformanceCharts";
import { normalizeSubjectName } from "@/lib/curriculumScope";
import { displayChapter, displaySubject, displayTopic } from "@/lib/academicDisplay";
import {
  buildSubjectRadarPoints,
  dedupeSubjectChartPoints,
  isGenericAcademicLabel,
  preferRealAcademicLabel,
} from "@/lib/qualityGuards";

export { buildSubjectRadarPoints, dedupeSubjectChartPoints };

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function subjectSessionKey(raw: string | null | undefined): string {
  if (!raw || isGenericAcademicLabel(raw)) return "";
  const canon = normalizeSubjectName(raw) || raw.trim();
  const presented = displaySubject(canon) || canon;
  return presented ? presented.toLowerCase() : "";
}

export function weekdayLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { weekday: "short" });
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysAgo(n: number, from = new Date()): Date {
  const d = startOfDay(from);
  d.setDate(d.getDate() - n);
  return d;
}

function accuracyOf(session: PracticeSessionSummary): number {
  return session.accuracy_pct;
}

function sessionSecPerQuestion(session: PracticeSessionSummary): number | null {
  if (session.question_count <= 0) return null;
  const sec = (session.duration_minutes * 60) / session.question_count;
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.round(sec);
}

/** Average accuracy of the first half vs second half of chronologically ordered sessions. */
export function halfWindowTrend(accuracies: number[]): number | null {
  if (accuracies.length < 2) return null;
  const mid = Math.floor(accuracies.length / 2);
  const early = accuracies.slice(0, mid);
  const late = accuracies.slice(mid);
  if (early.length === 0 || late.length === 0) return null;
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.round((avg(late) - avg(early)) * 10) / 10;
}

/** This week vs previous week activity totals by weekday (Mon–Sun). */
export function buildWeekComparison(
  weekly: WeeklyActivityPoint[],
  now = new Date(),
): { day: string; thisWeek: number; lastWeek: number }[] {
  const thisStart = daysAgo(6, now);
  const lastStart = daysAgo(13, now);
  const lastEnd = daysAgo(7, now);

  const thisByDay = new Map<string, number>();
  const lastByDay = new Map<string, number>();

  for (const row of weekly) {
    const d = startOfDay(new Date(row.date));
    const label = weekdayLabel(row.date);
    if (d >= thisStart) {
      thisByDay.set(label, (thisByDay.get(label) ?? 0) + (row.total ?? 0));
    } else if (d >= lastStart && d <= lastEnd) {
      lastByDay.set(label, (lastByDay.get(label) ?? 0) + (row.total ?? 0));
    }
  }

  return DAY_LABELS.map((day) => ({
    day,
    thisWeek: thisByDay.get(day) ?? 0,
    lastWeek: lastByDay.get(day) ?? 0,
  }));
}

export type DerivedSubjectRow = {
  name: string;
  accuracy: number;
  questions: number;
  timeHrs: number;
  trend: number | null;
  status: "best" | "needs-attention" | "good";
};

export function deriveSubjectRows(
  subjects: SubjectChartPoint[],
  sessions: PracticeSessionSummary[],
): DerivedSubjectRow[] {
  const deduped = dedupeSubjectChartPoints(subjects);
  const bySubject = new Map<string, PracticeSessionSummary[]>();
  for (const s of [...sessions].sort(
    (a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime(),
  )) {
    const key = subjectSessionKey(s.subject);
    if (!key) continue;
    const list = bySubject.get(key) ?? [];
    list.push(s);
    bySubject.set(key, list);
  }

  return deduped.map((s) => {
    const accuracy = Math.round(s.accuracy);
    const sess = bySubject.get(s.name.toLowerCase()) ?? [];
    const timeMins = sess.reduce((sum, x) => sum + x.duration_minutes, 0);
    const trend = halfWindowTrend(sess.map(accuracyOf));
    return {
      name: s.name,
      accuracy,
      questions: s.attempts,
      timeHrs: Math.round((timeMins / 60) * 10) / 10,
      trend,
      status: accuracy >= 85 ? "best" : accuracy < 65 ? "needs-attention" : "good",
    };
  });
}

export type DerivedChapterRow = {
  chapter: string;
  subject: string;
  /** Practice depth toward 5 attempts (not syllabus %). */
  practiceDepth: number;
  accuracy: number;
  questions: number;
  trend: number | null;
  status: "ready" | "practice-more" | "needs-work";
};

export function deriveChapterRows(
  mastery: ConceptMasteryItem[],
  sessions: PracticeSessionSummary[],
  snapshot?: AcademicSnapshot | null,
): DerivedChapterRow[] {
  const byChapter = new Map<string, PracticeSessionSummary[]>();
  for (const sess of [...sessions].sort(
    (a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime(),
  )) {
    const subjKey = subjectSessionKey(sess.subject);
    const chapterLabel = preferRealAcademicLabel(sess.chapter);
    if (!subjKey || !chapterLabel) continue;
    const key = `${subjKey}::${chapterLabel.toLowerCase()}`;
    const list = byChapter.get(key) ?? [];
    list.push(sess);
    byChapter.set(key, list);
  }

  const fromMastery = mastery
    .map((m) => {
      const chapterRaw = preferRealAcademicLabel(m.chapter, m.concept);
      const subjectRaw = preferRealAcademicLabel(m.subject);
      if (!chapterRaw || !subjectRaw) return null;
      const chapter = displayChapter(chapterRaw) || chapterRaw;
      const subjectCanon = normalizeSubjectName(subjectRaw) || subjectRaw;
      const subject = displaySubject(subjectCanon) || subjectCanon;
      if (!chapter || !subject || isGenericAcademicLabel(chapter) || isGenericAcademicLabel(subject)) {
        return null;
      }
      const attempts = m.total_attempts ?? 0;
      const accuracy =
        attempts > 0
          ? Math.round((100 * (m.correct_attempts ?? 0)) / attempts)
          : Math.round(m.mastery_score);
      const key = `${subject.toLowerCase()}::${chapter.toLowerCase()}`;
      const sessList = byChapter.get(key) ?? [];
      const trend = halfWindowTrend(sessList.map(accuracyOf));
      return {
        chapter,
        subject,
        practiceDepth: Math.min(100, Math.round((attempts / 5) * 100)),
        accuracy,
        questions: attempts,
        trend,
        status: (accuracy >= 75 ? "ready" : accuracy >= 55 ? "practice-more" : "needs-work") as DerivedChapterRow["status"],
      };
    })
    .filter((r): r is DerivedChapterRow => r != null)
    .slice(0, 12);
  if (fromMastery.length > 0) return fromMastery;

  const weak = snapshot?.weak_topics ?? [];
  const strong = snapshot?.strong_topics ?? [];
  return [...strong, ...weak]
    .map((t) => {
      const chapterRaw = preferRealAcademicLabel(t.topic, t.chapter);
      const subjectRaw = preferRealAcademicLabel(t.subject);
      if (!chapterRaw || !subjectRaw) return null;
      const chapter = displayChapter(chapterRaw) || displayTopic(chapterRaw) || chapterRaw;
      const subjectCanon = normalizeSubjectName(subjectRaw) || subjectRaw;
      const subject = displaySubject(subjectCanon) || subjectCanon;
      if (!chapter || !subject || isGenericAcademicLabel(chapter) || isGenericAcademicLabel(subject)) {
        return null;
      }
      const acc = Math.round(t.accuracy);
      return {
        chapter,
        subject,
        practiceDepth: 0,
        accuracy: acc,
        questions: 0,
        trend: null as number | null,
        status: (acc >= 75 ? "ready" : acc >= 55 ? "practice-more" : "needs-work") as DerivedChapterRow["status"],
      };
    })
    .filter((r): r is DerivedChapterRow => r != null)
    .slice(0, 12);
}

export function deriveImprovingTopics(
  practiceTrend: PracticeTrendPoint[],
  sessions: PracticeSessionSummary[],
): { topic: string; subject: string; improvement: number }[] {
  const byKey = new Map<string, { subject: string; scores: number[] }>();

  const orderedTrend = [...practiceTrend].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  for (const p of orderedTrend) {
    const topic = preferRealAcademicLabel(p.chapter);
    if (!topic) continue;
    const key = topic.toLowerCase();
    const entry = byKey.get(key) ?? { subject: "", scores: [] };
    entry.scores.push(Math.round(p.score_pct));
    byKey.set(key, entry);
  }

  // Fill subject from sessions when trend rows lack it.
  for (const s of sessions) {
    const key = preferRealAcademicLabel(s.chapter).toLowerCase();
    if (!key) continue;
    const entry = byKey.get(key);
    if (entry && !entry.subject) {
      const subj = preferRealAcademicLabel(s.subject);
      if (subj) entry.subject = subj;
    }
  }

  // Session-only chapters not in trend.
  const byChapterSessions = new Map<string, { subject: string; scores: number[] }>();
  for (const s of [...sessions].sort(
    (a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime(),
  )) {
    const topic = preferRealAcademicLabel(s.chapter);
    const subject = preferRealAcademicLabel(s.subject);
    if (!topic || !subject) continue;
    const key = topic.toLowerCase();
    if (byKey.has(key)) continue;
    const entry = byChapterSessions.get(key) ?? { subject, scores: [] };
    entry.scores.push(accuracyOf(s));
    entry.subject = subject;
    byChapterSessions.set(key, entry);
  }

  const merged = [...byKey.entries(), ...byChapterSessions.entries()];
  const out: { topic: string; subject: string; improvement: number }[] = [];
  for (const [key, { subject, scores }] of merged) {
    const trend = halfWindowTrend(scores);
    if (trend == null || trend < 5) continue;
    const realSubject = preferRealAcademicLabel(subject);
    if (!realSubject) continue;
    const topic =
      preferRealAcademicLabel(
        practiceTrend.find((p) => preferRealAcademicLabel(p.chapter).toLowerCase() === key)?.chapter,
        sessions.find((s) => preferRealAcademicLabel(s.chapter).toLowerCase() === key)?.chapter,
        key,
      );
    if (!topic) continue;
    out.push({ topic, subject: realSubject, improvement: Math.round(trend) });
  }
  return out.sort((a, b) => b.improvement - a.improvement).slice(0, 8);
}

export type SpeedStats = {
  avgSec: number;
  fastestSubject: string;
  fastestSec: number;
  slowestSubject: string;
  slowestSec: number;
  improvementSec: number | null;
};

export function deriveSpeedStats(sessions: PracticeSessionSummary[]): {
  stats: SpeedStats;
  bySubject: { name: string; avgSec: number }[];
} {
  const withTiming = sessions.filter((s) => sessionSecPerQuestion(s) != null);
  if (withTiming.length === 0) {
    return {
      stats: {
        avgSec: 0,
        fastestSubject: "—",
        fastestSec: 0,
        slowestSubject: "—",
        slowestSec: 0,
        improvementSec: null,
      },
      bySubject: [],
    };
  }

  const totalSec = withTiming.reduce((sum, s) => sum + (sessionSecPerQuestion(s) ?? 0) * s.question_count, 0);
  const totalQ = withTiming.reduce((sum, s) => sum + s.question_count, 0);
  const avgSec = totalQ > 0 ? Math.round(totalSec / totalQ) : 0;

  const subjectMap = new Map<string, { secSum: number; q: number }>();
  for (const s of withTiming) {
    const key = subjectSessionKey(s.subject);
    if (!key) continue;
    const sec = sessionSecPerQuestion(s)!;
    const cur = subjectMap.get(key) ?? { secSum: 0, q: 0 };
    cur.secSum += sec * s.question_count;
    cur.q += s.question_count;
    subjectMap.set(key, cur);
  }
  const bySubject = [...subjectMap.entries()]
    .map(([key, v]) => ({
      name: displaySubject(key) || normalizeSubjectName(key) || key,
      avgSec: Math.round(v.secSum / v.q),
    }))
    .sort((a, b) => a.avgSec - b.avgSec);

  const ordered = [...withTiming].sort(
    (a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime(),
  );
  const secs = ordered.map((s) => sessionSecPerQuestion(s)!);
  const mid = Math.floor(secs.length / 2);
  let improvementSec: number | null = null;
  if (secs.length >= 2 && mid > 0) {
    const early = secs.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const late = secs.slice(mid).reduce((a, b) => a + b, 0) / (secs.length - mid);
    improvementSec = Math.round(early - late); // positive = faster
  }

  const fastest = bySubject[0];
  const slowest = bySubject[bySubject.length - 1];

  return {
    stats: {
      avgSec,
      fastestSubject: fastest?.name ?? "—",
      fastestSec: fastest?.avgSec ?? 0,
      slowestSubject: slowest && slowest.name !== fastest?.name ? slowest.name : "—",
      slowestSec: slowest && slowest.name !== fastest?.name ? slowest.avgSec : 0,
      improvementSec,
    },
    bySubject,
  };
}

export function deriveMonthComparison(
  weekly: WeeklyActivityPoint[],
  practiceTrend: PracticeTrendPoint[],
  heatmap: AcademicSnapshot["activity_heatmap"],
  now = new Date(),
): { label: string; thisM: number; lastM: number; unit: string }[] {
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
  const lastMonth = lastMonthDate.getMonth();
  const lastYear = lastMonthDate.getFullYear();

  let thisQ = 0;
  let lastQ = 0;
  for (const row of weekly) {
    const d = new Date(row.date);
    if (d.getFullYear() === thisYear && d.getMonth() === thisMonth) thisQ += row.total ?? 0;
    if (d.getFullYear() === lastYear && d.getMonth() === lastMonth) lastQ += row.total ?? 0;
  }

  const scoresThis: number[] = [];
  const scoresLast: number[] = [];
  for (const p of practiceTrend) {
    const d = new Date(p.date);
    if (d.getFullYear() === thisYear && d.getMonth() === thisMonth) scoresThis.push(p.score_pct);
    if (d.getFullYear() === lastYear && d.getMonth() === lastMonth) scoresLast.push(p.score_pct);
  }
  const avg = (xs: number[]) =>
    xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;

  let thisMins = 0;
  let lastMins = 0;
  for (const row of heatmap ?? []) {
    const d = new Date(row.date);
    if (d.getFullYear() === thisYear && d.getMonth() === thisMonth) thisMins += row.minutes ?? 0;
    if (d.getFullYear() === lastYear && d.getMonth() === lastMonth) lastMins += row.minutes ?? 0;
  }

  return [
    { label: "Questions", thisM: thisQ, lastM: lastQ, unit: "" },
    { label: "Avg score", thisM: avg(scoresThis), lastM: avg(scoresLast), unit: "%" },
    {
      label: "Study time",
      thisM: Math.round(thisMins / 60),
      lastM: Math.round(lastMins / 60),
      unit: "h",
    },
  ];
}

export function deriveRecoveryProgress(mastery: ConceptMasteryItem[], pending: number) {
  const recovered = mastery.filter((m) => (m.recovery_attempts ?? 0) > 0);
  const completed = recovered.filter((m) => m.mastery_score >= 65);
  const stillWeak = recovered.filter((m) => m.mastery_score < 65);
  // Only report a lift when both cleared and still-open recovery concepts exist (real comparison).
  let improvementAfter = 0;
  if (completed.length > 0 && stillWeak.length > 0) {
    const avgDone = completed.reduce((s, m) => s + m.mastery_score, 0) / completed.length;
    const avgOpen = stillWeak.reduce((s, m) => s + m.mastery_score, 0) / stillWeak.length;
    improvementAfter = Math.max(0, Math.round(avgDone - avgOpen));
  }
  return {
    totalToRevisit: pending + recovered.length,
    completed: completed.length,
    stillPending: pending,
    improvementAfter,
  };
}

export function deriveRecoveryTopics(
  weakTopics: AcademicSnapshot["weak_topics"],
  mastery: ConceptMasteryItem[],
): {
  topic: string;
  subject: string;
  status: "pending" | "completed";
  attempts: number;
  improvement: number;
}[] {
  return (weakTopics ?? [])
    .map((t) => {
      const topic = preferRealAcademicLabel(t.topic, t.chapter);
      const subject = preferRealAcademicLabel(t.subject);
      if (!topic || !subject) return null;
      const match = mastery.find(
        (m) =>
          preferRealAcademicLabel(m.subject) === subject &&
          (preferRealAcademicLabel(m.concept) === topic ||
            preferRealAcademicLabel(m.chapter) === topic ||
            m.concept === t.topic ||
            m.chapter === t.chapter),
      );
      const attempts = match?.total_attempts ?? match?.recovery_attempts ?? 0;
      const completed =
        (match?.recovery_attempts ?? 0) > 0 && (match?.mastery_score ?? 0) >= 65;
      let improvement = 0;
      if (completed && match && match.total_attempts > 0) {
        const acc = Math.round((100 * match.correct_attempts) / match.total_attempts);
        improvement = Math.max(0, Math.round(acc - t.accuracy));
      }
      return {
        topic,
        subject,
        status: completed ? ("completed" as const) : ("pending" as const),
        attempts,
        improvement,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .slice(0, 6);
}

export function deriveRevisionData(queue: AcademicSnapshot["revision_queue"]) {
  const items = queue ?? [];
  const dueToday = items
    .filter((r) => new Date(r.due_date).toDateString() === new Date().toDateString())
    .map((r) => preferRealAcademicLabel(r.topic, r.chapter, r.subject))
    .filter((label): label is string => Boolean(label));
  // Queue only contains open items — completed revisions leave the queue.
  return {
    totalRevised: items.length,
    completed: 0,
    pending: items.length,
    dueToday,
  };
}

export function scoreAxisDomain(scores: number[]): [number, number] {
  if (scores.length === 0) return [0, 100];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const lo = Math.max(0, Math.floor((min - 10) / 10) * 10);
  const hi = Math.min(100, Math.ceil((max + 5) / 10) * 10);
  return [lo < hi ? lo : 0, hi > lo ? hi : 100];
}

/** Practice count for a weak topic from finished sessions. */
export function practiceCountForTopic(
  sessions: PracticeSessionSummary[],
  subject: string,
  topic: string,
): number {
  const needle = topic.trim().toLowerCase();
  return sessions
    .filter(
      (s) =>
        s.subject === subject &&
        ((s.chapter || "").trim().toLowerCase() === needle ||
          (s.chapter || "").toLowerCase().includes(needle)),
    )
    .reduce((sum, s) => sum + s.question_count, 0);
}
