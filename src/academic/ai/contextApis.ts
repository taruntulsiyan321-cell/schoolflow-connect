/**
 * Academic Engine AI Context APIs — versioned, purpose-bound projections.
 * No raw table dumps. No demo data. LLM must consume these, not invent numbers.
 */

import type { ServiceContext } from "../services/context";
import { AttendanceService } from "../services/attendanceService";
import { HomeworkService } from "../services/homeworkService";
import { MarksService } from "../services/marksService";
import { AcademicProfileService } from "../services/academicProfileService";
import { buildStudentAiSummary } from "./dataLayer";
import { toRepoContext } from "../services/context";
import { getClient, schoolIdOf } from "../repository/base";
import {
  buildStudentEducationalIntelligence,
  type StudentEducationalIntelligence,
} from "../eie";
import { assertMayAccessStudent } from "../services/parentAccess";

export interface ProjectionMeta {
  source_as_of: string | null;
  data_version: string;
  completeness: number;
}

export interface AttendanceQueryProjection extends ProjectionMeta {
  projection: "StudentAttendanceQuery";
  version: 1;
  studentId: string;
  schoolId: string;
  present: number;
  absent: number;
  late: number;
  leave: number;
  half_day: number;
  total_marked: number;
  attendance_pct: number;
  recent: { date: string; status: string }[];
}

export interface HomeworkDueProjection extends ProjectionMeta {
  projection: "StudentHomeworkDue";
  version: 1;
  studentId: string;
  schoolId: string;
  due_soon: {
    id: string;
    title: string;
    subject: string;
    due_date: string | null;
    due_time: string | null;
    display_status: string;
  }[];
  pending_count: number;
  overdue_count: number;
}

export interface MarksSummaryProjection extends ProjectionMeta {
  projection: "StudentMarksSummary";
  version: 1;
  studentId: string;
  schoolId: string;
  exams_count: number;
  average_pct: number | null;
  subjects: { subject: string; average_pct: number; count: number }[];
  recent: { examId: string; subject: string; marksObtained: number; maxMarks: number; pct: number }[];
}

export interface TimetableTodayProjection extends ProjectionMeta {
  projection: "StudentTimetableToday";
  version: 1;
  studentId: string;
  schoolId: string;
  classId: string | null;
  day_key: string;
  periods: { period: string; subject: string }[];
  has_timetable: boolean;
}

export interface ParentChildSummaryProjection extends ProjectionMeta {
  projection: "ParentChildSummary";
  version: 1;
  studentId: string;
  schoolId: string;
  attendance_pct: number;
  homework_completion_pct: number;
  tests_avg_pct: number;
  exams_avg_pct: number;
  weak_topics: string[];
  strong_topics: string[];
}

function meta(sourceAsOf: string | null, versionSeed: string, completeness: number): ProjectionMeta {
  return {
    source_as_of: sourceAsOf,
    data_version: versionSeed,
    completeness,
  };
}

function weekdayKey(d = new Date()): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] ?? "Mon";
}

export async function projectAttendanceQuery(
  ctx: ServiceContext,
  studentId: string,
): Promise<AttendanceQueryProjection> {
  await assertMayAccessStudent(ctx, studentId);
  const rows = await AttendanceService.listForStudent(ctx, studentId, { limit: 120 });
  const counts = { present: 0, absent: 0, late: 0, leave: 0, half_day: 0 };
  for (const r of rows) {
    if (r.status in counts) counts[r.status as keyof typeof counts] += 1;
  }
  const total = rows.length;
  const attendance_pct = total
    ? Math.round(((counts.present + counts.late * 0.5 + counts.half_day * 0.5) / total) * 1000) / 10
    : 0;
  const latest = rows[0]?.date ?? null;
  return {
    projection: "StudentAttendanceQuery",
    version: 1,
    studentId,
    schoolId: ctx.schoolId,
    ...counts,
    total_marked: total,
    attendance_pct,
    recent: rows.slice(0, 14).map((r) => ({ date: r.date, status: r.status })),
    ...meta(latest, `att:${studentId}:${total}:${latest ?? "none"}`, total > 0 ? 1 : 0),
  };
}

