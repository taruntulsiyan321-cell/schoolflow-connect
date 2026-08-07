import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import {
  AnalyticsService,
  AttendanceService,
  AcademicProfileService,
  useAcademicLive,
  computeAttendanceRisk,
  computeHomeworkConsistency,
  buildSchoolHealthBrief,
  RiskBadge,
  type RiskBand,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { supabase } from "@/integrations/supabase/client";
import { localDateKey } from "@/lib/localDate";

/**
 * Principal live academic panels — sourced from the Academic Engine only.
 * No mock attendanceTrend / classPerformance / attendanceClasses / student rankings here.
 */

function todayStr(): string {
  return localDateKey();
}

function Loading({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "40px 0", color: "var(--text-muted)", fontSize: 12 }}>
      <Loader2 className="animate-spin" size={16} /> {label}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return <div style={{ padding: "24px 0", textAlign: "center", color: "var(--rose)", fontSize: 12 }}>{message}</div>;
}

function Empty({ message }: { message: string }) {
  return <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>{message}</div>;
}

function StatBlock({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ padding: "14px 16px", background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border-subtle)" }}>
      <div className="font-mono-data" style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  fontSize: 11, color: "var(--text-muted)", textAlign: "left", padding: "8px 14px",
  fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
};

/**
 * School-wide KPI overview — AnalyticsService.forSchool + AttendanceService.summarizeSchoolDate.
 * Health brief is built client-side from the same school aggregate (no extra fetch) via
 * the EIE-aware buildSchoolHealthBrief — see src/academic/ai/schoolHealthBrief.ts.
 */
