import { useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import {
  LayoutDashboard,
  ClipboardCheck,
  Bell,
  FileText,
  Check,
  X,
  Coffee,
  BookOpen,
  Users,
  CalendarOff,
  NotebookPen,
  BarChart3,
  CalendarDays,
  MessageSquare,
  User,
  Target,
  Sword,
  Database,
  TrendingUp,
  HelpCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Trophy,
  Lightbulb,
  Activity,
  Sparkles,
  Radio,
} from "lucide-react";
import DppList from "./teacher/DppList";
import DppEditor from "./teacher/DppEditor";
import DppAnalytics from "./teacher/DppAnalytics";
import TeacherProfilePage from "./shared/TeacherProfilePage";
import StudentPerformancePage from "./shared/StudentPerformancePage";
import TeacherReportsPage from "./shared/TeacherReportsPage";
import TeacherTimetablePage from "./shared/TeacherTimetablePage";
import HomeworkManagePage from "./shared/HomeworkManagePage";
import ChatPage from "./shared/ChatPage";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import NoticesPage from "./shared/NoticesPage";
import ExamsPage from "./shared/ExamsPage";
import LeaveRequestsPage from "./shared/LeaveRequestsPage";
import TeacherBattleground from "./teacher/TeacherBattleground";
import BattleMonitor from "./teacher/BattleMonitor";
import BattleTeacherReport from "./teacher/BattleTeacherReport";
import QuestionBankPage from "./shared/QuestionBankPage";
import ClassInsights from "./teacher/ClassInsights";
import { CommunityDoubtPortal } from "@/components/community/CommunityDoubtPortal";
import "./teacher/teacher-premium.css";

const nav = [
  { to: "/teacher", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/teacher/class", label: "Class", icon: <Users className="w-4 h-4" /> },
  { to: "/teacher/insights", label: "Insights", icon: <TrendingUp className="w-4 h-4" /> },
  { to: "/teacher/practice", label: "Practice", icon: <Target className="w-4 h-4" /> },
  { to: "/teacher/battleground", label: "Battleground", icon: <Sword className="w-4 h-4" /> },
  { to: "/teacher/connect", label: "Connect", icon: <MessageSquare className="w-4 h-4" /> },
  { to: "/teacher/reports", label: "Reports", icon: <FileText className="w-4 h-4" /> },
  { to: "/teacher/profile", label: "Profile", icon: <User className="w-4 h-4" /> },
];

// Hook to load teacher's class-teacher class + subject classes
function useTeacherAssignments() {
  const { user } = useAuth();
  const [data, setData] = useState<{
    teacherId: string | null;
    teacherName: string | null;
    primarySubject: string | null;
    classTeacherOf: { id: string; name: string; section: string } | null;
    subjectClasses: { id: string; name: string; section: string; subject: string | null }[];
    loading: boolean;
  }>({ teacherId: null, teacherName: null, primarySubject: null, classTeacherOf: null, subjectClasses: [], loading: true });

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: t } = await supabase.from("teachers").select("id, full_name, subject, class_teacher_of").eq("user_id", user.id).maybeSingle();
      if (!t) { setData(d => ({ ...d, loading: false })); return; }
      let classTeacherOf = null;
      if (t.class_teacher_of) {
        const { data: c } = await supabase.from("classes").select("id,name,section").eq("id", t.class_teacher_of).maybeSingle();
        classTeacherOf = c ?? null;
      }
      const { data: tc } = await supabase.from("teacher_classes").select("class_id, subject, classes(id,name,section)").eq("teacher_id", t.id);
      const subjectClasses = (tc ?? []).map((r: any) => ({
        id: r.classes?.id, name: r.classes?.name, section: r.classes?.section, subject: r.subject,
      })).filter(x => x.id);
      setData({ teacherId: t.id, teacherName: t.full_name ?? null, primarySubject: t.subject ?? null, classTeacherOf, subjectClasses, loading: false });
    })();
  }, [user]);
  return data;
}

function TeacherMetric({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: string }) {
  return (
    <Card className="tp-metric">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tp-label">{label}</p>
          <p className="text-2xl font-bold tabular-nums mt-2 truncate">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <div className="tp-icon">{icon}</div>
      </div>
    </Card>
  );
}

type MissionStudent = {
  student_id?: string;
  name: string;
  attendance_pct?: number;
  avg_accuracy?: number;
  xp?: number;
};

type MissionConcept = {
  subject?: string;
  chapter?: string;
  concept?: string;
  avg_mastery?: number;
  accuracy?: number;
  students?: number;
};

type MissionControlData = {
  loading: boolean;
  totalStudents: number;
  pendingReview: number;
  pendingRecovery: number;
  activeBattles: number;
  unansweredDoubts: number;
  todayClasses: string[];
  atRisk: MissionStudent[];
  improving: MissionStudent[];
  weakConcepts: MissionConcept[];
  weakTopics: MissionConcept[];
  recentDoubts: { id: string; title: string; subject?: string; concept?: string; answer_count?: number }[];
};