export async function projectHomeworkDue(
  ctx: ServiceContext,
  studentId: string,
): Promise<HomeworkDueProjection> {
  await assertMayAccessStudent(ctx, studentId);
  const rows = await HomeworkService.listForStudent(ctx, studentId);
  const pendingStatuses = new Set(["pending", "not_submitted", "assigned", "returned"]);
  const due_soon = rows
    .filter((r) => {
      const st = r.displayStatus.toLowerCase();
      return pendingStatuses.has(st) || st.includes("pending") || st.includes("due") || !r.submission;
    })
    .slice(0, 20)
    .map((r) => ({
      id: r.homework.id,
      title: r.homework.title,
      subject: r.homework.subject,
      due_date: r.homework.dueDate,
      due_time: r.homework.dueTime,
      display_status: r.displayStatus,
    }));

  const overdue_count = rows.filter((r) => r.displayStatus.toLowerCase().includes("overdue") || r.displayStatus.toLowerCase().includes("late")).length;
  const latestDue = due_soon.map((d) => d.due_date).filter(Boolean).sort().at(-1) ?? null;

  return {
    projection: "StudentHomeworkDue",
    version: 1,
    studentId,
    schoolId: ctx.schoolId,
    due_soon,
    pending_count: due_soon.length,
    overdue_count,
    ...meta(
      latestDue,
      `hw:${studentId}:${rows.length}:${due_soon.length}`,
      rows.length > 0 ? 1 : 0.2,
    ),
  };
}

export async function projectMarksSummary(
  ctx: ServiceContext,
  studentId: string,
): Promise<MarksSummaryProjection> {
  await assertMayAccessStudent(ctx, studentId);
  const marks = await MarksService.listForStudent(ctx, studentId, { limit: 100 });
  const repo = toRepoContext(ctx);
  const examIds = [...new Set(marks.map((m) => m.examId))];
  const examMap = new Map<string, { subject: string; maxMarks: number }>();
  if (examIds.length) {
    const { data: exams, error } = await getClient(repo)
      .from("exams")
      .select("id, subject, max_marks")
      .eq("school_id", schoolIdOf(repo))
      .in("id", examIds);
    if (!error) {
      for (const e of exams ?? []) {
        examMap.set(String(e.id), {
          subject: String(e.subject ?? ""),
          maxMarks: Number(e.max_marks) || 100,
        });
      }
    }
  }

  const bySubject = new Map<string, { sum: number; count: number }>();
  const recent: MarksSummaryProjection["recent"] = [];

  for (const m of marks) {
    const exam = examMap.get(m.examId);
    if (!exam) continue;
    const max = exam.maxMarks > 0 ? exam.maxMarks : 100;
    const pct = Math.round((m.marksObtained / max) * 1000) / 10;
    const cur = bySubject.get(exam.subject) ?? { sum: 0, count: 0 };
    cur.sum += pct;
    cur.count += 1;
    bySubject.set(exam.subject, cur);
    if (recent.length < 10) {
      recent.push({
        examId: m.examId,
        subject: exam.subject,
        marksObtained: m.marksObtained,
        maxMarks: max,
        pct,
      });
    }
  }

  const subjects = [...bySubject.entries()].map(([subject, v]) => ({
    subject,
    average_pct: Math.round((v.sum / v.count) * 10) / 10,
    count: v.count,
  }));
  const average_pct = subjects.length
    ? Math.round((subjects.reduce((s, x) => s + x.average_pct, 0) / subjects.length) * 10) / 10
    : null;

  return {
    projection: "StudentMarksSummary",
    version: 1,
    studentId,
    schoolId: ctx.schoolId,
    exams_count: recent.length ? marks.filter((m) => examMap.has(m.examId)).length : 0,
    average_pct,
    subjects,
    recent,
    ...meta(
      null,
      `marks:${studentId}:${marks.length}:${average_pct ?? "na"}`,
      marks.length > 0 ? 1 : 0,
    ),
  };
}