export function PrincipalSchoolOverview() {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive([
    "attendance",
    "homework",
    "marks",
    "examination",
    "test",
    "profile",
  ]);
  const [school, setSchool] = useState<Awaited<ReturnType<typeof AnalyticsService.forSchool>> | null>(null);
  const [today, setToday] = useState<Awaited<ReturnType<typeof AttendanceService.summarizeSchoolDate>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ctx) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, d] = await Promise.all([
          AnalyticsService.forSchool(ctx),
          AttendanceService.summarizeSchoolDate(ctx, todayStr()),
        ]);
        if (cancelled) return;
        setSchool(s);
        setToday(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load school overview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, ready, ctx, liveVersion]);

  const brief = useMemo(() => {
    if (!school) return null;
    const attendanceRisk = computeAttendanceRisk(school.avgAttendancePct > 0 ? school.avgAttendancePct : null);
    const homeworkRisk = computeHomeworkConsistency(school.avgHomeworkCompletionPct > 0 ? school.avgHomeworkCompletionPct : null);
    return buildSchoolHealthBrief({
      school_id: ctx?.schoolId ?? "",
      class_count: school.classCount,
      student_count: school.studentCount,
      teacher_count: school.teacherCount,
      avg_attendance_pct: school.avgAttendancePct,
      avg_homework_completion_pct: school.avgHomeworkCompletionPct,
      avg_tests_pct: school.avgTestsPct,
      avg_exams_pct: school.avgExamsPct,
      attendance_risk_band: attendanceRisk.band,
      homework_consistency_band: homeworkRisk.band,
      source_as_of: todayStr(),
      data_version: `principal_overview:${school.studentCount}:${school.classCount}`,
    });
  }, [school, ctx?.schoolId]);

  if (loading) return <Loading label="Loading school overview (Academic Engine)…" />;
  if (error) return <ErrorNote message={error} />;
  if (!school) return <Empty message="No school analytics available yet." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
        <StatBlock label="Students" value={school.studentCount} color="var(--indigo)" />
        <StatBlock label="Teachers" value={school.teacherCount} color="var(--teal)" />
        <StatBlock label="Classes" value={school.classCount} color="var(--indigo-mid)" />
        <StatBlock label="Attendance Today" value={`${today?.overallDayRatePct ?? 0}%`} color="var(--emerald)" />
        <StatBlock label="Profile Avg Attendance" value={`${Math.round(school.avgAttendancePct)}%`} color="var(--emerald)" />
        <StatBlock label="Avg Exams" value={`${Math.round(school.avgExamsPct)}%`} color="var(--rose)" />
        <StatBlock label="Avg Homework" value={`${Math.round(school.avgHomeworkCompletionPct)}%`} color="var(--amber)" />
        <StatBlock label="Avg Tests" value={`${Math.round(school.avgTestsPct)}%`} color="var(--indigo)" />
      </div>
      {brief && brief.status === "ready" && (
        <div style={{
          padding: "16px 18px", borderRadius: 12, background: "var(--indigo-light)",
          border: "1px solid rgba(59,91,219,0.25)", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, color: "var(--text-primary)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={13} color="var(--indigo)" /> School Health Brief
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
            {brief.bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}
      <p style={{ fontSize: 10, color: "var(--text-muted)" }}>AnalyticsService.forSchool · AttendanceService.summarizeSchoolDate · buildSchoolHealthBrief (EIE)</p>
    </div>
  );
}

/**
 * Per-class rollups table — AnalyticsService.classRollups (computed in the engine, not in React).
 */
export function PrincipalClassRollups() {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive([
    "attendance",
    "homework",
    "marks",
    "examination",
    "test",
    "profile",
  ]);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof AnalyticsService.classRollups>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ctx) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await AnalyticsService.classRollups(ctx);
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load class rollups");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, ready, ctx, liveVersion]);

  const risk = useMemo(
    () =>
      rows.map((c) => ({
        classId: c.classId,
        // Empty classes have no real average to classify — avoid a false "high risk"
        // read from a 0%-because-no-students average.
        attendance: computeAttendanceRisk(c.studentCount > 0 ? c.avgAttendancePct : null),
        homework: computeHomeworkConsistency(c.studentCount > 0 ? c.avgHomeworkCompletionPct : null),
      })),
    [rows],
  );
  const atRiskCount = risk.filter(
    (r) => r.attendance.band === "elevated" || r.attendance.band === "high"
      || r.homework.band === "elevated" || r.homework.band === "high",
  ).length;

  if (loading) return <Loading label="Loading class rollups…" />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div>
      {atRiskCount > 0 && (
        <div style={{
          marginBottom: 14, padding: "10px 14px", borderRadius: 10,
          background: "var(--rose-light, rgba(220,38,38,0.08))", border: "1px solid rgba(220,38,38,0.25)",
          fontSize: 12, color: "var(--text-primary)", fontWeight: 600,
        }}>
          {atRiskCount} of {rows.length} class{rows.length === 1 ? "" : "es"} need attention — elevated or high attendance/homework risk (EIE).
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Class", "Students", "Attendance", "Homework", "Exams", "Tests", "Risk"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const r = risk.find((x) => x.classId === c.classId);
              const worst: RiskBand =
                c.studentCount === 0 || !r
                  ? "unknown"
                  : r.attendance.band === "high" || r.homework.band === "high"
                  ? "high"
                  : r.attendance.band === "elevated" || r.homework.band === "elevated"
                  ? "elevated"
                  : "low";
              return (
                <tr key={c.classId} style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)" }}>
                  <td style={{ padding: "12px 14px", fontWeight: 700, fontSize: 13 }}>{c.className}{c.section ? `-${c.section}` : ""}</td>
                  <td style={{ padding: "12px 14px", fontSize: 12 }} className="font-mono-data">{c.studentCount}</td>
                  <td
                    style={{
                      padding: "12px 14px", fontSize: 12, fontWeight: 600,
                      color: c.avgAttendancePct >= 90 ? "var(--emerald)" : c.avgAttendancePct >= 75 ? "var(--amber)" : "var(--rose)",
                    }}
                    className="font-mono-data"
                  >
                    {Math.round(c.avgAttendancePct)}%
                  </td>
                  <td style={{ padding: "12px 14px", fontSize: 12 }} className="font-mono-data">{Math.round(c.avgHomeworkCompletionPct)}%</td>
                  <td style={{ padding: "12px 14px", fontSize: 12 }} className="font-mono-data">{Math.round(c.avgExamsPct)}%</td>
                  <td style={{ padding: "12px 14px", fontSize: 12 }} className="font-mono-data">{Math.round(c.avgTestsPct)}%</td>
                  <td style={{ padding: "12px 14px" }}><RiskBadge band={worst} size="sm" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty message="No classes found." />}
      </div>
      <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 8 }}>AnalyticsService.classRollups · risk bands via EIE (src/academic/eie)</p>
    </div>
  );
}

