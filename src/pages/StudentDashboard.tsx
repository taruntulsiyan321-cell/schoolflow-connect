import { useCallback, useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import type { PageKey } from "@/gurukul/nav";
import { PAGE_PATH, pathToPage, legacyClassesRedirectPath } from "@/gurukul/nav";
import Layout from "@/gurukul/components/Layout";
import { GurukulStudentProvider } from "@/gurukul/StudentContext";
import { EMPTY_STUDENT } from "@/gurukul/emptyStudent";
import "@/gurukul/theme.css";

import Dashboard from "@/gurukul/pages/Dashboard";
import Practice from "@/gurukul/pages/Practice";
import AICoach from "@/gurukul/pages/AICoach";
import Analysis from "@/gurukul/pages/Analysis";
import Recovery from "@/gurukul/pages/Recovery";
import Revision from "@/gurukul/pages/Revision";
import MistakeBook from "@/gurukul/pages/MistakeBook";
import BattlegroundDesign from "@/gurukul/pages/Battleground";
import Leaderboard from "@/gurukul/pages/Leaderboard";
import Achievements from "@/gurukul/pages/Achievements";
import Resources from "@/gurukul/pages/Resources";
import DoubtPortal from "@/gurukul/pages/DoubtPortal";
import Assignments from "@/gurukul/pages/Assignments";
import Attendance from "@/gurukul/pages/Attendance";
import Profile from "@/gurukul/pages/Profile";
import Timetable from "@/gurukul/pages/Timetable";
import Calendar from "@/gurukul/pages/Calendar";
import Tests from "@/gurukul/pages/Tests";
import LearningHub from "@/gurukul/pages/LearningHub";
import ClassHub from "@/gurukul/pages/ClassHub";

/* Keep deep functional flows from the live app */
import RecoverySession from "./student/RecoverySession";
import RecoverySessionResult from "./student/RecoverySessionResult";
import RecoveryCompletionReportPage from "./student/RecoveryCompletionReportPage";
import Class12MathPractice from "./student/Class12MathPractice";
import Class12MathSession from "./student/Class12MathSession";
import Class12AiSession from "./student/Class12AiSession";
import PracticeSessionResult from "./student/PracticeSessionResult";
import DppAttempt from "./student/DppAttempt";
import DppResult from "./student/DppResult";
import { BattleRoom as LiveBattleRoom } from "./student/Battleground";
import BattleReportPage from "./student/BattleReportPage";
import ChatPage from "./shared/ChatPage";
import NoticesPage from "./shared/NoticesPage";
import Notifications from "@/gurukul/pages/Notifications";
import MyFeesPage from "./shared/MyFeesPage";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, useAcademicLive } from "@/academic";
import { studentShellReady } from "@/academic/services/assertStudentContext";