export async function projectTimetableToday(
  ctx: ServiceContext,
  studentId: string,
  now = new Date(),
): Promise<TimetableTodayProjection> {
  await assertMayAccessStudent(ctx, studentId);
  const repo = toRepoContext(ctx);
  const schoolId = schoolIdOf(repo);
  const { data: student, error } = await getClient(repo)
    .from("students")
    .select("id, class_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error || !student?.class_id) {
    return {
      projection: "StudentTimetableToday",
      version: 1,
      studentId,
      schoolId: ctx.schoolId,
      classId: null,
      day_key: weekdayKey(now),
      periods: [],
      has_timetable: false,
      ...meta(null, `tt:${studentId}:none`, 0),
    };
  }

  const { data: tt } = await getClient(repo)
    .from("class_timetables")
    .select("grid, updated_at")
    .eq("class_id", student.class_id)
    .maybeSingle();

  const day = weekdayKey(now);
  const grid = (tt?.grid ?? {}) as Record<string, string>;
  const periods = Object.entries(grid)
    .filter(([k, v]) => k.startsWith(`${day}-`) && String(v ?? "").trim())
    .map(([k, v]) => ({
      period: k.slice(day.length + 1),
      subject: String(v).trim(),
    }));

  return {
    projection: "StudentTimetableToday",
    version: 1,
    studentId,
    schoolId: ctx.schoolId,
    classId: student.class_id,
    day_key: day,
    periods,
    has_timetable: periods.length > 0,
    ...meta(
      tt?.updated_at ? String(tt.updated_at) : null,
      `tt:${student.class_id}:${day}:${periods.length}`,
      periods.length > 0 ? 1 : 0.1,
    ),
  };
}

