/**
 * The student's whole syllabus as a map, and the topics slipping lately
 * (owner-approved analysis, 2026-10-03). The counts are rpc_student_syllabus_map's
 * (20261145000000); what they mean is decided here.
 *
 * §10.8: weaknesses only. A chapter is "not practised", "started" (too few
 * answers to judge) or on the accuracy ladder, whose top rung is "On track" —
 * there is no strong.
 */
import { type AccuracyBand, accuracyBand } from "./bands";
import { mayBeJudged } from "./thresholds";
import { TREND_DELTA_POINTS } from "../recovery/constants";

export type Counts = { answered: number; correct: number; recentAnswered: number; recentCorrect: number; lastAt: string | null };
export type MapChapter = Counts & { chapterId: string; chapter: string; subject: string; sequence: number };
export type MapTopic = Counts & { topicId: string; topic: string; chapterId: string };
export type SyllabusMap = {
  /** False when the account has no exam: then there is no syllabus to map. */
  examFound: boolean;
  recentDays: number;
  chapters: MapChapter[];
  topics: MapTopic[];
  /** Topics are withheld by the plan (topic analysis). */
  topicsLocked: boolean;
};

const pct = (n: number, d: number) => Math.round((n / d) * 100);

export type PlaceOnMap =
  | { kind: "untouched" }
  | { kind: "started"; answered: number }
  | { kind: "judged"; accuracy: number; band: AccuracyBand };

/** Where a chapter or topic stands: not practised, started, or its rung — with enough answers behind it. */
export function placeOnMap(c: Pick<Counts, "answered" | "correct">): PlaceOnMap {
  if (c.answered <= 0) return { kind: "untouched" };
  if (!mayBeJudged(c.answered)) return { kind: "started", answered: c.answered };
  const accuracy = pct(c.correct, c.answered);
  return { kind: "judged", accuracy, band: accuracyBand(accuracy) };
}

export type SubjectOnMap = { subject: string; chapters: MapChapter[]; practised: number };

/** The syllabus by subject, each subject's chapters in syllabus order. */
export function subjectsOnMap(map: SyllabusMap): SubjectOnMap[] {
  const bySubject = new Map<string, MapChapter[]>();
  for (const c of map.chapters) bySubject.set(c.subject, [...(bySubject.get(c.subject) ?? []), c]);
  return [...bySubject]
    .map(([subject, chapters]) => ({
      subject,
      chapters: [...chapters].sort((x, y) => x.sequence - y.sequence || x.chapter.localeCompare(y.chapter)),
      practised: chapters.filter((c) => c.answered > 0).length,
    }))
    .sort((x, y) => x.subject.localeCompare(y.subject));
}

export type Coverage = { chapters: number; practised: number; judged: number };

/** How much of the syllabus the student has met: practised at all, and with enough answers to judge. */
export function coverage(map: SyllabusMap): Coverage {
  return {
    chapters: map.chapters.length,
    practised: map.chapters.filter((c) => c.answered > 0).length,
    judged: map.chapters.filter((c) => mayBeJudged(c.answered)).length,
  };
}

export type SideOfTrend = { answered: number; correct: number; accuracy: number };
export type SlippingTopic = {
  topicId: string;
  topic: string;
  chapter: string;
  subject: string;
  earlier: SideOfTrend;
  recent: SideOfTrend;
  /** Points: earlier minus recent. */
  drop: number;
};

/**
 * Topics right less often lately than before: enough answers on BOTH sides of
 * the window to judge each, and a fall of at least TREND_DELTA_POINTS — the
 * same line every trend in the product is drawn at (§6.4). Biggest fall first.
 */
export function slippingTopics(map: SyllabusMap): SlippingTopic[] {
  const chapters = new Map(map.chapters.map((c) => [c.chapterId, c]));
  const out: SlippingTopic[] = [];
  for (const t of map.topics) {
    const earlierAnswered = t.answered - t.recentAnswered;
    const earlierCorrect = t.correct - t.recentCorrect;
    if (!mayBeJudged(earlierAnswered) || !mayBeJudged(t.recentAnswered)) continue;
    const earlier = { answered: earlierAnswered, correct: earlierCorrect, accuracy: pct(earlierCorrect, earlierAnswered) };
    const recent = { answered: t.recentAnswered, correct: t.recentCorrect, accuracy: pct(t.recentCorrect, t.recentAnswered) };
    const drop = earlier.accuracy - recent.accuracy;
    if (drop < TREND_DELTA_POINTS) continue;
    const ch = chapters.get(t.chapterId);
    out.push({ topicId: t.topicId, topic: t.topic, chapter: ch?.chapter ?? "", subject: ch?.subject ?? "", earlier, recent, drop });
  }
  return out.sort((x, y) => y.drop - x.drop || x.topic.localeCompare(y.topic));
}
