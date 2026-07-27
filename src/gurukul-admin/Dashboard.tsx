import {
  GraduationCap, Users, UserCheck, Building2, Activity,
  AlertCircle, CheckCircle2, TrendingUp, TrendingDown,
  Bell, Plus, ChevronRight,
  BarChart2, UserPlus, ClipboardEdit,
} from "lucide-react";
import { cn, InitialsAvatar } from "./shared";
import type { AdminPageKey } from "./nav";
import {
  adminStats, recentActivities, pendingRequests, announcements,
  adminStudents, adminTeachers,
} from "./data";

function StatCard({
  label, value, sub, icon, color, delta,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; color: string; delta?: number;
}) {
  return (
    <div className="rounded-2xl border border-white/7 bg-[#131316] p-5 flex flex-col gap-3 hover:border-white/12 transition-all">
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
        <div className="text-2xl font-black tabular-nums text-white">{value}</div>
        <div className="text-xs font-semibold text-[#78788c] mt-0.5">{label}</div>
        {sub && <div className="text-[10px] text-[#46465a] mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function AttendanceBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-xs text-[#78788c] w-20 shrink-0">{label}</div>
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
      <div className="text-xs font-bold tabular-nums shrink-0" style={{ color }}>{value}%</div>
    </div>
  );
}

const activityColor: Record<string, string> = {
  student_added: "#4aa87a",
  teacher_added: "#3b5bdb",
  student_deleted: "#cc5069",
  teacher_deleted: "#cc5069",
  password_reset: "#c08a3a",
  class_changed: "#4b9fd4",
  student_promoted: "#6882e8",
  announcement: "#3b5bdb",
  suspension: "#cc5069",
};

const priorityColor: Record<string, string> = {
  high: "#cc5069",
  medium: "#c08a3a",
  low: "#4aa87a",
};

const TODAY_CLASSES = [
  { name: "Class 10-A", total: 42, present: 38, submitted: true },
  { name: "Class 10-B", total: 40, present: 35, submitted: true },
  { name: "Class 9-A", total: 45, present: 40, submitted: false },
  { name: "Class 9-B", total: 43, present: 0, submitted: false },
];

export default function AdminDashboard({ setPage }: { setPage: (p: AdminPageKey) => void }) {
  const stats = adminStats;
  const todayTotalStudents = TODAY_CLASSES.reduce((s, c) => s + c.total, 0);
  const todayPresent = TODAY_CLASSES.reduce((s, c) => s + c.present, 0);
  const todayAbsent = todayTotalStudents - todayPresent;
  const todayPct = Math.round((todayPresent / todayTotalStudents) * 100);

  return (
    <div className="space-y-6">
      {/* ── Quick Actions (TOP) ── */}
      <div className="bg-[#131316] border border-white/7 rounded-2xl p-4">
        <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider mb-3">Quick Actions</div>
        <div className="flex flex-wrap gap-2">
          {[
            { icon: <UserPlus className="w-4 h-4" />, label: "Add Student", color: "#3b5bdb", action: () => setPage("students") },
            { icon: <Plus className="w-4 h-4" />, label: "Add Teacher", color: "#4b9fd4", action: () => setPage("teachers") },
            { icon: <UserCheck className="w-4 h-4" />, label: "Add Parent", color: "#6882e8", action: () => setPage("parents") },
            { icon: <Bell className="w-4 h-4" />, label: "Create Announcement", color: "#c08a3a", action: () => setPage("announcements") },
            { icon: <ClipboardEdit className="w-4 h-4" />, label: "Edit Today's Attendance", color: "#4aa87a", action: () => setPage("classes") },
          ].map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl hover:bg-white/5 transition-all group border border-white/7 hover:border-white/12"
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all group-hover:scale-110"
                style={{ background: `${item.color}22`, color: item.color }}
              >
                {item.icon}
              </div>
              <span className="text-xs font-semibold text-[#78788c] group-hover:text-white transition-all">
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total Students" value={stats.totalStudents} icon={<GraduationCap className="w-5 h-5" />} color="#3b5bdb" delta={3} sub={`+${stats.newStudentsThisMonth} this month`} />
        <StatCard label="Total Teachers" value={stats.totalTeachers} icon={<Users className="w-5 h-5" />} color="#4b9fd4" delta={1} sub={`+${stats.newTeachersThisMonth} this month`} />
        <StatCard label="Total Parents" value={stats.totalParents} icon={<UserCheck className="w-5 h-5" />} color="#6882e8" />
        <StatCard label="Classes" value={stats.totalClasses} icon={<Building2 className="w-5 h-5" />} color="#4aa87a" sub="4 sections each" />
        <StatCard label="Active Today" value={stats.activeUsersToday} icon={<Activity className="w-5 h-5" />} color="#c08a3a" sub="students + teachers" />
        <StatCard label="Pending" value={stats.pendingRequests} icon={<AlertCircle className="w-5 h-5" />} color="#cc5069" sub={`${stats.pendingDoubts} doubts`} />
      </div>

      {/* Middle Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Attendance Summary */}
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-white">{"Today's Attendance"}</div>
            <button onClick={() => setPage("classes")} className="text-[10px] text-[#3b5bdb] hover:underline flex items-center gap-1">
              Edit <ClipboardEdit className="w-3 h-3" />
            </button>
          </div>
          {/* Summary totals */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/4 rounded-xl p-3 text-center">
              <div className="text-lg font-black text-white tabular-nums">{todayPresent}</div>
              <div className="text-[9px] text-[#4aa87a] font-bold uppercase tracking-wide mt-0.5">Present</div>
            </div>
            <div className="bg-white/4 rounded-xl p-3 text-center">
              <div className="text-lg font-black text-white tabular-nums">{todayAbsent}</div>
              <div className="text-[9px] text-[#cc5069] font-bold uppercase tracking-wide mt-0.5">Absent</div>
            </div>
            <div className="bg-white/4 rounded-xl p-3 text-center">
              <div className="text-lg font-black text-white tabular-nums">{todayPct}%</div>
              <div className="text-[9px] text-[#78788c] font-bold uppercase tracking-wide mt-0.5">Rate</div>
            </div>
          </div>
          {/* Per-class status */}
          <div className="space-y-2">
            {TODAY_CLASSES.map((cls) => {
              const pct = cls.submitted ? Math.round((cls.present / cls.total) * 100) : 0;
              return (
                <div key={cls.name} className="flex items-center gap-3">
                  <div className="text-[10px] text-[#78788c] w-20 shrink-0">{cls.name}</div>
                  {cls.submitted ? (
                    <>
                      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-[#3b5bdb]" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-[9px] font-bold text-[#3b5bdb] w-8 text-right shrink-0">{pct}%</div>
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#4aa87a] shrink-0" />
                    </>
                  ) : (
                    <>
                      <div className="flex-1 h-1.5 bg-white/5 rounded-full" />
                      <div className="text-[9px] font-bold text-[#46465a] w-8 text-right shrink-0">—</div>
                      <AlertCircle className="w-3.5 h-3.5 text-[#c08a3a] shrink-0" />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <AttendanceBar label="Teachers" value={stats.teacherAttendanceToday} color="#4aa87a" />
        </div>

        {/* Recent Students */}
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold text-white">Recent Students</div>
            <button onClick={() => setPage("students")} className="text-[10px] text-[#3b5bdb] hover:underline flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-3">
            {adminStudents.slice(0, 4).map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <InitialsAvatar name={s.fullName} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{s.fullName}</div>
                  <div className="text-[10px] text-[#78788c]">{s.className} {s.section} · {s.admissionNumber}</div>
                </div>
                <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                  s.status === "active" ? "bg-[#4aa87a22] text-[#4aa87a]" :
                  s.status === "suspended" ? "bg-[#cc506922] text-[#cc5069]" : "bg-white/5 text-[#78788c]"
                )}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Teachers */}
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold text-white">Recent Teachers</div>
            <button onClick={() => setPage("teachers")} className="text-[10px] text-[#3b5bdb] hover:underline flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-3">
            {adminTeachers.slice(0, 4).map((t) => (
              <div key={t.id} className="flex items-center gap-3">
                <InitialsAvatar name={t.fullName} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{t.fullName}</div>
                  <div className="text-[10px] text-[#78788c]">{t.department} · {t.employeeId}</div>
                </div>
                <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                  t.status === "active" ? "bg-[#4aa87a22] text-[#4aa87a]" : "bg-white/5 text-[#78788c]"
                )}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity Log */}
        <div className="lg:col-span-1 bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="text-sm font-bold text-white mb-4">Recent Activity</div>
          <div className="space-y-3">
            {recentActivities.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <div
                  className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                  style={{ background: activityColor[a.type] ?? "#78788c" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white">{a.description}</div>
                  <div className="text-[10px] text-[#78788c] truncate">{a.target}</div>
                </div>
                <div className="text-[9px] text-[#46465a] shrink-0">{a.ago}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Pending Requests */}
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="text-sm font-bold text-white mb-4">Pending Requests</div>
          <div className="space-y-3">
            {pendingRequests.map((r) => (
              <div key={r.id} className="flex items-start gap-3 p-3 rounded-xl bg-white/3 hover:bg-white/5 transition-all cursor-pointer">
                <div
                  className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                  style={{ background: priorityColor[r.priority] }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white">{r.title}</div>
                  <div className="text-[10px] text-[#78788c]">{r.from} · {r.time}</div>
                </div>
                <span
                  className="text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase shrink-0"
                  style={{ background: `${priorityColor[r.priority]}22`, color: priorityColor[r.priority] }}
                >
                  {r.priority}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right column: Announcements + Quick Actions */}
        <div className="flex flex-col gap-4">
          {/* Announcements */}
          <div className="bg-[#131316] border border-white/7 rounded-2xl p-5 flex-1">
            <div className="flex items-center gap-2 mb-4">
              <Bell className="w-4 h-4 text-[#3b5bdb]" />
              <div className="text-sm font-bold text-white">Announcements</div>
            </div>
            <div className="space-y-3">
              {announcements.map((a) => (
                <div key={a.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    {a.pinned && <span className="text-[8px] font-bold text-[#3b5bdb] uppercase">Pinned</span>}
                    <div className="text-xs font-semibold text-white">{a.title}</div>
                  </div>
                  <div className="text-[10px] text-[#78788c]">{a.content}</div>
                  <div className="text-[9px] text-[#46465a]">{a.date} · For {a.audience}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Reports shortcut */}
          <div className="bg-[#131316] border border-white/7 rounded-2xl p-4">
            <button onClick={() => setPage("reports")} className="w-full flex items-center gap-3 group">
              <div className="w-9 h-9 rounded-xl bg-[#4aa87a22] flex items-center justify-center group-hover:scale-110 transition-all">
                <BarChart2 className="w-4 h-4 text-[#4aa87a]" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-white">View Reports</div>
                <div className="text-[10px] text-[#78788c]">16 reports across all categories</div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-[#46465a] ml-auto group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