export async function projectEieMasterySummary(
  ctx: ServiceContext,
  studentId: string,
): Promise<StudentEducationalIntelligence> {
  await assertMayAccessStudent(ctx, studentId);
  const repo = toRepoContext(ctx);
  const schoolId = schoolIdOf(repo);

  const { data: student } = await getClient(repo)
    .from("students")
    .select("id, user_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  const userId = student?.user_id ? String(student.user_id) : null;
  let mastery: {
    subject: string;
    chapter?: string | null;
    concept: string;
    mastery_score: number;
    mistake_count?: number;
    updated_at?: string | null;
  }[] = [];
  let revision: {
    subject: string;
    chapter?: string | null;
    topic?: string | null;
    reason?: string | null;
    priority: number;
    due_date?: string | null;
    completed?: boolean;
  }[] = [];

  if (userId) {
    const { data: masteryRows } = await getClient(repo)
      .from("concept_mastery")
      .select("subject, chapter, concept, mastery_score, mistake_count, updated_at, last_attempt_at")
      .eq("user_id", userId)
      .limit(200);
    mastery = (masteryRows ?? []) as typeof mastery;

    const { data: revRows } = await getClient(repo)
      .from("revision_queue")
      .select("subject, chapter, topic, reason, priority, due_date, completed")
      .eq("user_id", userId)
      .eq("completed", false)
      .order("priority", { ascending: false })
      .limit(40);
    revision = (revRows ?? []) as typeof revision;
  }

  return buildStudentEducationalIntelligence({
    studentId,
    schoolId,
    mastery,
    revisionQueue: revision,
  });
}

export async function projectParentChildSummary(
  ctx: ServiceContext,
  studentId: string,
): Promise<ParentChildSummaryProjection> {
  await assertMayAccessStudent(ctx, studentId);
  if (ctx.role !== "parent" && ctx.role !== "admin" && ctx.role !== "principal") {
    const { ForbiddenError } = await import("../services/context");
    throw new ForbiddenError("Parent child summary is for linked parents");
  }
  const summary = await buildStudentAiSummary(toRepoContext(ctx), studentId);
  const profile = await AcademicProfileService.get(ctx, studentId);
  const hasMetrics =
    !!profile &&
    ((profile.attendanceTotal ?? 0) > 0 ||
      (profile.homeworkAssigned ?? 0) > 0 ||
      (profile.testsAttempted ?? 0) > 0 ||
      (profile.examsRecorded ?? 0) > 0);
  return {
    projection: "ParentChildSummary",
    version: 1,
    studentId,
    schoolId: ctx.schoolId,
    attendance_pct: summary.attendancePct,
    homework_completion_pct: summary.homeworkCompletionPct,
    tests_avg_pct: summary.testsAvgPct,
    exams_avg_pct: summary.examsAvgPct,
    weak_topics: summary.weakTopics,
    strong_topics: summary.strongTopics,
    ...meta(
      profile?.refreshedAt ?? null,
      `parent:${studentId}:${profile?.refreshedAt ?? "none"}`,
      profile ? (hasMetrics ? 1 : 0.4) : 0.3,
    ),
  };
}

/** Bundle AE + EIE facts for optional explanation (never invent numbers). */
export async function projectPerformanceFacts(
  ctx: ServiceContext,
  studentId: string,
): Promise<{
  attendance: AttendanceQueryProjection;
  homework: HomeworkDueProjection;
  marks: MarksSummaryProjection;
  eie: StudentEducationalIntelligence;
  progression: Awaited<ReturnType<typeof projectStudentProgression>>;
}> {
  const [attendance, homework, marks, eie, progression] = await Promise.all([
    projectAttendanceQuery(ctx, studentId),
    projectHomeworkDue(ctx, studentId),
    projectMarksSummary(ctx, studentId),
    projectEieMasterySummary(ctx, studentId),
    projectStudentProgression(ctx, studentId),
  ]);
  return { attendance, homework, marks, eie, progression };
}

/** Progression + weak-concept trends for Nova context packs. */
export async function projectStudentProgression(
  ctx: ServiceContext,
  studentId: string,
): Promise<{
  projection: "StudentProgression";
  version: 1;
  studentId: string;
  schoolId: string;
  xp: number;
  level: number;
  league: string;
  reputation: number;
  study_streak: number;
  badges_earned: number;
  achievements_earned: number;
  battleground_wins: number;
  practice_sessions: number;
  weak_concepts: string[];
  source_as_of: string | null;
  data_version: string;
  completeness: number;
}> {
  await assertMayAccessStudent(ctx, studentId);
  const { ProgressionService } = await import("../services/progressionService");
  const { PracticeService } = await import("../services/practiceService");

  let snap = null as Awaited<ReturnType<typeof ProgressionService.getForStudent>> | null;
  let weak: Array<{ concept_label: string; subject: string }> = [];
  try {
    snap = await ProgressionService.getForStudent(ctx, studentId);
  } catch {
    snap = null;
  }
  try {
    // Need student user context for practice weak concepts — resolve via profile ctx
    const client = getClient(toRepoContext(ctx));
    const { data: stu } = await client
      .from("students")
      .select("user_id")
      .eq("id", studentId)
      .maybeSingle();
    if (stu?.user_id) {
      const practiceCtx = { ...ctx, userId: stu.user_id, studentId };
      weak = await PracticeService.listWeakConcepts(practiceCtx, { limit: 8 });
    }
  } catch {
    weak = [];
  }

  const hasData = !!snap && (snap.xp > 0 || snap.counts.practice_sessions > 0 || snap.badges.length > 0);
  return {
    projection: "StudentProgression",
    version: 1,
    studentId,
    schoolId: ctx.schoolId,
    xp: snap?.xp ?? 0,
    level: snap?.level ?? 1,
    league: snap?.league?.label ?? snap?.league?.code ?? "Bronze",
    reputation: snap?.reputation ?? 0,
    study_streak: snap?.study_streak ?? 0,
    badges_earned: snap?.badges?.length ?? 0,
    achievements_earned: snap?.achievements?.length ?? 0,
    battleground_wins: snap?.battleground?.wins ?? 0,
    practice_sessions: snap?.counts?.practice_sessions ?? 0,
    weak_concepts: weak.map((w) => `${w.subject}: ${w.concept_label}`).slice(0, 8),
    ...meta(
      null,
      `prog:${studentId}:${snap?.xp ?? 0}:${snap?.level ?? 1}`,
      hasData ? 1 : 0.2,
    ),
  };
}

export const AiContextApis = {
  projectAttendanceQuery,
  projectHomeworkDue,
  projectMarksSummary,
  projectTimetableToday,
  projectEieMasterySummary,
  projectParentChildSummary,
  projectPerformanceFacts,
  projectStudentProgression,
};
