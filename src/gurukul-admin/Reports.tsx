import { useState, useMemo } from "react";
import {
  BarChart2, Download, Printer, Calendar, Filter, ChevronRight,
  GraduationCap, Users, UserCheck, Activity, Globe, Bell,
  CheckCircle2, XCircle, AlertTriangle, Clock, TrendingUp,
  FileText, ChevronDown,
} from "lucide-react";
import { cn, exportCSV, printSection } from "./shared";
import { adminStudents, adminTeachers, adminParents, adminClasses } from "./data";

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Report definitions ─────────────────────────────────────────────────────────

const REPORTS: ReportDef[] = [
  // Academic
  { key: "school-attendance", label: "Overall School Attendance", description: "Attendance summary across all classes and sections", category: "academic", icon: <Globe className="w-4 h-4" />, color: "#6366f1" },
  { key: "class-attendance", label: "Class-wise Attendance", description: "Attendance breakdown per class and section", category: "academic", icon: <GraduationCap className="w-4 h-4" />, color: "#4b9fd4" },
  { key: "student-attendance", label: "Student Attendance", description: "Individual student attendance records", category: "academic", icon: <Users className="w-4 h-4" />, color: "#8f7dd6" },
  { key: "teacher-attendance", label: "Teacher Attendance", description: "Individual teacher attendance records", category: "academic", icon: <UserCheck className="w-4 h-4" />, color: "#4aa87a" },
  // Account
  { key: "students-no-account", label: "Students Without Login Accounts", description: "Students who have not been assigned login credentials", category: "account", icon: <XCircle className="w-4 h-4" />, color: "#cc5069" },
  { key: "teachers-no-account", label: "Teachers Without Login Accounts", description: "Teachers who have not been assigned login credentials", category: "account", icon: <XCircle className="w-4 h-4" />, color: "#cc5069" },
  { key: "parents-no-account", label: "Parents Without Login Accounts", description: "Parents who have not been assigned login credentials", category: "account", icon: <XCircle className="w-4 h-4" />, color: "#cc5069" },
  { key: "pending-activations", label: "Pending Account Activations", description: "Accounts awaiting activation", category: "account", icon: <Clock className="w-4 h-4" />, color: "#c08a3a" },
  { key: "suspended-accounts", label: "Suspended Accounts", description: "All accounts currently suspended", category: "account", icon: <AlertTriangle className="w-4 h-4" />, color: "#cc5069" },
  { key: "inactive-accounts", label: "Inactive Accounts", description: "Accounts marked inactive", category: "account", icon: <AlertTriangle className="w-4 h-4" />, color: "#78788c" },
  // Platform
  { key: "active-users", label: "Active Users Report", description: "Users active within the selected date range", category: "platform", icon: <Activity className="w-4 h-4" />, color: "#4aa87a" },
  { key: "inactive-users", label: "Inactive Users Report", description: "Users who have not logged in recently", category: "platform", icon: <XCircle className="w-4 h-4" />, color: "#78788c" },
  { key: "login-report", label: "User Login Report", description: "Login history across all user types", category: "platform", icon: <TrendingUp className="w-4 h-4" />, color: "#4b9fd4" },
  { key: "platform-usage", label: "Platform Usage Report", description: "Feature usage and session analytics", category: "platform", icon: <BarChart2 className="w-4 h-4" />, color: "#8f7dd6" },
  // Communication
  { key: "announcement-delivery", label: "Announcement Delivery Report", description: "Delivery rates for all published announcements", category: "communication", icon: <Bell className="w-4 h-4" />, color: "#6366f1" },
  { key: "announcement-read", label: "Announcement Read Report", description: "Read rates and unread counts per announcement", category: "communication", icon: <CheckCircle2 className="w-4 h-4" />, color: "#4aa87a" },
];

const CATEGORIES: { key: ReportCategory; label: string; icon: React.ReactNode }[] = [
  { key: "academic", label: "Academic", icon: <GraduationCap className="w-4 h-4" /> },
  { key: "account", label: "Account", icon: <UserCheck className="w-4 h-4" /> },
  { key: "platform", label: "Platform", icon: <Activity className="w-4 h-4" /> },
  { key: "communication", label: "Communication", icon: <Bell className="w-4 h-4" /> },
];

// ── Report data generators ────────────────────────────────────────────────────

type Row = Record<string, string | number>;

