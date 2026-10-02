import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { PageKey } from "@/gurukul/nav";
import { PAGE_PATH, pathToPage } from "@/gurukul/nav";
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
import MistakeTypes from "@/gurukul/pages/MistakeTypes";
import Achievements from "@/gurukul/pages/Achievements";
import Premium from "@/gurukul/pages/Premium";
import MockTests from "@/gurukul/pages/MockTests";
import Profile from "@/gurukul/pages/Profile";
import { useScreenCaptureMistakes } from "@/hooks/useScreenCaptureMistakes";
import { ScreenCaptureMistakesCard } from "@/gurukul/components/ScreenCaptureMistakesCard";

/* Deep functional flows */
import PracticeSessionResult from "./student/PracticeSessionResult";
import MockAttempt from "./student/MockAttempt";
import MockResult from "./student/MockResult";
import Notifications from "@/gurukul/pages/Notifications";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLatestEffect } from "@/hooks/useLatestEffect";
import { useAcademicContext, useAcademicLive } from "@/academic";
import { studentShellReady } from "@/academic/services/assertStudentContext";
import { hasPracticeAccuracy, practiceAccuracyFromSnapshot } from "@/lib/learningMetrics";
import { readStudentAcademicSnapshot, type AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";

export default function StudentDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const liveVersion = useAcademicLive(["xp", "profile", "achievements"]);
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
    streak?: number;
    /** PRACTICE accuracy; null when nothing has been attempted. */
    practiceAccuracy?: number | null;
  }>({});
  // One AcademicContext for Home + Practice — never re-resolve identity for XP alone.
  const {
    ready: academicReady,
    ctx,
    studentId,
    schoolId,
    classId,
    identity,
  } = useAcademicContext();
  const schoolKind = identity?.schoolKind ?? null;
  const examName = identity?.examName ?? null;
  const examCode = identity?.examCode ?? null;
  const examId = identity?.examId ?? null;
  /** Stage 1 tap + Stage 2 watch — mount once in the shell so listeners stay alive. */
  const screenCapture = useScreenCaptureMistakes({
    userId: user?.id,
    examId,
    schoolId,
  });
  /** The exam an individual account prepares for — its scope (no class/board). */
  const scopeLabel = examName || examCode || null;
  const [progressionLoaded, setProgressionLoaded] = useState(false);
  /** Live/focus/poll refreshes must not wipe XP chrome back to placeholders. */
  const progressionLoadedRef = useRef(false);
  // loadProfile is re-invoked on every live-poll tick and XP-update event;
  // guard against an older in-flight call overwriting state after a newer
  // one has already resolved (e.g. two rapid XP gains resolving out of order).
  const beginRun = useLatestEffect();

  const loadProfile = useCallback(async () => {
    // A school account is redirected below; its effects still run first, so
    // the loader itself must not read anything for one.
    if (!user || !academicReady || !ctx || schoolKind === "school") return;
    const isStale = beginRun();
    // Do NOT flip progressionLoaded false on live refresh — that collapses shellReady
    // and remounts the whole student panel after it already rendered.
    const { data: s, error: studentErr } = await supabase
      .from("students_current")
      .select("full_name, roll_number")
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
    try {
      const { ProgressionService } = await import("@/academic");
      const { progressionLevelProgress } = await import("@/academic/services/progressionMath");
      prog = await ProgressionService.getSnapshot(ctx, user.id);
      if (prog) {
        const derived = progressionLevelProgress(prog.xp, prog.level);
        prog = {
          ...prog,
          xp_into_level: prog.xp_into_level ?? derived.xpIntoLevel,
          xp_to_next_level: prog.xp_to_next_level ?? derived.xpToNextLevel,
          level_progress_pct: prog.level_progress_pct ?? derived.levelProgressPct,
        };
      }
    } catch (e) {
      console.warn("progression snapshot:", e instanceof Error ? e.message : e);
    }

    // Accuracy SSOT: rpc_student_academic_snapshot.exam_readiness only.
    // Never average chart subjects (dual path that showed 100% with XP 0).
    // Through the shared reader, not a call of its own: this shell is mounted
    // on every student route while Analysis and the Practice hub each want
    // the same snapshot, and it is the heaviest read
    // the student panel makes (KNOWN_ISSUES 74).
    const snapRead = await readStudentAcademicSnapshot().then(
      (data) => ({ data, error: null as { message: string } | null }),
      (error: { message: string }) => ({ data: null as AcademicSnapshot | null, error }),
    );
    const snapError = snapRead.error;
    if (snapError) {
      console.warn("student dashboard snapshot:", snapError.message);
      // Failed reads clear/omit those fields — do not claim a cache we do not keep.
      toast.error("Could not load your latest stats.");
    }

    const snapshot = snapRead.data;

    // PRACTICE accuracy, and null rather than 0 when there is nothing to
    // compute it from — ruling 8. `hasPracticeAccuracy` is what separates "no
    // attempts" from "attempted and got none right", which both used to arrive
    // at every screen as a bare 0.
    const practiceAccuracy = hasPracticeAccuracy(snapshot)
      ? practiceAccuracyFromSnapshot(snapshot)
      : null;

    const fullName = s?.full_name?.trim() || user.email?.split("@")[0] || "Student";
    const parts = fullName.split(/\s+/);
    const initials = (parts[0]?.[0] || "S") + (parts[1]?.[0] || parts[0]?.[1] || "");

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

    if (isStale()) return;

    setProfile({
      name: fullName,
      firstName: parts[0] || fullName,
      // Class label comes from AcademicContext identity (shared with Practice).
      avatar: initials.toUpperCase(),
      xp,
      level,
      xpToNext,
      xpIntoLevel,
      levelProgressPct,
      league: prog?.league?.label ?? prog?.league?.code ?? "",
      streak: prog?.study_streak ?? 0,
      practiceAccuracy,
    });
    progressionLoadedRef.current = true;
    setProgressionLoaded(true);
  }, [user, academicReady, ctx, schoolKind, beginRun]);

  useEffect(() => {
    if (!academicReady || !ctx) {
      progressionLoadedRef.current = false;
      setProgressionLoaded(false);
      return;
    }
    void loadProfile();
  }, [loadProfile, liveVersion, academicReady, ctx]);

  useEffect(() => {
    const onXp = () => { void loadProfile(); };
    window.addEventListener("student-xp-updated", onXp);
    return () => window.removeEventListener("student-xp-updated", onXp);
  }, [loadProfile]);

  const shellReady = studentShellReady({ academicReady, progressionLoaded });

  const academicIdentity = useMemo(
    () => ({
      studentId,
      schoolId,
      classId,
      schoolKind,
      examId: identity?.examId ?? null,
      examCode: identity?.examCode ?? null,
      examName: identity?.examName ?? null,
    }),
    [studentId, schoolId, classId, schoolKind, identity?.examId, identity?.examCode, identity?.examName],
  );

  /** `/student/mock/<id>` — a CUET mock paper, and not its result. */
  const isSittingAMock = /^\/student\/mock\/[^/]+\/?$/.test(location.pathname);


  const mergedStudent = useMemo(
    () => ({
      ...EMPTY_STUDENT,
      // `undefined` means the loader has not filled this key yet, so the
      // EMPTY_STUDENT default stands. `null` is an ANSWER — "there is no
      // practice accuracy" — and must survive the merge. Stripping it here is
      // what turned every absent metric into a 0 before any screen saw it.
      ...Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== undefined && v !== "")),
      // Scope SSOT: the exam name.
      ...(scopeLabel ? { class: scopeLabel } : {}),
    }),
    [profile, scopeLabel],
  );

  // A student of a SCHOOL: the live app has no school side (2026-10-01; the
  // organisation work is kept on the `organisation` branch). Only a known
  // kind decides — while it loads (`null`) the individual panel renders, as
  // it always has, rather than flashing this page at an exam account.
  if (schoolKind === "school") {
    return <Navigate to="/unauthorized" replace state={{ reason: "organisation" }} />;
  }

  // A student sitting a mock gets NO app chrome. Every other student route
  // renders inside <Layout>; this one deliberately does not, because the
  // sidebar, the bottom nav, the notification bell and the avatar menu are
  // four ways to leave a paper by accident and the attempt cannot be reopened.
  if (isSittingAMock) {
    return (
      <div className="gurukul-student min-h-screen p-4 sm:p-6">
        <GurukulStudentProvider value={mergedStudent} identity={academicIdentity} shellReady={shellReady}>
          <Routes>
            <Route path="mock/:id" element={<MockAttempt />} />
          </Routes>
        </GurukulStudentProvider>
      </div>
    );
  }

  return (
    <div className="gurukul-student min-h-screen">
      <GurukulStudentProvider value={mergedStudent} identity={academicIdentity} shellReady={shellReady}>
      <Layout page={page} setPage={setPage} profile={{ ...profile, ...(scopeLabel ? { class: scopeLabel } : {}) }} progressionReady={shellReady}>
        <Routes>
          {/* Design student panel */}
          <Route index element={<Dashboard setPage={setPage} />} />
          <Route path="practice" element={<Practice setPage={setPage} />} />
          <Route path="aicoach" element={<AICoach setPage={setPage} />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="analytics" element={<Navigate to="/student/analysis" replace />} />
          <Route path="report" element={<Navigate to="/student/analysis" replace />} />
          <Route path="recovery" element={<Recovery />} />
          <Route path="revision" element={<Revision />} />
          <Route path="plans" element={<Navigate to="/student/revision" replace />} />
          <Route path="mistakes" element={<MistakeBook setPage={setPage} />} />
          <Route path="mistakes/types" element={<MistakeTypes />} />
          <Route path="achievements" element={<Achievements />} />
          <Route path="premium" element={<Premium />} />
          <Route path="mocks" element={<MockTests />} />
          <Route path="mock/:id/result" element={<MockResult />} />
          <Route
            path="profile"
            element={
              <Profile
                screenCaptureSlot={
                  screenCapture.available ? (
                    <ScreenCaptureMistakesCard api={screenCapture} />
                  ) : null
                }
              />
            }
          />
          {/* Deep functional routes */}
          <Route path="practice/session/:id/result" element={<PracticeSessionResult />} />
          <Route path="notifications" element={<Notifications />} />
          {/* Every other address — the school screens included, which are not in
              this app — lands on Home. */}
          <Route path="*" element={<Navigate to="/student" replace />} />
        </Routes>
      </Layout>
      </GurukulStudentProvider>
    </div>
  );
}