interface RankedStudent {
  studentId: string;
  fullName: string;
  classLabel: string;
  examsAvgPct: number;
  attendancePct: number;
}

/**
 * Top/bottom student rankings — AcademicProfileService.listForSchool for metrics,
 * `students` table for name lookup only (no academic numbers from that query).
 */
export function PrincipalStudentRankings() {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(["profile", "marks", "attendance", "examination"]);
  const [rows, setRows] = useState<RankedStudent[]>([]);
  const [metric, setMetric] = useState<"exams" | "attendance">("exams");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ctx) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const profiles = await AcademicProfileService.listForSchool(ctx, { limit: 500 });
        const ids = profiles.map((p) => p.studentId);
        const names = new Map<string, { fullName: string; classLabel: string }>();
        if (ids.length > 0) {
          const { data, error: sErr } = await supabase
            .from("students")
            .select("id, full_name, classes(name, section)")
            .in("id", ids);
          if (sErr) throw sErr;
          for (const s of (data ?? []) as { id: string; full_name: string; classes: { name: string; section: string } | null }[]) {
            names.set(s.id, {
              fullName: s.full_name,
              classLabel: s.classes ? `${s.classes.name}-${s.classes.section}` : "Unassigned",
            });
          }
        }
        const ranked: RankedStudent[] = profiles.map((p) => ({
          studentId: p.studentId,
          fullName: names.get(p.studentId)?.fullName ?? p.studentId.slice(0, 8),
          classLabel: names.get(p.studentId)?.classLabel ?? "—",
          examsAvgPct: p.examsAvgPct,
          attendancePct: p.attendancePct,
        }));
        if (!cancelled) setRows(ranked);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load rankings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, ready, ctx, liveVersion]);

  if (loading) return <Loading label="Loading student rankings…" />;
  if (error) return <ErrorNote message={error} />;

  const key = metric === "exams" ? "examsAvgPct" : "attendancePct";
  const sorted = [...rows].sort((a, b) => b[key] - a[key]);
  const top = sorted.slice(0, 5);
  const bottom = [...sorted].reverse().slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {(["exams", "attendance"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetric(m)}
            style={{
              fontSize: 11, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "none",
              cursor: "pointer",
              background: metric === m ? "var(--indigo)" : "var(--bg)",
              color: metric === m ? "#fff" : "var(--text-muted)",
            }}
          >
            {m === "exams" ? "By Exam Avg" : "By Attendance"}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty message="No student academic profiles found yet." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--emerald)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Top Performers
            </div>
            {top.map((s, i) => (
              <div key={s.studentId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <div style={{ width: 22, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>#{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.fullName}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{s.classLabel}</div>
                </div>
                <div className="font-mono-data" style={{ fontSize: 13, fontWeight: 700, color: "var(--emerald)" }}>{Math.round(s[key])}%</div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--rose)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Needs Attention
            </div>
            {bottom.map((s, i) => (
              <div key={s.studentId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <div style={{ width: 22, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>#{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.fullName}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{s.classLabel}</div>
                </div>
                <div className="font-mono-data" style={{ fontSize: 13, fontWeight: 700, color: "var(--rose)" }}>{Math.round(s[key])}%</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p style={{ fontSize: 10, color: "var(--text-muted)" }}>AcademicProfileService.listForSchool · students (name lookup only)</p>
    </div>
  );
}

/**
 * Live school attendance for a chosen date — AttendanceService.summarizeSchoolDate.
 */
export function PrincipalAttendanceLive() {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "profile"]);
  const [date, setDate] = useState(() => todayStr());
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof AttendanceService.summarizeSchoolDate>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ctx) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await AttendanceService.summarizeSchoolDate(ctx, date);
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load attendance");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, ready, ctx, date, liveVersion]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <label htmlFor="principal-attendance-date" style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Date</label>
        <input
          id="principal-attendance-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{
            border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12,
            background: "var(--surface)", color: "var(--text-primary)",
          }}
        />
      </div>
      {loading ? (
        <Loading label="Loading attendance…" />
      ) : error ? (
        <ErrorNote message={error} />
      ) : summary ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            <StatBlock label="Overall Day Rate" value={`${summary.overallDayRatePct}%`} color="var(--emerald)" />
            <StatBlock label="Students" value={summary.totalStudents} color="var(--indigo)" />
            <StatBlock label="Present" value={summary.present} color="var(--emerald)" />
            <StatBlock label="Absent" value={summary.absent} color="var(--rose)" />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Class", "Students", "Present", "Absent", "Day Rate", "Status"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.classes.map((c, i) => (
                  <tr key={c.classId} style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13 }}>{c.className}-{c.section}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12 }} className="font-mono-data">{c.totalStudents}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--emerald)", fontWeight: 700 }} className="font-mono-data">{c.present}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--rose)", fontWeight: 700 }} className="font-mono-data">{c.absent}</td>
                    <td
                      style={{
                        padding: "10px 14px", fontSize: 12, fontWeight: 600,
                        color: c.dayRatePct >= 90 ? "var(--emerald)" : c.dayRatePct >= 75 ? "var(--amber)" : "var(--rose)",
                      }}
                      className="font-mono-data"
                    >
                      {c.dayRatePct}%
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 11, color: c.locked ? "var(--emerald)" : "var(--text-muted)" }}>
                      {c.locked ? "Locked" : "Open"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summary.classes.length === 0 && <Empty message="No classes found for this date." />}
          </div>
        </>
      ) : (
        <Empty message="No attendance data for this date." />
      )}
      <p style={{ fontSize: 10, color: "var(--text-muted)" }}>AttendanceService.summarizeSchoolDate</p>
    </div>
  );
}