function generateReportData(key: ReportKey, filters: Filters): { rows: Row[]; summary: { label: string; value: string | number; color: string }[] } {
  switch (key) {
    case "school-attendance": {
      const summary = [
        { label: "Total Students", value: adminStudents.length, color: "#6366f1" },
        { label: "Avg. Attendance", value: `${Math.round(adminStudents.reduce((s, x) => s + x.attendance, 0) / adminStudents.length)}%`, color: "#4aa87a" },
        { label: "Below 75%", value: adminStudents.filter((s) => s.attendance < 75).length, color: "#cc5069" },
        { label: "Above 90%", value: adminStudents.filter((s) => s.attendance >= 90).length, color: "#4b9fd4" },
      ];
      const rows = adminStudents.map((s) => ({ Name: s.fullName, Class: `${s.className}-${s.section}`, "Attendance %": s.attendance, Status: s.attendance >= 75 ? "OK" : "Low" }));
      return { rows, summary };
    }
    case "class-attendance": {
      const summary = adminClasses.map((c) => ({ label: c.name, value: `${Math.round(c.sections.reduce((s, sec) => s + sec.attendanceToday, 0) / c.sections.length)}%`, color: "#6366f1" }));
      const rows = adminClasses.flatMap((c) => c.sections.map((sec) => ({ Class: c.name, Section: sec.name, Students: sec.totalStudents, "Today Attendance %": sec.attendanceToday })));
      return { rows, summary };
    }
    case "student-attendance": {
      const filtered = applyStudentFilters(adminStudents, filters);
      const summary = [
        { label: "Students", value: filtered.length, color: "#6366f1" },
        { label: "Avg. Attendance", value: `${filtered.length ? Math.round(filtered.reduce((s, x) => s + x.attendance, 0) / filtered.length) : 0}%`, color: "#4aa87a" },
        { label: "Critical (<75%)", value: filtered.filter((s) => s.attendance < 75).length, color: "#cc5069" },
      ];
      const rows = filtered.map((s) => ({ "Admission No.": s.admissionNumber, Name: s.fullName, Class: `${s.className}-${s.section}`, "Attendance %": s.attendance, "Last Active": s.lastActive }));
      return { rows, summary };
    }
    case "teacher-attendance": {
      const summary = [
        { label: "Teachers", value: adminTeachers.length, color: "#6366f1" },
        { label: "Avg. Attendance", value: `${Math.round(adminTeachers.reduce((s, x) => s + x.attendance, 0) / adminTeachers.length)}%`, color: "#4aa87a" },
      ];
      const rows = adminTeachers.map((t) => ({ "Employee ID": t.employeeId, Name: t.fullName, Department: t.department, "Attendance %": t.attendance, Status: t.status }));
      return { rows, summary };
    }
    case "suspended-accounts": {
      const students = adminStudents.filter((s) => s.status === "suspended");
      const teachers = adminTeachers.filter((t) => t.status === "suspended");
      const parents = adminParents.filter((p) => p.status === "suspended");
      const summary = [
        { label: "Students", value: students.length, color: "#cc5069" },
        { label: "Teachers", value: teachers.length, color: "#cc5069" },
        { label: "Parents", value: parents.length, color: "#cc5069" },
        { label: "Total", value: students.length + teachers.length + parents.length, color: "#cc5069" },
      ];
      const rows: Row[] = [
        ...students.map((s) => ({ Type: "Student", Name: s.fullName, ID: s.admissionNumber, "Last Active": s.lastActive })),
        ...teachers.map((t) => ({ Type: "Teacher", Name: t.fullName, ID: t.employeeId, "Last Active": t.lastActive })),
        ...parents.map((p) => ({ Type: "Parent", Name: p.fullName, ID: p.id, "Last Active": p.lastLogin })),
      ];
      return { rows, summary };
    }
    case "inactive-accounts": {
      const students = adminStudents.filter((s) => s.status === "inactive");
      const teachers = adminTeachers.filter((t) => t.status === "inactive");
      const parents = adminParents.filter((p) => p.status === "inactive");
      const summary = [
        { label: "Students", value: students.length, color: "#78788c" },
        { label: "Teachers", value: teachers.length, color: "#78788c" },
        { label: "Parents", value: parents.length, color: "#78788c" },
      ];
      const rows: Row[] = [
        ...students.map((s) => ({ Type: "Student", Name: s.fullName, Class: `${s.className}-${s.section}`, "Last Active": s.lastActive })),
        ...teachers.map((t) => ({ Type: "Teacher", Name: t.fullName, Department: t.department, "Last Active": t.lastActive })),
        ...parents.map((p) => ({ Type: "Parent", Name: p.fullName, Occupation: p.occupation, "Last Login": p.lastLogin })),
      ];
      return { rows, summary };
    }
    case "active-users": {
      const activeStudents = adminStudents.filter((s) => s.status === "active");
      const activeTeachers = adminTeachers.filter((t) => t.status === "active");
      const activeParents = adminParents.filter((p) => p.status === "active");
      const summary = [
        { label: "Active Students", value: activeStudents.length, color: "#4aa87a" },
        { label: "Active Teachers", value: activeTeachers.length, color: "#4aa87a" },
        { label: "Active Parents", value: activeParents.length, color: "#4aa87a" },
        { label: "Total Active", value: activeStudents.length + activeTeachers.length + activeParents.length, color: "#4aa87a" },
      ];
      const rows: Row[] = [
        ...activeStudents.map((s) => ({ Type: "Student", Name: s.fullName, "Last Active": s.lastActive, Status: s.status })),
        ...activeTeachers.map((t) => ({ Type: "Teacher", Name: t.fullName, "Last Active": t.lastActive, Status: t.status })),
      ];
      return { rows, summary };
    }
    case "announcement-delivery": {
      const anns = [
        { title: "July 2026 Exam Schedule Released", recipients: 497, delivered: 491, read: 378, failed: 6 },
        { title: "Parent-Teacher Meeting — Aug 2", recipients: 231, delivered: 229, read: 184, failed: 2 },
        { title: "New AI Coach Features Available", recipients: 248, delivered: 245, read: 198, failed: 3 },
        { title: "Annual Sports Day Registration", recipients: 497, delivered: 490, read: 423, failed: 7 },
      ];
      const summary = [
        { label: "Total Sent", value: anns.reduce((s, a) => s + a.recipients, 0), color: "#6366f1" },
        { label: "Total Delivered", value: anns.reduce((s, a) => s + a.delivered, 0), color: "#4b9fd4" },
        { label: "Total Read", value: anns.reduce((s, a) => s + a.read, 0), color: "#4aa87a" },
        { label: "Total Failed", value: anns.reduce((s, a) => s + a.failed, 0), color: "#cc5069" },
      ];
      const rows = anns.map((a) => ({ Title: a.title, Recipients: a.recipients, Delivered: a.delivered, Read: a.read, Failed: a.failed, "Delivery %": `${Math.round((a.delivered / a.recipients) * 100)}%` }));
      return { rows, summary };
    }
    default: {
      const summary = [{ label: "Total Records", value: adminStudents.length + adminTeachers.length + adminParents.length, color: "#6366f1" }];
      const rows = adminStudents.slice(0, 10).map((s) => ({ Name: s.fullName, Type: "Student", Status: s.status }));
      return { rows, summary };
    }
  }
}