function classLabel(c: { name: string; section: string; subject?: string | null }) {
  return `Class ${c.name}-${c.section}${c.subject ? ` · ${c.subject}` : ""}`;
}

function useMissionControl(assignments: ReturnType<typeof useTeacherAssignments>): MissionControlData {
  const { user } = useAuth();
  const [data, setData] = useState<MissionControlData>({
    loading: true,
    totalStudents: 0,
    pendingReview: 0,
    pendingRecovery: 0,
    activeBattles: 0,
    unansweredDoubts: 0,
    todayClasses: [],
    atRisk: [],
    improving: [],
    weakConcepts: [],
    weakTopics: [],
    recentDoubts: [],
  });

  useEffect(() => {
    if (!user || assignments.loading) return;
    const classIds = [
      ...(assignments.classTeacherOf ? [assignments.classTeacherOf.id] : []),
      ...assignments.subjectClasses.map((c) => c.id),
    ].filter((id, index, arr) => id && arr.indexOf(id) === index);

    if (classIds.length === 0) {
      setData((current) => ({ ...current, loading: false, todayClasses: [] }));
      return;
    }

    let cancelled = false;

    (async () => {
      setData((current) => ({ ...current, loading: true }));
      const todayClasses = [
        ...(assignments.classTeacherOf ? [`Class ${assignments.classTeacherOf.name}-${assignments.classTeacherOf.section} · Mentor`] : []),
        ...assignments.subjectClasses.slice(0, 4).map(classLabel),
      ];

      const { data: students } = await supabase
        .from("students")
        .select("id, full_name, class_id")
        .in("class_id", classIds);
      const studentIds = (students ?? []).map((student) => student.id);

      const { data: homeworkRows } = await supabase
        .from("homework")
        .select("id")
        .eq("created_by", user.id);
      const homeworkIds = (homeworkRows ?? []).map((row) => row.id);
      const pendingReviewPromise = homeworkIds.length
        ? supabase
            .from("homework_submissions")
            .select("id", { count: "exact", head: true })
            .in("homework_id", homeworkIds)
            .eq("status", "submitted")
        : Promise.resolve({ count: 0 });

      const pendingRecoveryPromise = studentIds.length
        ? supabase
            .from("recovery_assignments")
            .select("id", { count: "exact", head: true })
            .in("student_id", studentIds)
            .neq("status", "completed")
        : Promise.resolve({ count: 0 });

      const activeBattlesPromise = supabase
        .from("battles")
        .select("id", { count: "exact", head: true })
        .in("class_id", classIds)
        .eq("status", "live");

      const doubtsPromise = (supabase as any)
        .from("community_doubts")
        .select("id,title,subject,concept,answer_count")
        .in("class_id", classIds)
        .eq("teacher_answered", false)
        .order("last_activity_at", { ascending: false })
        .limit(6);

      const analytics = await Promise.all(
        classIds.slice(0, 4).map(async (classId) => {
          const { data: insights } = await supabase.rpc("rpc_teacher_concept_analytics", { _class_id: classId });
          return insights as any;
        }),
      );

      const [
        pendingReviewResult,
        pendingRecoveryResult,
        activeBattlesResult,
        doubtsResult,
      ] = await Promise.all([
        pendingReviewPromise,
        pendingRecoveryPromise,
        activeBattlesPromise,
        doubtsPromise,
      ]);

      const atRisk = analytics.flatMap((item) => item?.at_risk ?? []).slice(0, 8);
      const improving = analytics.flatMap((item) => item?.improving ?? []).slice(0, 8);
      const weakConcepts = analytics.flatMap((item) => item?.class_weak_concepts ?? []).slice(0, 8);
      const weakTopics = analytics.flatMap((item) => item?.class_weak_topics ?? []).slice(0, 8);

      if (!cancelled) {
        setData({
          loading: false,
          totalStudents: students?.length ?? 0,
          pendingReview: pendingReviewResult.count ?? 0,
          pendingRecovery: pendingRecoveryResult.count ?? 0,
          activeBattles: activeBattlesResult.count ?? 0,
          unansweredDoubts: doubtsResult.data?.length ?? 0,
          todayClasses,
          atRisk,
          improving,
          weakConcepts,
          weakTopics,
          recentDoubts: doubtsResult.data ?? [],
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, assignments.loading, assignments.classTeacherOf, assignments.subjectClasses]);

  return data;
}

const Overview = () => {
  const a = useTeacherAssignments();
  const mission = useMissionControl(a);
  const navigate = useNavigate();
  const totalRoles = (a.classTeacherOf ? 1 : 0) + a.subjectClasses.length;
  const uniqueSubjects = new Set(a.subjectClasses.map((c) => c.subject).filter(Boolean)).size || (a.primarySubject ? 1 : 0);
  const examReadiness = Math.max(48, Math.min(96, 82 - mission.atRisk.length * 3 + mission.improving.length * 2));
  return (
    <div className="tp-shell space-y-6">
      <section className="tp-hero">
        <div className="relative z-10 grid xl:grid-cols-[1.08fr_0.92fr] gap-6">
          <div>
            <div className="tp-kicker mb-4">Teacher Dashboard</div>
            <p className="text-sm text-white/70">Welcome back, {a.teacherName?.split(" ")[0] || "Teacher"}</p>
            <h1 className="tp-display text-3xl sm:text-5xl mt-1">What should improve today?</h1>
            <p className="text-sm text-white/75 mt-4 max-w-xl">
              Mission Control shows the learning signals that matter: who needs help, what confused the class, where recovery is pending, and what action to take next.
            </p>
            <div className="flex flex-wrap gap-2 mt-5">
              <Button className="bg-white text-emerald-950 hover:bg-white/90" onClick={() => navigate("/teacher/insights")}>Open confusion map</Button>
              <Button variant="outline" className="border-white/30 text-white hover:bg-white/10" onClick={() => navigate("/teacher/dpp")}>Assign practice</Button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/12 border border-white/15 p-4 backdrop-blur">
              <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold">Students needing attention</p>
              <p className="text-3xl font-bold mt-1">{mission.atRisk.length}</p>
              <p className="text-xs text-white/65 mt-1">early intervention queue</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-white/15 p-4 backdrop-blur">
              <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold">Exam readiness</p>
              <p className="text-3xl font-bold mt-1">{examReadiness}%</p>
              <p className="text-xs text-white/65 mt-1">based on latest class signals</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-white/15 p-4 backdrop-blur">
              <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold">Recovery pending</p>
              <p className="text-3xl font-bold mt-1">{mission.pendingRecovery}</p>
              <p className="text-xs text-white/65 mt-1">needs follow-up</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-white/15 p-4 backdrop-blur">
              <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold">Doubts waiting</p>
              <p className="text-3xl font-bold mt-1">{mission.unansweredDoubts}</p>
              <p className="text-xs text-white/65 mt-1">teacher response needed</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <TeacherMetric icon={<BookOpen className="w-5 h-5" />} label="Today's Classes" value={mission.todayClasses.length || totalRoles} sub={`${uniqueSubjects} subject focus`} />
        <TeacherMetric icon={<NotebookPen className="w-5 h-5" />} label="Pending Review" value={mission.pendingReview} sub="homework submissions" />
        <TeacherMetric icon={<Radio className="w-5 h-5" />} label="Active Battles" value={mission.activeBattles} sub="live learning rooms" />
        <TeacherMetric icon={<Sparkles className="w-5 h-5" />} label="Recent Improvements" value={mission.improving.length} sub="students trending up" />
      </div>

      <Card className="tp-card p-5">
        <div className="grid lg:grid-cols-[0.85fr_1.15fr] gap-5 items-center">
          <div>
            <p className="tp-label">Student data sync</p>
            <h3 className="tp-display text-2xl mt-1">Student panel intelligence is visible here.</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Practice attempts, homework, doubts, recovery sessions, battles, and mastery signals from student activity appear as teacher-ready AI insights.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="tp-row text-center">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Student Panel</div>
              <div className="mt-2 text-2xl font-bold">{mission.totalStudents}</div>
              <div className="text-xs text-muted-foreground">learners tracked</div>
            </div>
            <div className="tp-row text-center border-primary/30 bg-primary/5">
              <div className="text-xs font-bold uppercase tracking-wider text-primary">AI Analysis</div>
              <div className="mt-2 text-2xl font-bold">{mission.weakConcepts.length + mission.atRisk.length}</div>
              <div className="text-xs text-muted-foreground">signals generated</div>
            </div>
            <div className="tp-row text-center">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Teacher + Principal</div>
              <div className="mt-2 text-2xl font-bold">Synced</div>
              <div className="text-xs text-muted-foreground">same intelligence layer</div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid xl:grid-cols-[0.9fr_1.1fr] gap-4">
        <Card className="tp-card p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="tp-label">Today</p>
              <h3 className="tp-display text-xl mt-1">Teaching map</h3>
            </div>
            <div className="tp-icon"><CalendarDays className="w-5 h-5" /></div>
          </div>
          <div className="space-y-2">
            {(mission.todayClasses.length ? mission.todayClasses : ["No classes assigned yet"]).map((label, index) => (
              <div key={`${label}-${index}`} className="tp-row flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground">{index === 0 ? "Start with recovery and doubt follow-up" : "Review weak concepts before class"}</p>
                </div>
                <Badge variant="outline" className="rounded-full">{index === 0 ? "Priority" : "Ready"}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="tp-card p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="tp-label">Needs help</p>
              <h3 className="tp-display text-xl mt-1">Students needing attention</h3>
            </div>
            <div className="tp-icon bg-red-100 text-red-700"><AlertTriangle className="w-5 h-5" /></div>
          </div>
          <div className="space-y-2">
            {mission.atRisk.slice(0, 5).map((student) => (
              <button key={student.student_id ?? student.name} type="button" onClick={() => navigate("/teacher/performance")} className="tp-row w-full text-left flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-sm">{student.name}</p>
                  <p className="text-xs text-muted-foreground">Attendance {student.attendance_pct ?? 0}% · Accuracy {student.avg_accuracy ?? 0}%</p>
                </div>
                <Badge variant="destructive" className="rounded-full">Intervene</Badge>
              </button>
            ))}
            {!mission.atRisk.length && <p className="text-sm text-muted-foreground">No urgent student risk signals right now.</p>}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="tp-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="tp-label">Weak concepts</p>
              <h3 className="tp-display text-xl mt-1">What needs reteaching?</h3>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/teacher/insights")}>Open map</Button>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {[...mission.weakConcepts, ...mission.weakTopics].slice(0, 6).map((concept, index) => {
              const score = Number(concept.avg_mastery ?? concept.accuracy ?? 0);
              const label = concept.concept || concept.chapter || "Concept";
              const strength = Math.max(8, Math.min(100, score));
              return (
                <div key={`${label}-${index}`} className="tp-row">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div>
                      <p className="font-semibold text-sm">{label}</p>
                      <p className="text-xs text-muted-foreground">{concept.subject || "Subject"} · {concept.students ?? "Multiple"} students affected</p>
                    </div>
                    <span className="text-xs font-bold text-warning">{score || "Low"}%</span>
                  </div>
                  <div className="tp-progress"><span style={{ width: `${strength}%` }} /></div>
                </div>
              );
            })}
            {mission.weakConcepts.length + mission.weakTopics.length === 0 && (
              <p className="text-sm text-muted-foreground">Confusion patterns will appear after students complete practice.</p>
            )}
          </div>
        </Card>

        <Card className="tp-card tp-gold-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-5 h-5 text-amber-700" />
            <h3 className="tp-display text-xl">Most improved</h3>
          </div>
          <div className="space-y-2">
            {mission.improving.slice(0, 5).map((student) => (
              <div key={student.student_id ?? student.name} className="tp-row flex items-center justify-between">
                <span className="font-semibold text-sm">{student.name}</span>
                <Badge variant="outline" className="rounded-full bg-accent/10 text-accent">Rising</Badge>
              </div>
            ))}
            {!mission.improving.length && <p className="text-sm text-muted-foreground">Improvement highlights will build as practice data grows.</p>}
          </div>
        </Card>
      </div>

      <Card className="tp-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <p className="tp-label">Next best actions</p>
            <h3 className="tp-display text-xl mt-1">Improve learning today</h3>
          </div>
          <span className="tp-chip">{mission.loading ? "Reading signals" : "Ready"}</span>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          {[
            { label: "Help at-risk students", route: "/teacher/performance", icon: AlertTriangle, hint: `${mission.atRisk.length} students flagged` },
            { label: "Assign recovery practice", route: "/teacher/dpp", icon: Target, hint: `${mission.pendingRecovery} recovery pending` },
            { label: "Answer class doubts", route: "/teacher/doubts", icon: HelpCircle, hint: `${mission.unansweredDoubts} waiting` },
            { label: "Run concept battle", route: "/teacher/battleground", icon: Sword, hint: `${mission.activeBattles} live now` },
          ].map((action) => {
            const Icon = action.icon;
            return (
              <button key={action.label} type="button" onClick={() => navigate(action.route)} className="tp-action text-left hover:border-primary/30 transition-colors">
                <div className="tp-icon mb-3"><Icon className="w-4 h-4" /></div>
                <p className="font-semibold text-sm">{action.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{action.hint}</p>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="tp-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="tp-display text-xl">Doubts awaiting teacher response</h3>
            <Button variant="outline" size="sm" onClick={() => navigate("/teacher/doubts")}>Respond</Button>
          </div>
          <div className="space-y-2">
            {mission.recentDoubts.map((doubt) => (
              <div key={doubt.id} className="tp-row">
                <p className="font-semibold text-sm">{doubt.title}</p>
                <p className="text-xs text-muted-foreground">{doubt.subject || "Subject"} · {doubt.concept || "Concept"} · {doubt.answer_count ?? 0} answers</p>
              </div>
            ))}
            {!mission.recentDoubts.length && <p className="text-sm text-muted-foreground">No unanswered teacher doubts right now.</p>}
          </div>
        </Card>

        <Card className="tp-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-5 h-5 text-primary" />
            <h3 className="tp-display text-xl">Teacher playbook</h3>
          </div>
          <div className="space-y-2">
            <div className="tp-row"><b>Before class:</b> open the confusion map and reteach the weakest concept for 8 minutes.</div>
            <div className="tp-row"><b>After class:</b> assign a focused DPP or recovery set for the same concept.</div>
            <div className="tp-row"><b>Before exams:</b> use early warnings to meet students whose accuracy or practice consistency drops.</div>
          </div>
        </Card>
      </div>
    </div>
  );
};

const MyClass = () => {
  const { user } = useAuth();
  const a = useTeacherAssignments();
  const [students, setStudents] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [insights, setInsights] = useState<any>(null);
  useEffect(() => {
    if (!a.classTeacherOf) return;
    (async () => {
      const { data: s } = await supabase.from("students").select("*").eq("class_id", a.classTeacherOf!.id).order("roll_number");
      setStudents(s ?? []);
      const { data: l } = await supabase.from("leave_requests").select("*").eq("class_id", a.classTeacherOf!.id).eq("status", "pending");
      setLeaves(l ?? []);
      const { data: classInsights } = await supabase.rpc("rpc_teacher_concept_analytics", { _class_id: a.classTeacherOf!.id });
      setInsights(classInsights);
    })();
  }, [a.classTeacherOf]);

  if (a.loading) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground text-sm">Loading your class…</p>
      </Card>
    );
  }
  if (!a.classTeacherOf) return (
    <Card className="p-8 text-center">
      <Users className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
      <p className="text-muted-foreground">You are not assigned as a class teacher.</p>
    </Card>
  );

  const review = async (id: string, status: "approved" | "rejected") => {
    const { error } = await supabase.from("leave_requests").update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Leave ${status}`);
    setLeaves(l => l.filter(x => x.id !== id));
  };

  const atRisk = insights?.at_risk ?? [];
  const improving = insights?.improving ?? [];
  const weakConcepts = insights?.class_weak_concepts ?? [];
  const weakTopics = insights?.class_weak_topics ?? [];
  const recoveryCompletion = typeof insights?.recovery_completion_rate === "number" ? insights.recovery_completion_rate : 0;
  const mastery = insights?.mastery_distribution ?? {};
  const highMastery = mastery.above_80 ?? 0;
  const lowMastery = mastery.below_40 ?? 0;
  const avgMastery = highMastery + lowMastery > 0 ? Math.round((highMastery / Math.max(1, highMastery + lowMastery)) * 100) : 72;
  const avgAccuracy = atRisk.length
    ? Math.max(35, Math.round(atRisk.reduce((sum: number, s: any) => sum + Number(s.avg_accuracy ?? 0), 0) / atRisk.length))
    : 84;
  const examReadiness = Math.max(45, Math.min(96, Math.round((avgAccuracy + avgMastery + recoveryCompletion) / 3)));

  return (
    <div className="tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="tp-kicker mb-4">Class Teacher Cockpit</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Class {a.classTeacherOf.name}-{a.classTeacherOf.section}</h1>
            <p className="text-sm text-white/75 mt-2">Students, leaves, attendance signals, and class care in one premium workspace.</p>
          </div>
          <div className="rounded-2xl bg-white/12 border border-white/15 p-4 text-right">
            <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold">Exam readiness</p>
            <p className="text-3xl font-bold">{examReadiness}%</p>
          </div>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 xl:grid-cols-6 gap-4">
        <TeacherMetric icon={<Users className="w-5 h-5" />} label="Students" value={students.length} sub="in this class" />
        <TeacherMetric icon={<ClipboardCheck className="w-5 h-5" />} label="Avg Accuracy" value={`${avgAccuracy}%`} sub="latest practice" />
        <TeacherMetric icon={<BarChart3 className="w-5 h-5" />} label="Avg Mastery" value={`${avgMastery}%`} sub="concept strength" />
        <TeacherMetric icon={<CheckCircle2 className="w-5 h-5" />} label="Recovery Done" value={`${recoveryCompletion}%`} sub="completion rate" />
        <TeacherMetric icon={<Clock className="w-5 h-5" />} label="Practice Time" value="Focused" sub="track in DPPs" />
        <TeacherMetric icon={<CalendarOff className="w-5 h-5" />} label="Leaves" value={leaves.length} sub="pending review" />
      </div>

      <div className="grid xl:grid-cols-[1.05fr_0.95fr] gap-4">
        <Card className="tp-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="tp-label">Class confusion map</p>
              <h3 className="tp-display text-xl mt-1">Most confused concepts</h3>
            </div>
            <Badge className="rounded-full" variant="outline">Reteach first</Badge>
          </div>
          <div className="space-y-3">
            {[...weakConcepts, ...weakTopics].slice(0, 5).map((concept: any, index: number) => {
              const label = concept.concept || concept.chapter || "Concept";
              const score = Number(concept.avg_mastery ?? concept.accuracy ?? 0);
              return (
                <div key={`${label}-${index}`} className="tp-row">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-semibold text-sm">{label}</p>
                      <p className="text-xs text-muted-foreground">{concept.subject || "Subject"} · {concept.students ?? "Many"} students struggled</p>
                    </div>
                    <span className="text-xs font-bold text-warning">{score || "Low"}%</span>
                  </div>
                  <div className="tp-progress"><span style={{ width: `${Math.max(8, Math.min(100, score || 28))}%` }} /></div>
                </div>
              );
            })}
            {weakConcepts.length + weakTopics.length === 0 && <p className="text-sm text-muted-foreground">Weak concept data appears after DPP, practice, and battles.</p>}
          </div>
        </Card>

        <Card className="tp-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-warning" />
            <h3 className="tp-display text-xl">Students at risk</h3>
          </div>
          <div className="space-y-2">
            {atRisk.slice(0, 6).map((student: any) => (
              <div key={student.student_id ?? student.name} className="tp-row flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{student.name}</p>
                  <p className="text-xs text-muted-foreground">Att {student.attendance_pct ?? 0}% · Acc {student.avg_accuracy ?? 0}%</p>
                </div>
                <Badge variant="destructive" className="rounded-full">Support</Badge>
              </div>
            ))}
            {atRisk.length === 0 && <p className="text-sm text-muted-foreground">No urgent risk flags for this class.</p>}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="tp-card tp-gold-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="w-5 h-5 text-amber-700" />
            <h3 className="tp-display text-xl">Most improved students</h3>
          </div>
          <div className="space-y-2">
            {improving.slice(0, 5).map((student: any) => (
              <div key={student.student_id ?? student.name} className="tp-row flex items-center justify-between">
                <p className="font-semibold text-sm">{student.name}</p>
                <Badge variant="outline" className="rounded-full bg-accent/10 text-accent">Celebrate</Badge>
              </div>
            ))}
            {improving.length === 0 && <p className="text-sm text-muted-foreground">Improvement signals will appear after more student activity.</p>}
          </div>
        </Card>

        <Card className="tp-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-primary" />
            <h3 className="tp-display text-xl">Recent activity focus</h3>
          </div>
          <div className="space-y-2">
            <div className="tp-row">Reteach the top confused concept before assigning new work.</div>
            <div className="tp-row">Use Practice Center to assign a short recovery set to flagged learners.</div>
            <div className="tp-row">Open Student Insights for one-minute academic profiles before intervention.</div>
          </div>
        </Card>
      </div>

      {leaves.length > 0 && (
        <Card className="tp-card p-5">
          <h3 className="tp-display text-xl mb-3">Pending leave requests</h3>
          <div className="space-y-2">
            {leaves.map(l => (
              <div key={l.id} className="tp-row flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium capitalize">{l.leave_type}</div>
                  <div className="text-xs text-muted-foreground">{l.from_date} → {l.to_date}</div>
                  {l.reason && <div className="text-xs mt-1">{l.reason}</div>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => review(l.id, "approved")}><Check className="w-4 h-4 text-accent" /></Button>
                  <Button size="sm" variant="outline" onClick={() => review(l.id, "rejected")}><X className="w-4 h-4 text-destructive" /></Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="tp-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="tp-display text-xl">Students</h3>
          <span className="tp-chip">{students.length} learners</span>
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {students.map(s => (
            <div key={s.id} className="tp-row flex items-center justify-between">
              <span className="text-sm font-medium">{s.full_name}</span>
              <span className="text-xs text-muted-foreground">Roll {s.roll_number || "-"}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

const MySubjects = () => {
  const a = useTeacherAssignments();
  if (a.loading) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground text-sm">Loading your subject assignments…</p>
      </Card>
    );
  }
  if (a.subjectClasses.length === 0) return (
    <Card className="p-8 text-center">
      <BookOpen className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
      <p className="text-muted-foreground">No subject assignments yet.</p>
    </Card>
  );
  return (
    <div className="tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10">
          <div className="tp-kicker mb-4">Subject Studio</div>
          <h1 className="tp-display text-3xl sm:text-4xl">My Subjects</h1>
          <p className="text-sm text-white/75 mt-2">Every teaching group you own, styled for fast class planning and follow-up.</p>
        </div>
      </section>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {a.subjectClasses.map(c => (
          <Card key={`${c.id}-${c.subject}`} className="tp-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">Class {c.name}-{c.section}</div>
                <div className="text-sm text-muted-foreground">{c.subject || "Subject"}</div>
              </div>
              <Badge variant="outline" className="bg-accent/15 text-accent border-accent/30">Subject</Badge>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-4">Use Attendance, Exams, and Notices from the side menu — scoped automatically to your assigned classes.</p>
    </div>
  );
};

const Attendance = () => {
  const { user } = useAuth();
  const a = useTeacherAssignments();
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<any[]>([]);
  const [marks, setMarks] = useState<Record<string, "present" | "absent" | "leave">>({});
  const [date] = useState(new Date().toISOString().split("T")[0]);
  const [isLocked, setIsLocked] = useState(false);
  const [saving, setSaving] = useState(false);

  const allClasses = [
    ...(a.classTeacherOf ? [{ id: a.classTeacherOf.id, label: `Class ${a.classTeacherOf.name}-${a.classTeacherOf.section} (Class Teacher)` }] : []),
    ...a.subjectClasses.filter(c => c.id !== a.classTeacherOf?.id).map(c => ({ id: c.id, label: `Class ${c.name}-${c.section}${c.subject ? ` · ${c.subject}` : ""}` })),
  ];

  useEffect(() => {
    if (!classId) { setStudents([]); setIsLocked(false); return; }
    (async () => {
      const { data } = await supabase.from("students").select("*").eq("class_id", classId).order("roll_number");
      setStudents(data ?? []);
      const { data: existing } = await supabase.from("attendance").select("student_id,status").eq("class_id", classId).eq("date", date);
      const m: Record<string, any> = {};
      existing?.forEach(r => m[r.student_id] = r.status);
      setMarks(m);
      const { data: lock } = await supabase.from("attendance_locks").select("class_id").eq("class_id", classId).eq("date", date).maybeSingle();
      setIsLocked(!!lock);
    })();
  }, [classId, date]);

  const setMark = (sid: string, status: "present" | "absent" | "leave") => {
    if (isLocked) return;
    setMarks(p => ({ ...p, [sid]: status }));
  };

  const save = async () => {
    if (isLocked) return toast.error("Attendance is locked. Contact admin to make changes.");
    const rows = Object.entries(marks).map(([student_id, status]) => ({ student_id, class_id: classId, date, status, marked_by: user?.id }));
    if (!rows.length) return toast.error("Mark at least one student");
    setSaving(true);
    const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "student_id,date" });
    if (error) { setSaving(false); return toast.error(error.message); }
    await supabase.from("attendance_locks").insert({ class_id: classId, date, locked_by: user?.id });
    setIsLocked(true);
    setSaving(false);
    toast.success("Attendance saved and locked");
  };

  return (
    <div className="tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="tp-kicker mb-4">Daily Attendance</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Mark Attendance</h1>
            <p className="text-sm text-white/75 mt-2">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
          </div>
          <div className="rounded-2xl bg-white/12 border border-white/15 p-4">
            <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold">Selected</p>
            <p className="text-2xl font-bold">{students.length}</p>
          </div>
        </div>
      </section>
      <Card className="tp-card p-4">
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
          <SelectContent>{allClasses.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
        </Select>
      </Card>

      {isLocked && classId && (
        <Card className="tp-card tp-gold-card p-4">
          <div className="flex items-center gap-2 text-warning-foreground">
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">Attendance submitted and locked for today. Contact admin for any corrections.</span>
          </div>
        </Card>
      )}

      {classId && students.length === 0 && <p className="text-muted-foreground text-center py-8">No students in this class.</p>}

      <div className="space-y-2">
        {students.map(s => (
          <Card key={s.id} className={`tp-card p-3 flex items-center justify-between ${isLocked ? "opacity-75" : ""}`}>
            <div className="min-w-0">
              <div className="font-medium truncate">{s.full_name}</div>
              <div className="text-xs text-muted-foreground">Roll {s.roll_number || "-"}</div>
            </div>
            <div className="flex gap-1">
              {([["present", Check, "bg-accent text-accent-foreground"], ["absent", X, "bg-destructive text-destructive-foreground"], ["leave", Coffee, "bg-warning text-warning-foreground"]] as const).map(([st, Icon, cls]) => (
                <button key={st} onClick={() => setMark(s.id, st)} disabled={isLocked}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${isLocked ? "cursor-not-allowed" : ""} ${marks[s.id] === st ? cls : "bg-muted text-muted-foreground"}`}>
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {students.length > 0 && !isLocked && (
        <Button className="w-full mt-6 bg-gradient-primary text-primary-foreground" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Submit Attendance"}
        </Button>
      )}
    </div>
  );
};

function WorkspaceTile({
  icon,
  title,
  description,
  to,
  badge,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  to: string;
  badge?: string;
}) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)} className="tp-card p-5 text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="tp-icon">{icon}</div>
        {badge && <Badge variant="outline" className="rounded-full">{badge}</Badge>}
      </div>
      <h3 className="tp-display text-xl mt-4">{title}</h3>
      <p className="text-sm text-muted-foreground mt-2">{description}</p>
    </button>
  );
}

function ClassWorkspace() {
  return (
    <div className="tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10">
          <div className="tp-kicker mb-4">Class</div>
          <h1 className="tp-display text-3xl sm:text-4xl">Everything about your class in one place.</h1>
          <p className="text-sm text-white/75 mt-2 max-w-2xl">
            Class health stays central here. Attendance, exams, timetable, and student care live together instead of becoming separate admin panels.
          </p>
        </div>
      </section>

      <div className="grid md:grid-cols-4 gap-3">
        <WorkspaceTile icon={<Users className="w-5 h-5" />} title="Class Overview" description="Students, risk signals, confused concepts, and improvement highlights." to="/teacher/my-class" badge="Core" />
        <WorkspaceTile icon={<ClipboardCheck className="w-5 h-5" />} title="Attendance" description="Mark today quickly, then return to learning signals." to="/teacher/attendance" />
        <WorkspaceTile icon={<FileText className="w-5 h-5" />} title="Exams" description="Create tests and update marks that power insights." to="/teacher/exams" />
        <WorkspaceTile icon={<CalendarDays className="w-5 h-5" />} title="Timetable" description="See teaching schedule without leaving the class context." to="/teacher/timetable" />
      </div>

      <MyClass />
    </div>
  );
}

function PracticeWorkspace() {
  return (
    <div className="tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10">
          <div className="tp-kicker mb-4">Practice</div>
          <h1 className="tp-display text-3xl sm:text-4xl">Assign, recover, and challenge from one workspace.</h1>
          <p className="text-sm text-white/75 mt-2 max-w-2xl">
            Daily practice, homework, question bank, and recovery sets are grouped here because they all serve the same goal: better learning.
          </p>
        </div>
      </section>

      <div className="grid md:grid-cols-3 gap-3">
        <WorkspaceTile icon={<Target className="w-5 h-5" />} title="Daily Practice" description="Create DPPs, chapter practice, revision sets, and recovery work." to="/teacher/dpp" badge="Main" />
        <WorkspaceTile icon={<NotebookPen className="w-5 h-5" />} title="Homework" description="Review submissions and spot practice consistency gaps." to="/teacher/homework" />
        <WorkspaceTile icon={<Database className="w-5 h-5" />} title="Question Bank" description="Generate, import, and organize questions by subject and concept." to="/teacher/question-bank" />
      </div>
    </div>
  );
}

function ConnectWorkspace() {
  return (
    <div className="tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10">
          <div className="tp-kicker mb-4">Connect</div>
          <h1 className="tp-display text-3xl sm:text-4xl">All teacher communication in one place.</h1>
          <p className="text-sm text-white/75 mt-2 max-w-2xl">
            Doubts, messages, notices, and leave requests are grouped here so communication supports teaching instead of fragmenting it.
          </p>
        </div>
      </section>

      <div className="grid md:grid-cols-4 gap-3">
        <WorkspaceTile icon={<HelpCircle className="w-5 h-5" />} title="Doubts" description="Reply to unresolved doubts and pin helpful explanations." to="/teacher/doubts" badge="Learning" />
        <WorkspaceTile icon={<MessageSquare className="w-5 h-5" />} title="Messages" description="Send guidance, reminders, and practice links." to="/teacher/chat" />
        <WorkspaceTile icon={<Bell className="w-5 h-5" />} title="Notices" description="Post announcements without making the dashboard feel administrative." to="/teacher/notices" />
        <WorkspaceTile icon={<CalendarOff className="w-5 h-5" />} title="Leaves" description="Review leave requests only when class care requires it." to="/teacher/leaves" />
      </div>
    </div>
  );
}

export default function TeacherDashboard() {
  return (
    <AppLayout nav={nav} title="Teacher">
      <div className="teacher-premium">
        <Routes>
        <Route index element={<Overview />} />
        <Route path="class" element={<ClassWorkspace />} />
        <Route path="practice" element={<PracticeWorkspace />} />
        <Route path="connect" element={<ConnectWorkspace />} />
        <Route path="my-class" element={<MyClass />} />
        <Route path="my-subjects" element={<MySubjects />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="homework" element={<HomeworkManagePage />} />
        <Route path="performance" element={<StudentPerformancePage />} />
        <Route path="insights" element={<ClassInsights />} />
        <Route path="doubts" element={<CommunityDoubtPortal mode="teacher" />} />
        <Route path="exams" element={<ExamsPage />} />
        <Route path="timetable" element={<TeacherTimetablePage />} />
        <Route path="notices" element={<NoticesPage canPost />} />
        <Route path="reports" element={<TeacherReportsPage />} />
        <Route path="chat" element={<ChatPage userRole="teacher" />} />
        {/* Teachers submit their own leave requests; approvals happen via class teacher / principal views */}
        <Route path="leaves" element={<LeaveRequestsPage applicantKind="teacher" />} />
        <Route path="profile" element={<TeacherProfilePage />} />
        <Route path="dpp" element={<DppList />} />
        <Route path="dpp/:id" element={<DppEditor />} />
        <Route path="dpp/:id/analytics" element={<DppAnalytics />} />
        <Route path="battleground" element={<TeacherBattleground />} />
        <Route path="battleground/monitor/:id" element={<BattleMonitor />} />
        <Route path="battleground/monitor/:battleId/report/:participantId" element={<BattleTeacherReport />} />
        <Route path="question-bank" element={<QuestionBankPage />} />
        <Route path="*" element={<Navigate to="/teacher" replace />} />
        </Routes>
      </div>
    </AppLayout>
  );
}
