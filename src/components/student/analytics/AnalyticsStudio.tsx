import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useAnalysisPageData } from "@/hooks/useAnalysisPageData";
import { useAnalyticsInsights } from "@/hooks/useAnalyticsInsights";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { useAuth } from "@/hooks/useAuth";
import { buildRuleAnalyticsInsights, resolveTopicGaps } from "@/lib/analyticsInsights";
import {
  DiagnosisBanner,
  MistakeTopicTable,
  TopicDeepCards,
  WeeklyStudyPlan,
} from "@/components/student/analytics/AnalysisDeepSections";
import {
  CoachCard,
  LeaderboardTop5,
  RecentSessionsList,
  StatRow,
  StrengthsWeaknesses,
  StudioHeader,
  StudioHero,
  StudioTabs,
  SubjectAccuracyChart,
  SubjectCardsGrid,
  WeeklyActivityChart,
  type StudioTab,
} from "@/components/student/analytics/studio";
import "./studio/analytics-studio.css";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
  chartsLoading?: boolean;
};

function initialsFromName(name: string | undefined): string {
  if (!name) return "ST";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function AnalyticsStudio({ data, charts }: Props) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<StudioTab>("overview");
  const { data: pageData, loading: pageLoading } = useAnalysisPageData();
  const { items: mastery } = useConceptMastery();
  const { insights, aggregates, enhancing, loading: insightsLoading } = useAnalyticsInsights(data);

  const readiness = data.exam_readiness;
  const score = readiness?.score ?? 0;
  const xp = data.xp?.xp ?? 0;
  const level = data.xp?.level ?? 1;
  const streak = data.xp?.current_streak ?? 0;
  const rank = pageData?.class_rank;
  const firstName = data.student?.full_name?.split(" ")[0] ?? "Student";

  const ruleInsights =
    aggregates.length > 0 ? buildRuleAnalyticsInsights(aggregates, mastery, data) : null;
  const displayInsights = insights ?? ruleInsights;
  const topicGaps = resolveTopicGaps(displayInsights, aggregates);

  const strongConcepts = mastery
    .filter((m) => m.mastery_score >= 72 && m.mistake_count <= 1)
    .slice(0, 8);
  const weakConcepts = mastery
    .filter((m) => m.mastery_score < 62 || m.mistake_count >= 2)
    .sort((a, b) => a.mastery_score - b.mastery_score)
    .slice(0, 8);

  const coachLines: string[] = [];
  if (displayInsights?.today_focus) coachLines.push(displayInsights.today_focus);
  for (const step of displayInsights?.next_steps?.slice(0, 2) ?? []) {
    if (!coachLines.includes(step)) coachLines.push(step);
  }
  for (const t of topicGaps.slice(0, 3)) {
    const line = `${t.topic}: ${t.fix_hint}`;
    if (coachLines.length < 6 && !coachLines.some((l) => l.includes(t.topic))) coachLines.push(line);
  }
  for (const s of displayInsights?.strong_concepts?.slice(0, 2) ?? []) {
    coachLines.push(`Strength — ${s.concept}: ${s.note}`);
  }
  if (coachLines.length === 0) {
    if (strongConcepts[0]) coachLines.push(`You perform well in ${strongConcepts[0].concept.toLowerCase()}.`);
    if (weakConcepts[0]) {
      coachLines.push(
        `Focus next on ${weakConcepts[0].concept.toLowerCase()} — open Recovery after reading the breakdown below.`,
      );
    }
  }

  const totals = pageData?.totals;
  const accuracy = totals?.accuracy_pct ?? readiness?.accuracy_pct ?? 0;
  const attendance = readiness?.attendance_pct ?? 0;
  const sessions = data.self_practice?.sessions_completed ?? pageData?.recent_sessions.length ?? 0;
  const weeklyPlan = displayInsights?.weekly_plan ?? [];
  const subjects = charts?.subjects ?? [];
  const weeklyActivity = charts?.weekly_activity ?? [];

  const initialLoad = insightsLoading && aggregates.length === 0 && !displayInsights;

  if (initialLoad) {
    return (
      <div className="analytics-studio py-12 text-center text-sm text-[var(--as-muted)]">
        Loading your analysis…
      </div>
    );
  }

  return (
    <div className="analytics-studio animate-rise">
      <StudioHeader
        streak={streak}
        xp={xp}
        level={level}
        initials={initialsFromName(data.student?.full_name)}
      />

      <StudioHero
        firstName={firstName}
        studentClass={pageData?.student_class ?? null}
        classRank={rank}
        classSize={pageData?.class_size ?? 0}
        accuracy={accuracy}
        attendance={attendance}
        level={level}
        xp={xp}
        examReadiness={score}
        subjects={subjects}
      />

      <StudioTabs active={activeTab} onChange={setActiveTab} />

      <div className="as-content">
        {activeTab === "overview" && (
          <>
            <CoachCard lines={coachLines.slice(0, 6)} loading={enhancing} />
            <StatRow
              classRank={rank ?? null}
              streak={streak}
              totalXp={xp}
              sessions={sessions}
            />
            <LeaderboardTop5
              entries={pageData?.leaderboard_top ?? []}
              currentUserId={user?.id}
            />
            {weeklyActivity.length > 0 && <WeeklyActivityChart weeklyActivity={weeklyActivity} />}
            {!pageLoading && <RecentSessionsList sessions={pageData?.recent_sessions ?? []} />}
          </>
        )}

        {activeTab === "subjects" && (
          <>
            <section>
              <h2 className="as-section-title">Subject performance</h2>
              <SubjectCardsGrid subjects={subjects} practiceTrend={charts?.practice_trend} />
            </section>
            <SubjectAccuracyChart subjects={subjects} />
          </>
        )}

        {activeTab === "concepts" && (
          <div className="as-deep space-y-6">
            <StrengthsWeaknesses
              strongConcepts={strongConcepts}
              topicGaps={topicGaps}
              weakConcepts={weakConcepts}
            />
            {displayInsights && <DiagnosisBanner insights={displayInsights} />}
            {topicGaps.length > 0 && <TopicDeepCards topics={topicGaps} />}
            {aggregates.length > 0 && <MistakeTopicTable aggregates={aggregates} />}
            {weeklyPlan.length > 0 && <WeeklyStudyPlan plan={weeklyPlan} />}
          </div>
        )}

        {activeTab === "activity" && (
          <>
            <WeeklyActivityChart weeklyActivity={weeklyActivity} />
            {!pageLoading && <RecentSessionsList sessions={pageData?.recent_sessions ?? []} />}
          </>
        )}

        <div className="flex justify-center pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-[var(--as-muted)] hover:text-[var(--as-text)] hover:bg-white/5"
            asChild
          >
            <Link to="/student/practice/math12">Start another session</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
