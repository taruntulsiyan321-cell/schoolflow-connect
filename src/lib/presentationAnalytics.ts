/**
 * DESIGN-ONLY / DISABLED — static demo enrichments removed from product path.
 * PRESENTATION_MODE is false in product builds. Do not import these into
 * mounted student routes as fallbacks for sparse live data.
 * Empty stubs remain so accidental imports never inject Arjun/Priya fixtures.
 */
import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";
import type { PracticeSessionSummary, LeaderboardEntry } from "@/hooks/useAnalysisPageData";
import type {
  AnalyticsInsights,
  MistakeTopicAggregate,
  MomentumSignal,
  StudyPlanItem,
  TopicGapInsight,
} from "@/lib/analyticsInsights";

/** @deprecated DESIGN-ONLY — always empty in product builds. */
export const DEMO_MASTERY: ConceptMasteryItem[] = [];
/** @deprecated DESIGN-ONLY — always empty in product builds. */
export const DEMO_TOPIC_GAPS: TopicGapInsight[] = [];
/** @deprecated DESIGN-ONLY — always empty in product builds. */
export const DEMO_AGGREGATES: MistakeTopicAggregate[] = [];
/** @deprecated DESIGN-ONLY — always empty in product builds. */
export const DEMO_COACH_INSIGHTS: string[] = [];
/** @deprecated DESIGN-ONLY — always empty in product builds. */
export const DEMO_WEEKLY_PLAN: StudyPlanItem[] = [];
/** @deprecated DESIGN-ONLY — always empty in product builds. */
export const DEMO_MOMENTUM: MomentumSignal[] = [];
/** @deprecated DESIGN-ONLY — always empty in product builds. */
export const DEMO_SESSIONS: PracticeSessionSummary[] = [];
/** @deprecated DESIGN-ONLY — always empty in product builds. */
export const DEMO_LEADERBOARD: LeaderboardEntry[] = [];
/** @deprecated DESIGN-ONLY — always empty in product builds. */
export const DEMO_INSIGHTS: AnalyticsInsights = {
  headline: "",
  summary: "",
  diagnosis: "",
  today_focus: "",
  error_patterns: [],
  recurring_errors: [],
  weak_topics: [],
  weak_concepts: [],
  strong_concepts: [],
  study_priority: [],
  weekly_plan: [],
  momentum: [],
  next_steps: [],
  source: "rule",
};

export function demoPracticeTrend(): { date: string; score_pct: number }[] {
  return [];
}

export function demoActivityHeatmap(): { date: string; total: number; minutes: number }[] {
  return [];
}