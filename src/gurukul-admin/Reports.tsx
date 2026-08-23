import { useEffect, useMemo, useState } from "react";
import {
  BarChart2, Download, Printer, Filter, ChevronRight,
  GraduationCap, Users, UserCheck, Activity, Globe, Bell,
  CheckCircle2, XCircle, AlertTriangle, Clock, TrendingUp,
} from "lucide-react";
import { cn, exportCSV, printSection } from "./shared";
import {
  AcademicProfileService,
  AnalyticsService,
  AttendanceService,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { Loader2 } from "lucide-react";

type ReportCategory = "academic" | "account" | "platform" | "communication";
type ReportKey =
  | "school-attendance" | "class-attendance" | "student-attendance" | "teacher-attendance"
  | "students-no-account" | "teachers-no-account" | "parents-no-account" | "pending-activations" | "suspended-accounts" | "inactive-accounts"
  | "active-users" | "inactive-users" | "login-report" | "platform-usage"
  | "announcement-delivery" | "announcement-read";

interface ReportDef {
  key: ReportKey;
  label: string;
  description: string;
  category: ReportCategory;
  icon: React.ReactNode;
  color: string;
}

const REPORTS: ReportDef[] = [
  { key: "school-attendance", label: "Overall School Attendance", description: "From AnalyticsService / AcademicProfileService", category: "academic", icon: <Globe className="w-4 h-4" />, color: "#3b5bdb" },
  { key: "class-attendance", label: "Class-wise Attendance", description: "Day summary via AttendanceService", category: "academic", icon: <GraduationCap className="w-4 h-4" />, color: "#4b9fd4" },
  { key: "student-attendance", label: "Student Attendance", description: "Per-student profile attendance %", category: "academic", icon: <Users className="w-4 h-4" />, color: "#6882e8" },
  { key: "teacher-attendance", label: "Teacher Attendance", description: "Account directory (non-academic)", category: "academic", icon: <UserCheck className="w-4 h-4" />, color: "#4aa87a" },
  { key: "students-no-account", label: "Students Without Login Accounts", description: "Students who have not been assigned login credentials", category: "account", icon: <XCircle className="w-4 h-4" />, color: "#cc5069" },
  { key: "teachers-no-account", label: "Teachers Without Login Accounts", description: "Teachers who have not been assigned login credentials", category: "account", icon: <XCircle className="w-4 h-4" />, color: "#cc5069" },
  { key: "parents-no-account", label: "Parents Without Login Accounts", description: "Parents who have not been assigned login credentials", category: "account", icon: <XCircle className="w-4 h-4" />, color: "#cc5069" },
  { key: "pending-activations", label: "Pending Account Activations", description: "Accounts awaiting activation", category: "account", icon: <Clock className="w-4 h-4" />, color: "#c08a3a" },
  { key: "suspended-accounts", label: "Suspended Accounts", description: "All accounts currently suspended", category: "account", icon: <AlertTriangle className="w-4 h-4" />, color: "#cc5069" },
  { key: "inactive-accounts", label: "Inactive Accounts", description: "Accounts marked inactive", category: "account", icon: <AlertTriangle className="w-4 h-4" />, color: "#78788c" },
  { key: "active-users", label: "Active Users Report", description: "Users active within the selected date range", category: "platform", icon: <Activity className="w-4 h-4" />, color: "#4aa87a" },
  { key: "inactive-users", label: "Inactive Users Report", description: "Users who have not logged in recently", category: "platform", icon: <XCircle className="w-4 h-4" />, color: "#78788c" },
  { key: "login-report", label: "User Login Report", description: "Login history across all user types", category: "platform", icon: <TrendingUp className="w-4 h-4" />, color: "#4b9fd4" },
  { key: "platform-usage", label: "Platform Usage Report", description: "Feature usage and session analytics", category: "platform", icon: <BarChart2 className="w-4 h-4" />, color: "#6882e8" },
  { key: "announcement-delivery", label: "Announcement Delivery Report", description: "Delivery rates for all published announcements", category: "communication", icon: <Bell className="w-4 h-4" />, color: "#3b5bdb" },
  { key: "announcement-read", label: "Announcement Read Report", description: "Read rates and unread counts per announcement", category: "communication", icon: <CheckCircle2 className="w-4 h-4" />, color: "#4aa87a" },
];

const CATEGORIES: { key: ReportCategory; label: string; icon: React.ReactNode }[] = [
  { key: "academic", label: "Academic", icon: <GraduationCap className="w-4 h-4" /> },
  { key: "account", label: "Account", icon: <UserCheck className="w-4 h-4" /> },
  { key: "platform", label: "Platform", icon: <Activity className="w-4 h-4" /> },
  { key: "communication", label: "Communication", icon: <Bell className="w-4 h-4" /> },
];

type Row = Record<string, string | number>;

function AcademicEngineReport({ reportKey }: { reportKey: ReportKey }) {
  const { ctx, ready } = useAcademicContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<{ label: string; value: string | number; color: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const today = new Date().toISOString().slice(0, 10);
        if (reportKey === "school-attendance") {
          const school = await AnalyticsService.forSchool(ctx);
          const day = await AttendanceService.summarizeSchoolDate(ctx, today);
          if (cancelled) return;
          setSummary([
            { label: "Students", value: school.studentCount, color: "#3b5bdb" },
            { label: "Profile avg att.", value: `${Math.round(school.avgAttendancePct)}%`, color: "#4aa87a" },
            { label: "Today day-rate", value: `${day.overallDayRatePct}%`, color: "#4b9fd4" },
            { label: "Classes", value: school.classCount, color: "#6882e8" },
          ]);
          setRows(
            day.classes.map((c) => ({
              Class: `${c.className}-${c.section}`,
              Students: c.totalStudents,
              "Today %": c.dayRatePct,
              Present: c.present,
              Absent: c.absent,
            })),
          );
        } else if (reportKey === "class-attendance") {
          const day = await AttendanceService.summarizeSchoolDate(ctx, today);
          if (cancelled) return;
          setSummary(
            day.classes.slice(0, 6).map((c) => ({
              label: `${c.className}-${c.section}`,
              value: `${c.dayRatePct}%`,
              color: "#3b5bdb",
            })),
          );
          setRows(
            day.classes.map((c) => ({
              Class: c.className,
              Section: c.section,
              Students: c.totalStudents,
              "Today Attendance %": c.dayRatePct,
            })),
          );
        } else if (reportKey === "student-attendance") {
          const day = await AttendanceService.summarizeSchoolDate(ctx, today);
          const allRows: Row[] = [];
          let below = 0;
          let above = 0;
          for (const c of day.classes) {
            if (cancelled) break;
            const [profiles, roster] = await Promise.all([
              AcademicProfileService.listForClass(ctx, c.classId, { limit: 200 }),
              AttendanceService.listClassStudents(ctx, c.classId).catch(() => []),
            ]);
            // Report exists so admin/principal can act on "who is at risk" â€”
            // a truncated UUID can't be followed up on, and this class's
            // seed IDs happen to share an 8-char prefix, making every row
            // in "Below 75%" indistinguishable from every other. Resolve
            // the actual name; fall back to the id only if the roster
            // fetch itself failed (never silently drop the row).
            const nameById = new Map<string, string>();
            for (const s of roster) nameById.set(s.id, s.fullName);
            for (const p of profiles) {
              const pct = Math.round(p.attendancePct);
              if (pct < 75) below += 1;
              if (pct >= 90) above += 1;
              allRows.push({
                Student: nameById.get(p.studentId) ?? p.studentId.slice(0, 8),
                Class: `${c.className}-${c.section}`,
                "Attendance %": pct,
                Status: pct >= 75 ? "OK" : "Low",
              });
            }
          }
          if (cancelled) return;
          setSummary([
            { label: "Students", value: allRows.length, color: "#3b5bdb" },
            { label: "Below 75%", value: below, color: "#cc5069" },
            { label: "Above 90%", value: above, color: "#4b9fd4" },
          ]);
          setRows(allRows.slice(0, 200));
        } else if (reportKey === "teacher-attendance") {
          // Teacher HR attendance is not an Academic Engine entity yet â€” honest empty.
          setSummary([{ label: "Teachers (directory)", value: 0, color: "#4aa87a" }]);
          setRows([]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, reportKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading Academic Engine reportâ€¦
      </div>
    );
  }
  if (error) return <div className="text-xs text-[#cc5069] py-8 text-center">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summary.map((s) => (
          <div key={s.label} className="bg-surface border border-border/70 rounded-2xl p-4">
            <div className="text-lg font-black" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => exportCSV(reportKey, rows)} className="text-[10px] px-3 py-1.5 rounded-lg bg-muted text-muted-foreground flex items-center gap-1">
          <Download className="w-3 h-3" /> CSV
        </button>
        <button type="button" onClick={() => printSection(reportKey, document.getElementById("engine-report")?.innerHTML ?? "")} className="text-[10px] px-3 py-1.5 rounded-lg bg-muted text-muted-foreground flex items-center gap-1">
          <Printer className="w-3 h-3" /> Print
        </button>
      </div>
      <div id="engine-report" className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border/70">
              {Object.keys(rows[0] ?? {}).map((k) => (
                <th key={k} className="py-2 pr-3 font-semibold">{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border text-foreground">
                {Object.values(r).map((v, j) => (
                  <td key={j} className="py-2 pr-3">{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="text-center py-10 text-muted-foreground">No rows.</div>}
      </div>
    </div>
  );
}

function NonAcademicPlaceholder({ label }: { label: string }) {
  return (
    <div className="text-xs text-muted-foreground py-16 text-center">
      {label} is not an Academic Engine domain. Use account/platform tools separately.
    </div>
  );
}

export default function AdminReports() {
  const [category, setCategory] = useState<ReportCategory>("academic");
  const [active, setActive] = useState<ReportKey>("school-attendance");

  const list = useMemo(() => REPORTS.filter((r) => r.category === category), [category]);
  const def = REPORTS.find((r) => r.key === active) ?? REPORTS[0]!;

  return (
    <div className="space-y-5">
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              setCategory(c.key);
              const first = REPORTS.find((r) => r.category === c.key);
              if (first) setActive(first.key);
            }}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border",
              category === c.key
                ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30 text-[#3b5bdb]"
                : "border-border/70 text-muted-foreground",
            )}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[240px_1fr] gap-4">
        <div className="space-y-1">
          {list.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setActive(r.key)}
              className={cn(
                "w-full text-left px-3 py-2.5 rounded-xl text-xs border",
                active === r.key
                  ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30 text-[#3b5bdb]"
                  : "border-transparent text-muted-foreground hover:bg-muted",
              )}
            >
              <div className="font-semibold flex items-center gap-2">
                {r.icon} {r.label}
              </div>
              <div className="text-[9px] opacity-70 mt-0.5">{r.description}</div>
            </button>
          ))}
        </div>
        <div className="bg-surface border border-border/70 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <div className="text-sm font-bold text-foreground">{def.label}</div>
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
            <div className="text-[10px] text-muted-foreground">{def.category}</div>
          </div>
          {category === "academic" ? (
            <AcademicEngineReport reportKey={active} />
          ) : (
            <NonAcademicPlaceholder label={def.label} />
          )}
        </div>
      </div>
    </div>
  );
}