/**
 * Live teacher directory + academic KPIs from AnalyticsService.forTeacher.
 * No fake avg/attendance/homework columns.
 */
export function PrincipalTeachersLive() {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive([
    "attendance",
    "homework",
    "marks",
    "examination",
    "test",
    "profile",
  ]);
  const [rows, setRows] = useState<
    {
      id: string;
      name: string;
      subject: string;
      status: string;
      classCount: number;
      subjects: string[];
      avgAttendancePct: number;
      avgHomeworkCompletionPct: number;
      avgExamsPct: number;
      avgTestsPct: number;
      studentCount: number;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!settled) return;
    if (!ctx) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: teachers, error: tErr } = await supabase
          .from("teachers")
          .select("id, full_name, subject, status")
          .eq("school_id", ctx.schoolId)
          .order("full_name");
        if (tErr) throw new Error(tErr.message);
        const list = teachers ?? [];
        const enriched = [];
        for (const t of list) {
          const perf = await AnalyticsService.forTeacher(ctx, t.id).catch(() => null);
          enriched.push({
            id: t.id,
            name: t.full_name ?? "Teacher",
            subject: t.subject ?? perf?.assignedSubjects[0] ?? "-",
            status: t.status ?? "active",
            classCount: perf?.classCount ?? 0,
            subjects: perf?.assignedSubjects ?? [],
            avgAttendancePct: perf?.avgAttendancePct ?? 0,
            avgHomeworkCompletionPct: perf?.avgHomeworkCompletionPct ?? 0,
            avgExamsPct: perf?.avgExamsPct ?? 0,
            avgTestsPct: perf?.avgTestsPct ?? 0,
            studentCount: perf?.studentCount ?? 0,
          });
        }
        if (!cancelled) setRows(enriched);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load teachers");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, ready, ctx, liveVersion]);

  const filtered = rows.filter(
    (t) =>
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.subject.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) return <Loading label="Loading teacher analytics..." />;
  if (error) return <div style={{ color: "var(--rose)", fontSize: 13 }}>{error}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search teachers..."
          style={{
            flex: 1, maxWidth: 280, border: "1px solid var(--border)", borderRadius: 9,
            padding: "8px 14px", fontSize: 13, background: "var(--surface)", color: "var(--text-primary)",
          }}
        />
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{filtered.length} teachers</div>
      </div>

      {filtered.length === 0 ? (
        <Empty message="No teachers found. Academic KPIs appear once teacher_classes and profiles sync." />
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Teacher", "Subject", "Classes", "Students", "Att %", "HW %", "Exams %", "Tests %", "Status"].map((h) => (
                  <th
                    key={h}
                    style={{
                      fontSize: 11, color: "var(--text-muted)", textAlign: "left", padding: "10px 16px",
                      fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr key={t.id} style={{ background: i % 2 === 0 ? "transparent" : "var(--bg)" }}>
                  <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{t.name}</td>
                  <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)" }}>{t.subject}</td>
                  <td style={{ padding: "12px 16px", fontSize: 12 }} className="font-mono-data">{t.classCount || "-"}</td>
                  <td style={{ padding: "12px 16px", fontSize: 12 }} className="font-mono-data">{t.studentCount || "-"}</td>
                  <td style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700 }} className="font-mono-data">
                    {t.classCount ? `${Math.round(t.avgAttendancePct)}%` : "-"}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 12 }} className="font-mono-data">
                    {t.classCount ? `${Math.round(t.avgHomeworkCompletionPct)}%` : "-"}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 12 }} className="font-mono-data">
                    {t.classCount ? `${Math.round(t.avgExamsPct)}%` : "-"}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 12 }} className="font-mono-data">
                    {t.classCount ? `${Math.round(t.avgTestsPct)}%` : "-"}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 11, textTransform: "capitalize", color: "var(--text-muted)" }}>{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: 10, color: "var(--text-muted)" }}>
        AnalyticsService.forTeacher - assigned class profile averages (empty when no assignments)
      </p>
    </div>
  );
}

