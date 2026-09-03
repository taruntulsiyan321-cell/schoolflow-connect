import { useEffect, useState } from "react";
import {
  GraduationCap, Users, UserCheck, Building2, Activity,
  AlertCircle, CheckCircle2, TrendingUp, TrendingDown,
  Bell, Plus, ChevronRight,
  BarChart2, UserPlus, ClipboardEdit, Loader2,
} from "lucide-react";
import { cn, InitialsAvatar } from "./shared";
import type { AdminPageKey } from "./nav";
import { AnalyticsService, AttendanceService, LeaveService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { supabase } from "@/integrations/supabase/client";
import { localDateKey } from "@/lib/localDate";
import { toErrorMessage } from "@/lib/presentation";
import { toPercentLabel } from "@/lib/presentation";

function StatCard({
  label, value, sub, icon, color, delta,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; color: string; delta?: number;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-surface p-5 flex flex-col gap-3 hover:border-border transition-all">
      <div className="flex items-start justify-between">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${color}22`, color }}
        >
          {icon}
        </div>
        {delta !== undefined && (
          <div className={cn("flex items-center gap-1 text-xs font-semibold", delta >= 0 ? "text-[#4aa87a]" : "text-[#cc5069]")}>
            {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(delta)}%
          </div>
        )}
      </div>
      <div>
        <div className="text-2xl font-black tabular-nums text-foreground">{value}</div>
        <div className="text-xs font-semibold text-muted-foreground mt-0.5">{label}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

/**
 * CHUNK 10.7. `value` was `number`, and the profile average feeding it is
 * `number | null`. A null reached both the width and the caption:
 * `width: null%` is invalid CSS so the bar silently collapsed to nothing,
 * and the caption read "null%". A bar with no measurement now draws an empty
 * track and says so, which is the same rendering the rest of the app gives
 * an unmeasured figure.
 */
function AttendanceBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  const measured = value !== null && Number.isFinite(value);
  return (
    <div className="flex items-center gap-3">
      <div className="text-xs text-muted-foreground w-20 shrink-0">{label}</div>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: measured ? `${value}%` : "0%", background: color }} />
      </div>
      <div className="text-xs font-bold tabular-nums shrink-0" style={{ color: measured ? color : "var(--muted-foreground, #6b7280)" }}>{toPercentLabel(value)}</div>
    </div>
  );
}

const priorityColor: Record<string, string> = {
  high: "#cc5069",
  medium: "#c08a3a",
  low: "#4aa87a",
};

type RecentStudent = { id: string; fullName: string; classLabel: string; admissionNumber: string };
type RecentTeacher = { id: string; fullName: string; department: string | null; employeeId: string | null };
type ActivityRow = { id: string; action: string; created_at: string; actor_name: string | null };
type LeaveRow = { id: string; leave_type: string; from_date: string; to_date: string; created_at: string };
type NoticeRow = { id: string; title: string; body: string; created_at: string; priority: string | null };

/**
 * Admin dashboard — live census + recent rosters + activity from Supabase /
 * Academic Engine only. No adminStats / adminStudents mock KPIs.
 */
export default function AdminDashboard({ setPage }: { setPage: (p: AdminPageKey) => void }) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "homework", "marks", "examination", "test", "profile"]);

  const [counts, setCounts] = useState({ students: 0, teachers: 0, parents: 0, classes: 0 });
  const [todayPresent, setTodayPresent] = useState(0);
  const [todayAbsent, setTodayAbsent] = useState(0);
  const [todayPct, setTodayPct] = useState(0);
  // CHUNK 10.7. Was useState(0) fed by Math.round(school.avgAttendancePct).
  // Both halves were wrong the same way: 0 is a real reading of "everybody
  // was absent", and it was standing in for "nobody has marked anything".
  const [profileAvg, setProfileAvg] = useState<number | null>(null);
  const [classRows, setClassRows] = useState<
    { name: string; total: number; present: number; submitted: boolean; dayRatePct: number }[]
  >([]);
  const [recentStudents, setRecentStudents] = useState<RecentStudent[]>([]);
  const [recentTeachers, setRecentTeachers] = useState<RecentTeacher[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<LeaveRow[]>([]);
  // The tile is a COUNT; the list below it is a page of five. Deriving the tile
  // from the page made it report the page size — it read 5 against 8 pending,
  // and would read 5 against forty.
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const today = localDateKey();
        const [
          day,
          school,
          studentCount,
          teacherCount,
          parentCount,
          classCount,
          recentStudentRows,
          recentTeacherRows,
          activityRows,
          classLeaveRows,
          noticeRows,
        ] = await Promise.all([
          AttendanceService.summarizeSchoolDate(ctx, today),
          AnalyticsService.forSchool(ctx),
          supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", ctx.schoolId),
          supabase.from("teachers").select("id", { count: "exact", head: true }).eq("school_id", ctx.schoolId),
          supabase.from("parents").select("id", { count: "exact", head: true }).eq("school_id", ctx.schoolId),
          supabase.from("classes").select("id", { count: "exact", head: true }).eq("school_id", ctx.schoolId),
          supabase
            .from("students")
            .select("id, full_name, admission_number, classes(name, section)")
            .eq("school_id", ctx.schoolId)
            .order("created_at", { ascending: false })
            .limit(4),
          supabase
            .from("teachers")
            .select("id, full_name, department, employee_id")
            .eq("school_id", ctx.schoolId)
            .order("created_at", { ascending: false })
            .limit(4),
          supabase
            .from("school_activity_feed")
            .select("id, action, created_at, actor_name")
            .eq("school_id", ctx.schoolId)
            .order("created_at", { ascending: false })
            .limit(6),
          // BATCH 1c. This was a hand-rolled query joining classes!inner, which
          // could only ever see requests carrying a class_id — 2 of 19 live rows
          // and 0 of the 8 pending — so the widget rendered a confident zero next
          // to a Leave Requests page showing all 8. Asking LeaveService, which
          // already owns this question, removes the widget's second home rather
          // than repairing it: the two agree by construction now, and the widget
          // stops bypassing the service's own authorization check.
          LeaveService.listPending(ctx),
          supabase
            .from("notices")
            .select("id, title, body, created_at, priority")
            .eq("school_id", ctx.schoolId)
            .order("created_at", { ascending: false })
            .limit(4),
        ]);

        if (cancelled) return;

        // Every query above only reflects reality if it actually succeeded —
        // .count / .data default to 0 / [] on error too, which would otherwise
        // render as a confident (wrong) empty dashboard with no indication
        // anything failed server-side.
        if (studentCount.error) throw new Error(`Failed to load student count: ${studentCount.error.message}`);
        if (teacherCount.error) throw new Error(`Failed to load teacher count: ${teacherCount.error.message}`);
        if (parentCount.error) throw new Error(`Failed to load parent count: ${parentCount.error.message}`);
        if (classCount.error) throw new Error(`Failed to load class count: ${classCount.error.message}`);
        if (recentStudentRows.error) {
          throw new Error(`Failed to load recent students: ${recentStudentRows.error.message}`);
        }
        if (recentTeacherRows.error) {
          throw new Error(`Failed to load recent teachers: ${recentTeacherRows.error.message}`);
        }
        if (activityRows.error) throw new Error(`Failed to load activity feed: ${activityRows.error.message}`);
        if (noticeRows.error) throw new Error(`Failed to load notices: ${noticeRows.error.message}`);

        setTodayPresent(day.present);
        setTodayAbsent(day.absent);
        setTodayPct(day.overallDayRatePct);
        setProfileAvg(school.avgAttendancePct);
        setClassRows(
          day.classes.map((c) => ({
            name: `${c.className}-${c.section}`,
            total: c.totalStudents,
            present: c.present,
            submitted: c.marked > 0,
            dayRatePct: c.dayRatePct,
          })),
        );

        setCounts({
          students: studentCount.count ?? 0,
          teachers: teacherCount.count ?? 0,
          parents: parentCount.count ?? 0,
          classes: classCount.count ?? 0,
        });

        setRecentStudents(
          ((recentStudentRows.data ?? []) as {
            id: string;
            full_name: string;
            admission_number: string;
            classes: { name: string; section: string } | null;
          }[]).map((s) => ({
            id: s.id,
            fullName: s.full_name,
            classLabel: s.classes ? `${s.classes.name}-${s.classes.section}` : "Unassigned",
            admissionNumber: s.admission_number,
          })),
        );

        setRecentTeachers(
          ((recentTeacherRows.data ?? []) as {
            id: string;
            full_name: string;
            department: string | null;
            employee_id: string | null;
          }[]).map((t) => ({
            id: t.id,
            fullName: t.full_name,
            department: t.department,
            employeeId: t.employee_id,
          })),
        );

        setActivity((activityRows.data ?? []) as ActivityRow[]);
        // The tile is the count of every pending request; the list below it is a
        // page of five. Deriving the tile from the page made it report the page
        // size — 5 against 8, and 5 against forty.
        const pending = classLeaveRows.map((r) => ({
          id: r.id,
          leave_type: r.leaveType,
          from_date: r.fromDate,
          to_date: r.toDate,
          created_at: r.createdAt,
        }));
        setPendingLeaveCount(pending.length);
        setPendingLeaves(pending.slice(0, 5));
        setNotices((noticeRows.data ?? []) as NoticeRow[]);
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Failed to load dashboard"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  return (
    <div className="space-y-6">
      {/* ── Quick Actions (TOP) ── */}
      <div className="bg-surface border border-border/70 rounded-2xl p-4">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</div>
        <div className="flex flex-wrap gap-2">
          {[
            { icon: <UserPlus className="w-4 h-4" />, label: "Add Student", color: "#3b5bdb", action: () => setPage("students") },
            { icon: <Plus className="w-4 h-4" />, label: "Add Teacher", color: "#4b9fd4", action: () => setPage("teachers") },
            { icon: <UserCheck className="w-4 h-4" />, label: "Add Parent", color: "#6882e8", action: () => setPage("parents") },
            { icon: <Bell className="w-4 h-4" />, label: "View Announcements", color: "#c08a3a", action: () => setPage("announcements") },
            { icon: <ClipboardEdit className="w-4 h-4" />, label: "Edit Today's Attendance", color: "#4aa87a", action: () => setPage("classes") },
          ].map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl hover:bg-muted transition-all group border border-border/70 hover:border-border"
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all group-hover:scale-110"
                style={{ background: `${item.color}22`, color: item.color }}
              >
                {item.icon}
              </div>
              <span className="text-xs font-semibold text-muted-foreground group-hover:text-foreground transition-all">
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-xs text-[#cc5069] bg-[#cc5069]/10 border border-[#cc5069]/20 rounded-xl px-4 py-3">
          Failed to load dashboard: {error}
        </div>
      )}

      {/* Stat Cards — live census counts */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total Students" value={counts.students} icon={<GraduationCap className="w-5 h-5" />} color="#3b5bdb" />
        <StatCard label="Total Teachers" value={counts.teachers} icon={<Users className="w-5 h-5" />} color="#4b9fd4" />
        <StatCard label="Total Parents" value={counts.parents} icon={<UserCheck className="w-5 h-5" />} color="#6882e8" />
        <StatCard label="Classes" value={counts.classes} icon={<Building2 className="w-5 h-5" />} color="#4aa87a" />
        <StatCard label="Present Today" value={todayPresent} icon={<Activity className="w-5 h-5" />} color="#c08a3a" sub="marked attendance" />
        <StatCard label="Pending Leaves" value={pendingLeaveCount} icon={<AlertCircle className="w-5 h-5" />} color="#cc5069" />
      </div>

      {/* Middle Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Attendance Summary */}
        <div className="bg-surface border border-border/70 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-foreground">{"Today's Attendance"}</div>
            <button onClick={() => setPage("classes")} className="text-[10px] text-[#3b5bdb] hover:underline flex items-center gap-1">
              Edit <ClipboardEdit className="w-3 h-3" />
            </button>
          </div>
          {/* Summary totals */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-muted rounded-xl p-3 text-center">
              <div className="text-lg font-black text-foreground tabular-nums">{todayPresent}</div>
              <div className="text-[9px] text-[#4aa87a] font-bold uppercase tracking-wide mt-0.5">Present</div>
            </div>
            <div className="bg-muted rounded-xl p-3 text-center">
              <div className="text-lg font-black text-foreground tabular-nums">{todayAbsent}</div>
              <div className="text-[9px] text-[#cc5069] font-bold uppercase tracking-wide mt-0.5">Absent</div>
            </div>
            <div className="bg-muted rounded-xl p-3 text-center">
              <div className="text-lg font-black text-foreground tabular-nums">{todayPct}%</div>
              <div className="text-[9px] text-muted-foreground font-bold uppercase tracking-wide mt-0.5">Rate</div>
            </div>
          </div>
          {/* Per-class status */}
          <div className="space-y-2">
            {loading && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground py-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading AttendanceService…
              </div>
            )}
            {!loading && classRows.length === 0 && (
              <div className="text-[10px] text-muted-foreground">No class attendance for today.</div>
            )}
            {classRows.map((cls) => {
              const pct = cls.dayRatePct;
              return (
                <div key={cls.name} className="flex items-center gap-3">
                  <div className="text-[10px] text-muted-foreground w-20 shrink-0">{cls.name}</div>
                  {cls.submitted ? (
                    <>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-[#3b5bdb]" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-[9px] font-bold text-[#3b5bdb] w-8 text-right shrink-0">{pct}%</div>
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#4aa87a] shrink-0" />
                    </>
                  ) : (
                    <>
                      <div className="flex-1 h-1.5 bg-muted rounded-full" />
                      <div className="text-[9px] font-bold text-muted-foreground w-8 text-right shrink-0">—</div>
                      <AlertCircle className="w-3.5 h-3.5 text-[#c08a3a] shrink-0" />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <AttendanceBar label="Profile avg" value={profileAvg} color="#4aa87a" />
        </div>

        {/* Recent Students */}
        <div className="bg-surface border border-border/70 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold text-foreground">Recent Students</div>
            <button onClick={() => setPage("students")} className="text-[10px] text-[#3b5bdb] hover:underline flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-3">
            {!loading && recentStudents.length === 0 && (
              <div className="text-[10px] text-muted-foreground">No students yet.</div>
            )}
            {recentStudents.map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <InitialsAvatar name={s.fullName} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-foreground truncate">{s.fullName}</div>
                  <div className="text-[10px] text-muted-foreground">{s.classLabel} · {s.admissionNumber}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Teachers */}
        <div className="bg-surface border border-border/70 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold text-foreground">Recent Teachers</div>
            <button onClick={() => setPage("teachers")} className="text-[10px] text-[#3b5bdb] hover:underline flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-3">
            {!loading && recentTeachers.length === 0 && (
              <div className="text-[10px] text-muted-foreground">No teachers yet.</div>
            )}
            {recentTeachers.map((t) => (
              <div key={t.id} className="flex items-center gap-3">
                <InitialsAvatar name={t.fullName} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-foreground truncate">{t.fullName}</div>
                  <div className="text-[10px] text-muted-foreground">{t.department ?? "—"} · {t.employeeId ?? "—"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity Log */}
        <div className="lg:col-span-1 bg-surface border border-border/70 rounded-2xl p-5">
          <div className="text-sm font-bold text-foreground mb-4">Recent Activity</div>
          <div className="space-y-3">
            {!loading && activity.length === 0 && (
              <div className="text-[10px] text-muted-foreground">No recent activity.</div>
            )}
            {activity.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-[#3b5bdb]" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-foreground">{a.action}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{a.actor_name ?? "System"}</div>
                </div>
                <div className="text-[9px] text-muted-foreground shrink-0">
                  {new Date(a.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pending Requests */}
        <div className="bg-surface border border-border/70 rounded-2xl p-5">
          <div className="text-sm font-bold text-foreground mb-4">Pending Leave Requests</div>
          <div className="space-y-3">
            {!loading && pendingLeaves.length === 0 && (
              <div className="text-[10px] text-muted-foreground">No pending requests.</div>
            )}
            {pendingLeaves.map((r) => (
              <div key={r.id} className="flex items-start gap-3 p-3 rounded-xl bg-muted hover:bg-muted transition-all cursor-pointer" onClick={() => setPage("leave_requests")}>
                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: priorityColor.medium }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-foreground capitalize">{r.leave_type}</div>
                  <div className="text-[10px] text-muted-foreground">{r.from_date} → {r.to_date}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right column: Announcements + Quick Actions */}
        <div className="flex flex-col gap-4">
          {/* Announcements */}
          <div className="bg-surface border border-border/70 rounded-2xl p-5 flex-1">
            <div className="flex items-center gap-2 mb-4">
              <Bell className="w-4 h-4 text-[#3b5bdb]" />
              <div className="text-sm font-bold text-foreground">Announcements</div>
            </div>
            <div className="space-y-3">
              {!loading && notices.length === 0 && (
                <div className="text-[10px] text-muted-foreground">No announcements yet.</div>
              )}
              {notices.map((a) => (
                <div key={a.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-semibold text-foreground">{a.title}</div>
                  </div>
                  <div className="text-[10px] text-muted-foreground line-clamp-2">{a.body}</div>
                  <div className="text-[9px] text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Reports shortcut */}
          <div className="bg-surface border border-border/70 rounded-2xl p-4">
            <button onClick={() => setPage("reports")} className="w-full flex items-center gap-3 group">
              <div className="w-9 h-9 rounded-xl bg-[#4aa87a22] flex items-center justify-center group-hover:scale-110 transition-all">
                <BarChart2 className="w-4 h-4 text-[#4aa87a]" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-foreground">View Reports</div>
                <div className="text-[10px] text-muted-foreground">Academic Engine reports</div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