export default function StudentDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const liveVersion = useAcademicLive(["xp", "battle", "profile", "achievements", "homework", "test", "marks"]);
  const page = useMemo(() => pathToPage(location.pathname), [location.pathname]);
  const setPage = (p: PageKey) => navigate(PAGE_PATH[p]);

  const [profile, setProfile] = useState<{
    name?: string;
    firstName?: string;
    class?: string;
    avatar?: string;
    xp?: number;
    level?: number;
    xpToNext?: number;
    xpIntoLevel?: number;
    levelProgressPct?: number;
    league?: string;
    reputation?: number;
    streak?: number;
    rank?: number;
    accuracy?: number;
    attendance?: number;
    sessionsThisWeek?: number;
    totalStudents?: number;
  }>({});
  const { ready: academicReady } = useAcademicContext();
  const [progressionLoaded, setProgressionLoaded] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    setProgressionLoaded(false);
    const { data: s, error: studentErr } = await supabase
      .from("students")
      .select("full_name, roll_number, classes(name, section)")
      .eq("user_id", user.id)
      .maybeSingle();
    if (studentErr) {
      console.warn("student profile:", studentErr.message);
    }

    let prog: {
      xp: number;
      level: number;
      xp_to_next_level: number;
      xp_into_level: number;
      level_progress_pct: number;
      study_streak: number;
      reputation: number;
      league: { label?: string; code?: string } | null;
    } | null = null;
    let rank: number | undefined;
    let totalStudents = 0;
    try {
      const { ProgressionService, resolveStudentServiceContext } = await import("@/academic");
      const { progressionLevelProgress } = await import("@/academic/services/progressionMath");
      const ctx = await resolveStudentServiceContext();
      prog = await ProgressionService.getSnapshot(ctx, user.id);
      // Ensure level bar fields exist even if RPC omits them
      if (prog) {
        const derived = progressionLevelProgress(prog.xp, prog.level);
        prog = {
          ...prog,
          xp_into_level: prog.xp_into_level ?? derived.xpIntoLevel,
          xp_to_next_level: prog.xp_to_next_level ?? derived.xpToNextLevel,
          level_progress_pct: prog.level_progress_pct ?? derived.levelProgressPct,
        };
      }
      try {
        const lb = await ProgressionService.leaderboard(ctx, {
          scope: "class",
          period: "lifetime",
          metric: "xp",
          limit: 200,
        });
        totalStudents = lb.rows.length;
        const i = lb.rows.findIndex((r) => r.user_id === user.id);
        if (i >= 0) rank = i + 1;
      } catch {
        /* rank stays 0 / unavailable */
      }
    } catch (e) {
      console.warn("progression snapshot:", e instanceof Error ? e.message : e);
    }

    const [{ data: snap }, { data: charts }] = await Promise.all([
      supabase.rpc("rpc_student_academic_snapshot"),
      supabase.rpc("rpc_student_performance_charts"),
    ]);

    type Snap = {
      exam_readiness?: { accuracy_pct?: number; attendance_pct?: number };
      activity_heatmap?: { date: string; dpp: number; homework: number; battles: number; self_practice?: number; minutes: number }[];
    };
    type ChartRow = { subjects?: { accuracy: number }[]; weekly_activity?: { date: string; total: number }[] };

    const snapshot = snap as Snap | null;
    const chartData = charts as ChartRow | null;

    const chartSubjects = chartData?.subjects ?? [];
    const accuracyFromCharts = chartSubjects.length
      ? Math.round(chartSubjects.reduce((a, sub) => a + sub.accuracy, 0) / chartSubjects.length)
      : 0;
    const accuracy =
      snapshot?.exam_readiness?.accuracy_pct != null && snapshot.exam_readiness.accuracy_pct > 0
        ? Math.round(snapshot.exam_readiness.accuracy_pct)
        : accuracyFromCharts;

    const attendance =
      snapshot?.exam_readiness?.attendance_pct != null
        ? Math.round(snapshot.exam_readiness.attendance_pct)
        : 0;

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);

    const heatmapSessions = (snapshot?.activity_heatmap ?? []).filter((row) => {
      const d = new Date(row.date);
      if (d < weekAgo) return false;
      return row.minutes > 0 || row.dpp > 0 || row.battles > 0 || (row.self_practice ?? 0) > 0;
    }).length;

    const weeklySessions = (chartData?.weekly_activity ?? []).slice(-7).filter((row) => row.total > 0).length;
    const sessionsThisWeek = heatmapSessions > 0 ? heatmapSessions : weeklySessions;

    const fullName = s?.full_name?.trim() || user.email?.split("@")[0] || "Student";
    const parts = fullName.split(/\s+/);
    const initials = (parts[0]?.[0] || "S") + (parts[1]?.[0] || parts[0]?.[1] || "");
    const rawClasses = s?.classes as
      | { name?: string; section?: string }
      | { name?: string; section?: string }[]
      | null
      | undefined;
    const clsObj = Array.isArray(rawClasses) ? rawClasses[0] : rawClasses;
    const cls = clsObj
      ? `${clsObj.name ?? ""}-${clsObj.section ?? ""}`.replace(/^-|-$/g, "") || undefined
      : undefined;

    const xp = prog?.xp ?? 0;
    const level = prog?.level ?? 1;
    let xpToNext = prog?.xp_to_next_level;
    let xpIntoLevel = prog?.xp_into_level;
    let levelProgressPct = prog?.level_progress_pct;
    if (xpToNext == null || xpIntoLevel == null || levelProgressPct == null) {
      const { progressionLevelProgress } = await import("@/academic/services/progressionMath");
      const derived = progressionLevelProgress(xp, level);
      xpToNext = xpToNext ?? derived.xpToNextLevel;
      xpIntoLevel = xpIntoLevel ?? derived.xpIntoLevel;
      levelProgressPct = levelProgressPct ?? derived.levelProgressPct;
    }

    setProfile({
      name: fullName,
      firstName: parts[0] || fullName,
      class: cls,
      avatar: initials.toUpperCase(),
      xp,
      level,
      xpToNext,
      xpIntoLevel,
      levelProgressPct,
      league: prog?.league?.label ?? prog?.league?.code ?? "",
      reputation: prog?.reputation ?? 0,
      streak: prog?.study_streak ?? 0,
      rank: rank ?? 0,
      accuracy,
      attendance,
      sessionsThisWeek,
      totalStudents,
    });
    setProgressionLoaded(true);
  }, [user]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile, liveVersion]);

  useEffect(() => {
    const onXp = () => { void loadProfile(); };
    window.addEventListener("student-xp-updated", onXp);
    return () => window.removeEventListener("student-xp-updated", onXp);
  }, [loadProfile]);

  const shellReady = studentShellReady({ academicReady, progressionLoaded });

  const mergedStudent = useMemo(
    () => ({
      ...EMPTY_STUDENT,
      ...Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== undefined && v !== null && v !== "")),
    }),
    [profile],
  );

  return (
    <div className="gurukul-student dark min-h-screen">
      <GurukulStudentProvider value={mergedStudent} shellReady={shellReady}>
      <Layout page={page} setPage={setPage} profile={profile} progressionReady={shellReady}>
        <Routes>
          {/* Design student panel */}
          <Route index element={<Dashboard setPage={setPage} />} />
          <Route path="practice" element={<Practice setPage={setPage} />} />
          <Route path="aicoach" element={<AICoach setPage={setPage} />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="analytics" element={<Navigate to="/student/analysis" replace />} />
          <Route path="report" element={<Navigate to="/student/analysis" replace />} />
          <Route path="recovery" element={<Recovery setPage={setPage} />} />
          <Route path="revision" element={<Revision setPage={setPage} />} />
          <Route path="plans" element={<Navigate to="/student/revision" replace />} />
          <Route path="mistakes" element={<MistakeBook setPage={setPage} />} />
          <Route path="battleground/battle/:id" element={<LiveBattleRoom />} />
          <Route path="battleground/report/:participantId" element={<BattleReportPage />} />
          {/* Legacy arena tabs — design Battleground is canonical (create/progress live in-page). */}
          <Route path="battleground/create" element={<Navigate to="/student/battleground" replace />} />
          <Route path="battleground/progress" element={<Navigate to="/student/battleground" replace />} />
          <Route path="battleground/stats" element={<Navigate to="/student/battleground" replace />} />
          <Route path="battleground/achievements" element={<Navigate to="/student/achievements" replace />} />
          <Route path="battleground/leaderboard" element={<Navigate to="/student/leaderboard" replace />} />
          <Route path="battleground" element={<BattlegroundDesign setPage={setPage} />} />
          <Route path="battleground-design" element={<Navigate to="/student/battleground" replace />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="achievements" element={<Achievements />} />
          <Route path="resources" element={<Resources />} />
          <Route path="doubts" element={<DoubtPortal />} />
          <Route path="homework" element={<Assignments />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="profile" element={<Profile setPage={setPage} />} />
          <Route path="timetable" element={<Timetable />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="tests" element={<Tests />} />
          <Route path="learning" element={<LearningHub setPage={setPage} />} />
          <Route path="class" element={<ClassHub setPage={setPage} />} />

          {/* Legacy / deep functional routes */}
          <Route path="recovery/:id/complete" element={<RecoveryCompletionReportPage />} />
          <Route path="recovery/:id/result" element={<RecoverySessionResult />} />
          <Route path="recovery/:id" element={<RecoverySession />} />
          <Route path="practice/math12" element={<Class12MathPractice />} />
          <Route path="practice/math12/session" element={<Class12MathSession />} />
          <Route path="practice/ai/session" element={<Class12AiSession />} />
          <Route path="practice/session/:id/result" element={<PracticeSessionResult />} />
          <Route path="dpp" element={<Navigate to="/student/tests" replace />} />
          <Route path="dpp/:id/attempt" element={<DppAttempt />} />
          <Route path="dpp/:id/result" element={<DppResult />} />
          <Route path="chat" element={<ChatPage userRole="student" />} />
          <Route path="notices" element={<NoticesPage viewerRole="student" />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="fees" element={<MyFeesPage />} />
          <Route
            path="classes"
            element={<Navigate to={legacyClassesRedirectPath(location.hash)} replace />}
          />
          <Route path="*" element={<Navigate to="/student" replace />} />
        </Routes>
      </Layout>
      </GurukulStudentProvider>
    </div>
  );
}