interface Filters {
  dateFrom: string;
  dateTo: string;
  classFilter: string;
  sectionFilter: string;
  studentFilter: string;
  teacherFilter: string;
}

function applyStudentFilters(students: typeof adminStudents, f: Filters) {
  let list = students;
  if (f.classFilter) list = list.filter((s) => s.className === f.classFilter);
  if (f.sectionFilter) list = list.filter((s) => s.section === f.sectionFilter);
  return list;
}

// ── Report Preview ────────────────────────────────────────────────────────────

function ReportPreview({
  report,
  filters,
  onClose,
}: {
  report: ReportDef;
  filters: Filters;
  onClose: () => void;
}) {
  const { rows, summary } = useMemo(() => generateReportData(report.key, filters), [report.key, filters]);

  function handleExport(format: "csv" | "print") {
    if (format === "csv") {
      exportCSV(report.label, rows);
    } else {
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const table = `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${headers.map((h) => `<td>${r[h]}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      printSection(report.label, table);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-[#0d0d0f] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-white/7">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${report.color}20`, color: report.color }}>
            {report.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">{report.label}</div>
            <div className="text-[10px] text-[#78788c]">{report.description}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleExport("csv")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button onClick={() => handleExport("print")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#78788c] hover:text-white bg-white/5 hover:bg-white/10 transition-all">
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button onClick={onClose} className="w-7 h-7 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all text-lg leading-none">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Filters applied */}
          {(filters.dateFrom || filters.dateTo || filters.classFilter) && (
            <div className="px-6 py-3 border-b border-white/5 flex items-center gap-3 flex-wrap">
              <span className="text-[10px] text-[#46465a] uppercase tracking-wider">Filters:</span>
              {filters.dateFrom && <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-[#78788c]">From: {filters.dateFrom}</span>}
              {filters.dateTo && <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-[#78788c]">To: {filters.dateTo}</span>}
              {filters.classFilter && <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-[#78788c]">Class: {filters.classFilter}</span>}
              {filters.sectionFilter && <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-[#78788c]">Section: {filters.sectionFilter}</span>}
            </div>
          )}

          {/* Summary cards */}
          <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {summary.map((s) => (
              <div key={s.label} className="p-4 rounded-2xl bg-[#131316] border border-white/7 text-center">
                <div className="text-2xl font-black tabular-nums" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[10px] text-[#78788c] mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="px-6 pb-6">
            <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
              {rows.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <FileText className="w-8 h-8 text-[#46465a]" />
                  <div className="text-sm text-[#78788c]">No data for selected filters</div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/7">
                        {Object.keys(rows[0]).map((col) => (
                          <th key={col} className="px-4 py-3 text-left text-[10px] font-bold text-[#78788c] uppercase tracking-wider whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {rows.map((row, i) => (
                        <tr key={i} className="hover:bg-white/2 transition-colors">
                          {Object.values(row).map((val, j) => (
                            <td key={j} className="px-4 py-3 text-xs text-[#c8c8d4] whitespace-nowrap">{String(val)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="mt-2 text-[10px] text-[#46465a] text-right">{rows.length} records · Generated {new Date().toLocaleString("en-IN")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Reports() {
  const [activeCategory, setActiveCategory] = useState<ReportCategory>("academic");
  const [activeReport, setActiveReport] = useState<ReportDef | null>(null);
  const [filters, setFilters] = useState<Filters>({ dateFrom: "", dateTo: "", classFilter: "", sectionFilter: "", studentFilter: "", teacherFilter: "" });
  const [showFilters, setShowFilters] = useState(false);

  const categoryReports = REPORTS.filter((r) => r.category === activeCategory);

  function resetFilters() {
    setFilters({ dateFrom: "", dateTo: "", classFilter: "", sectionFilter: "", studentFilter: "", teacherFilter: "" });
  }

  const hasActiveFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-5">
      {/* Filters bar */}
      <div className="bg-[#131316] border border-white/7 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setShowFilters((f) => !f)}
            className="flex items-center gap-2 text-sm font-semibold text-white hover:text-[#6366f1] transition-colors">
            <Filter className="w-4 h-4" />
            Report Filters
            {hasActiveFilters && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#6366f1]/20 text-[#6366f1]">Active</span>}
            <ChevronDown className={cn("w-4 h-4 transition-transform", showFilters && "rotate-180")} />
          </button>
          {hasActiveFilters && (
            <button onClick={resetFilters} className="text-xs text-[#cc5069] hover:underline">Clear All</button>
          )}
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { key: "dateFrom" as keyof Filters, label: "Date From", type: "date" },
              { key: "dateTo" as keyof Filters, label: "Date To", type: "date" },
            ].map(({ key, label, type }) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-[9px] font-bold text-[#78788c] uppercase tracking-wider">{label}</label>
                <input type={type} value={filters[key]} onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                  className="bg-white/5 border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#6366f1]/50" />
              </div>
            ))}

            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#78788c] uppercase tracking-wider">Class</label>
              <select value={filters.classFilter} onChange={(e) => setFilters((f) => ({ ...f, classFilter: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#6366f1]/50">
                <option value="">All Classes</option>
                {adminClasses.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#78788c] uppercase tracking-wider">Section</label>
              <select value={filters.sectionFilter} onChange={(e) => setFilters((f) => ({ ...f, sectionFilter: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#6366f1]/50">
                <option value="">All Sections</option>
                {["A", "B"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button key={cat.key} onClick={() => setActiveCategory(cat.key)}
            className={cn("flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all",
              activeCategory === cat.key ? "bg-[#6366f1]/15 text-[#6366f1] border border-[#6366f1]/25" : "bg-[#131316] border border-white/7 text-[#78788c] hover:text-white")}>
            {cat.icon} {cat.label}
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-[#46465a]">
              {REPORTS.filter((r) => r.category === cat.key).length}
            </span>
          </button>
        ))}
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {categoryReports.map((report) => {
          const { summary } = generateReportData(report.key, filters);
          const topStat = summary[0];
          return (
            <div key={report.key}
              className="bg-[#131316] border border-white/7 rounded-2xl p-5 hover:border-white/15 transition-all cursor-pointer group"
              onClick={() => setActiveReport(report)}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${report.color}20`, color: report.color }}>
                  {report.icon}
                </div>
                <div className="flex items-center gap-1 text-[#46465a] group-hover:text-[#6366f1] transition-colors">
                  <span className="text-xs">View Report</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-sm font-bold text-white mb-1">{report.label}</div>
              <div className="text-xs text-[#78788c] mb-4">{report.description}</div>
              {topStat && (
                <div className="flex items-center gap-2 pt-3 border-t border-white/5">
                  <div className="text-xl font-black tabular-nums" style={{ color: report.color }}>{topStat.value}</div>
                  <div className="text-xs text-[#78788c]">{topStat.label}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Preview modal */}
      {activeReport && (
        <ReportPreview report={activeReport} filters={filters} onClose={() => setActiveReport(null)} />
      )}
    </div>
  );
}
