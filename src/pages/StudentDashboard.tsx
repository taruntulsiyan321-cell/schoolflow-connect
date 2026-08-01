import { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import type { PageKey } from "@/gurukul/data/mock";
import { PAGE_PATH, pathToPage } from "@/gurukul/nav";
import Layout from "@/gurukul/components/Layout";
import { GurukulStudentProvider } from "@/gurukul/StudentContext";
import { student as mockStudent } from "@/gurukul/data/mock";
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
import Class12MathSession from "./student/Class12MathSession";
import Class12AiSession from "./student/Class12AiSession";
import PracticeSessionResult from "./student/PracticeSessionResult";
import DppAttempt from "./student/DppAttempt";
import DppResult from "./student/DppResult";
import { BattleRoom as LiveBattleRoom } from "./student/Battleground";
import BattleReportPage from "./student/BattleReportPage";
import ChatPage from "./shared/ChatPage";
import NoticesPage from "./shared/NoticesPage";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export default function StudentDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const page = useMemo(() => pathToPage(location.pathname), [location.pathname]);
  const setPage = (p: PageKey) => navigate(PAGE_PATH[p]);

  const [profile, setProfile] = useState<{
    name?: string;
    firstName?: string;
    class?: string;
    avatar?: string;
    xp?: number;
    level?: number;
    streak?: number;
    rank?: number;
  }>({});

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: s } = await supabase
        .from("students")
        .select("full_name, roll_number, classes(name, section)")
        .eq("user_id", user.id)
        .maybeSingle();

      const { data: x } = await supabase
        .from("student_xp")
        .select("xp, level, current_streak")
        .eq("user_id", user.id)
        .maybeSingle();

      let rank: number | undefined;
      const { data: lb } = await supabase.rpc("rpc_leaderboard", {
        _scope: "class",
        _category: "xp",
        _subject: undefined,
        _limit: 200,
      });
      if (Array.isArray(lb)) {
        const i = lb.findIndex((r: { user_id?: string }) => r.user_id === user.id);
        if (i >= 0) rank = i + 1;
      }

      const fullName = s?.full_name?.trim() || user.email?.split("@")[0] || "Student";
      const parts = fullName.split(/\s+/);
      const initials = (parts[0]?.[0] || "S") + (parts[1]?.[0] || parts[0]?.[1] || "");
      const cls = s?.classes
        ? `${(s.classes as { name?: string; section?: string }).name}-${(s.classes as { name?: string; section?: string }).section}`
        : undefined;

      setProfile({
        name: fullName,
        firstName: parts[0] || fullName,
        class: cls,
        avatar: initials.toUpperCase(),
        xp: x?.xp,
        level: x?.level,
        streak: x?.current_streak,
        rank,
      });
    })();
  }, [user]);

  const mergedStudent = useMemo(
    () => ({
      ...mockStudent,
      ...Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== undefined && v !== null && v !== "")),
    }),
    [profile],
  );

  return (
    <div className="gurukul-student dark min-h-screen">
      <GurukulStudentProvider value={mergedStudent}>
      <Layout page={page} setPage={setPage} profile={profile}>
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
          <Route path="practice/math12" element={<Navigate to="/student/practice" replace />} />
          <Route path="practice/math12/session" element={<Class12MathSession />} />
          <Route path="practice/ai/session" element={<Class12AiSession />} />
          <Route path="practice/session/:id/result" element={<PracticeSessionResult />} />
          <Route path="dpp/:id/attempt" element={<DppAttempt />} />
          <Route path="dpp/:id/result" element={<DppResult />} />
          <Route path="chat" element={<ChatPage userRole="student" />} />
          <Route path="notices" element={<NoticesPage viewerRole="student" />} />
          <Route path="classes" element={<Navigate to="/student/class" replace />} />
          <Route path="*" element={<Navigate to="/student" replace />} />
        </Routes>
      </Layout>
      </GurukulStudentProvider>
    </div>
  );
}
