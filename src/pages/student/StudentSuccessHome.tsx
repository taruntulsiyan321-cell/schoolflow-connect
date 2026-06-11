import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentXp } from "@/hooks/useStudentXp";
import { useAnalysisPageData } from "@/hooks/useAnalysisPageData";
import {
  FlowActionCard,
  FlowConceptPanel,
  FlowConceptTag,
  FlowHero,
  FlowPage,
  FlowRecoveryCard,
  FlowSectionTitle,
  FlowStatGrid,
} from "@/components/student/flow/FlowDesign";
import { StudentDashboardSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { BookOpen, Calculator, ClipboardCheck, Flame, Sword, Target, Wrench } from "lucide-react";

export default function StudentSuccessHome() {
  const { data, loading, error, reload } = useStudentAcademicSnapshot();
  const { xp: liveXp } = useStudentXp();
  const { data: pageData } = useAnalysisPageData(!loading && !error);
  const xp = liveXp.xp > 0 || liveXp.level > 1 ? liveXp : data?.xp;

  if (loading) return <StudentDashboardSkeleton />;

  if (error) {
    return (
      <StudentErrorState
        title="Could not load your dashboard"
        hint="If this is a new setup, apply pending database migrations in Supabase."
        message={error}
        onRetry={reload}
      />
    );
  }

  const readiness = data?.exam_readiness;
  const score = readiness?.score ?? 0;
  const firstName = data?.student?.full_name?.split(" ")[0] ?? "Student";

  return (
    <FlowPage className="max-w-3xl">
      <FlowHero
        eyebrow={`Hi, ${firstName}`}
        title="Your learning journey"
        metrics={[
          { label: "Ready", value: `${score}%` },
          { label: "Accuracy", value: `${readiness?.accuracy_pct ?? 0}%` },
          { label: "Streak", value: `${xp?.current_streak ?? 0}d` },
          { label: "Rank", value: pageData?.class_rank ? `#${pageData.class_rank}` : "—" },
          { label: "XP", value: (xp?.xp ?? 0).toLocaleString() },
        ]}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="rounded-full bg-white/20 hover:bg-white/30 text-white border-0" asChild>
              <Link to="/student/practice/math12">Practice</Link>
            </Button>
            <Button size="sm" variant="secondary" className="rounded-full" asChild>
              <Link to="/student/analytics">View analysis</Link>
            </Button>
          </div>
        }
      />

      <section>
        <FlowSectionTitle>Today at a glance</FlowSectionTitle>
        <FlowStatGrid
          columns={4}
          items={[
            { label: "Attendance", value: `${readiness?.attendance_pct ?? 0}%` },
            { label: "Homework", value: data?.homework?.pending ?? 0, sub: "pending" },
            { label: "DPP", value: data?.dpp?.open ?? 0, sub: "to do" },
            { label: "Mistakes", value: data?.mistake_count ?? 0, sub: "to fix" },
          ]}
        />
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <FlowConceptPanel
          title="Strong concepts"
          icon={<Target className="w-4 h-4" />}
          variant="strong"
          empty="Strengths appear as you practice."
        >
          {(data?.strong_topics ?? []).map((w, i) => (
            <FlowConceptTag
              key={i}
              label={w.topic ?? w.chapter ?? w.subject}
              meta={`${Math.round(w.accuracy)}%`}
              variant="strong"
            />
          ))}
        </FlowConceptPanel>

        <FlowConceptPanel
          title="Needs work"
          icon={<ClipboardCheck className="w-4 h-4" />}
          variant="weak"
          empty="Complete practice to detect weak spots."
        >
          {(data?.weak_topics ?? []).slice(0, 5).map((w, i) => (
            <FlowConceptTag
              key={i}
              label={w.topic ?? w.chapter ?? w.subject}
              meta={`${Math.round(w.accuracy)}%`}
              variant="weak"
            />
          ))}
        </FlowConceptPanel>
      </div>

      <FlowRecoveryCard
        count={data?.recovery_pending ?? data?.mistake_count ?? 0}
        weakConcepts={(data?.weak_concepts ?? []).slice(0, 5).map((c) => c.concept)}
      />

      <section>
        <FlowSectionTitle>Quick actions</FlowSectionTitle>
        <div className="grid sm:grid-cols-3 gap-3">
          <FlowActionCard
            icon={<Calculator className="w-5 h-5" />}
            title="Practice"
            description="Fresh Class 12 questions"
            to="/student/practice/math12"
          />
          <FlowActionCard
            icon={<Wrench className="w-5 h-5" />}
            title="Recovery"
            description={`${data?.mistake_count ?? 0} mistakes in your book`}
            to="/student/recovery"
          />
          <FlowActionCard
            icon={<Sword className="w-5 h-5" />}
            title="Battleground"
            description="Challenge classmates"
            to="/student/battleground"
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-2 justify-center pt-2">
        <Button size="sm" variant="outline" className="rounded-full" asChild>
          <Link to="/student/homework"><BookOpen className="w-3.5 h-3.5 mr-1" /> Homework</Link>
        </Button>
        <Button size="sm" variant="outline" className="rounded-full" asChild>
          <Link to="/student/dpp"><Flame className="w-3.5 h-3.5 mr-1" /> Daily DPP</Link>
        </Button>
      </div>
    </FlowPage>
  );
}