/**
 * School homework overview — AnalyticsService.homeworkSchool / HomeworkService.summarizeSchool.
 */
export function PrincipalHomeworkLive() {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "profile"]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof AnalyticsService.homeworkSchool>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ctx) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await AnalyticsService.homeworkSchool(ctx);
        if (!cancelled) {
          setSummary(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load homework analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, ready, ctx, liveVersion]);

  if (loading) return <Loading label="Loading homework analytics..." />;
  if (error) return <ErrorNote message={error} />;
  if (!summary) return <Empty message="No homework analytics yet." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
        {[
          { label: "Published", value: String(summary.totalPublished) },
          { label: "Drafts", value: String(summary.totalDrafts) },
          { label: "Completion", value: `${summary.schoolCompletionPct}%` },
          { label: "Late %", value: `${summary.latePct}%` },
          { label: "Submissions", value: String(summary.submissionCount) },
          { label: "Graded", value: String(summary.gradedCount) },
        ].map((k) => (
          <div key={k.label} style={{ padding: 14, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }}>
            <div className="font-mono-data" style={{ fontSize: 20, fontWeight: 700 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{k.label}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Class", "Homework", "Completion %", "Late %"].map((h) => (
                <th key={h} style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "left", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.classes.map((c) => (
              <tr key={c.classId}>
                <td style={{ padding: "10px 14px", fontSize: 13 }}>{c.className} {c.section}</td>
                <td style={{ padding: "10px 14px", fontSize: 12 }} className="font-mono-data">{c.homeworkCount}</td>
                <td style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700 }} className="font-mono-data">{c.completionPct}%</td>
                <td style={{ padding: "10px 14px", fontSize: 12 }} className="font-mono-data">{c.latePct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {summary.classes.length === 0 && <Empty message="No class homework yet." />}
      </div>
      <p style={{ fontSize: 10, color: "var(--text-muted)" }}>AnalyticsService.homeworkSchool</p>
    </div>
  );
}
