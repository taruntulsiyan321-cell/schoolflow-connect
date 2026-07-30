import {
  UserCheck, BookOpen, ClipboardList, Bell, MessageSquare,
  ChevronRight, TrendingUp, TrendingDown,
  CheckCircle2, AlertCircle,
} from "lucide-react";
import { cn, GradeChip } from "./shared";
import type { Child } from "./data";
import {
  children as childrenList,
  homeworkByChild, testResultsByChild, examinationsByChild,
  parentAnnouncements, parentNotifications, academicInsightsByChild,
} from "./data";
import type { ParentPageKey } from "./nav";
import { useChildAttendancePct, useParentLiveChildren } from "./ParentLiveAttendance";

function QuickStat({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-lg font-black tabular-nums text-white">{value}</div>
        <div className="text-[10px] font-semibold text-[#78788c]">{label}</div>
        {sub && <div className="text-[9px] text-[#46465a]">{sub}</div>}
      </div>
    </div>
  );
}

function ChildSelector({ activeId, setActiveId }: { activeId: string; setActiveId: (id: string) => void }) {
  const { children: live } = useParentLiveChildren();
  const children = live.length
    ? live.map((c) => ({ id: c.id, name: c.fullName, className: c.classLabel, section: "" }))
    : childrenList.map((c) => ({ id: c.id, name: c.name, className: c.className, section: c.section }));
  if (children.length <= 1) return null;
  return (
    <div className="flex gap-2">
      {children.map((c) => (
        <button key={c.id} onClick={() => setActiveId(c.id)}
          className={cn("flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all",
            activeId === c.id
              ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30 text-[#3b5bdb]"
              : "bg-[#131316] border-white/7 text-[#78788c] hover:border-white/15")}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-black"
            style={{ background: activeId === c.id ? "#3b5bdb30" : "#ffffff18", color: activeId === c.id ? "#3b5bdb" : "#78788c" }}>
            {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </div>
          <div className="text-left">
            <div className="text-xs font-bold leading-none">{c.name}</div>
            <div className="text-[9px] opacity-60 mt-0.5">{c.className}{c.section ? ` · ${c.section}` : ""}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

export default function ParentDashboard({
  child, setPage, activeChildId, setActiveChildId,
}: {
  child: Child;
  setPage: (p: ParentPageKey) => void;
  activeChildId: string;
  setActiveChildId: (id: string) => void;
}) {
  const { children: liveChildren } = useParentLiveChildren();
  const liveChild = liveChildren.find((c) => c.id === activeChildId) ?? liveChildren[0];
  const attendanceId = liveChild?.id ?? null;
  const { pct: attendancePct, present: presentDays, total: schoolDays, todayStatus } =
    useChildAttendancePct(attendanceId);

  const hw = homeworkByChild[child.id] ?? [];
  const tests = testResultsByChild[child.id] ?? [];
  const exams = examinationsByChild[child.id] ?? [];
  const insights = academicInsightsByChild[child.id];

  const pendingHw = hw.filter((h) => h.submissionStatus === "pending" || h.submissionStatus === "late");
  const dueToday = hw.filter((h) => h.dueDate === "2026-07-26" && h.submissionStatus === "pending");
  const lastTest = tests[0];
  const nextExam = exams.find((e) => !e.resultPublished);
  const unreadNotifications = parentNotifications.filter((n) => !n.read).length;

  const displayName = liveChild?.fullName ?? child.name;
  const displayClass = liveChild?.classLabel ?? `${child.className} · Section ${child.section}`;
  const displayRoll = liveChild?.rollNumber ?? child.rollNumber;

  return (
    <div className="space-y-6">
      <ChildSelector activeId={activeChildId} setActiveId={setActiveChildId} />

      <div className="bg-gradient-to-br from-[#131316] to-[#0d1a14] border border-[#3b5bdb]/15 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
          <span className="text-lg font-black text-white">{displayName.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-black text-white">{displayName}</div>
          <div className="text-xs text-[#78788c] mt-0.5">{displayClass} · Roll No. {displayRoll}</div>
          <div className="text-[10px] text-[#46465a] mt-0.5">{child.school} · {child.academicYear}</div>
        </div>
        <div className="text-right shrink-0">
          <div className={cn("text-xs font-bold px-3 py-1.5 rounded-xl capitalize",
            todayStatus === "present" || todayStatus === "late" ? "bg-[#3b5bdb]/15 text-[#3b5bdb]"
            : todayStatus === "absent" ? "bg-[#cc5069]/15 text-[#cc5069]"
            : "bg-white/8 text-[#78788c]"
          )}>
            {todayStatus ? `${todayStatus.replace("_", " ")} today` : "Not marked today"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickStat label="Attendance" value={`${attendancePct}%`} sub={`${presentDays}/${schoolDays} days`} color="#3b5bdb" icon={<UserCheck className="w-5 h-5" />} />
        <QuickStat label="Overall Score" value={`${insights?.overallPercentage ?? 0}%`} sub={`Rank ${insights?.classRank ?? "—"} of ${insights?.totalStudents ?? "—"}`} color="#6366f1" icon={<TrendingUp className="w-5 h-5" />} />
        <QuickStat label="Pending Homework" value={pendingHw.length} sub={`${dueToday.length} due today`} color={pendingHw.length > 0 ? "#c08a3a" : "#3b5bdb"} icon={<BookOpen className="w-5 h-5" />} />
        <QuickStat label="Notifications" value={unreadNotifications} sub="unread" color={unreadNotifications > 0 ? "#cc5069" : "#78788c"} icon={<Bell className="w-5 h-5" />} />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Academic Snapshot */}
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-white">Academic Snapshot</div>
            <button onClick={() => setPage("children")} className="text-[10px] text-[#3b5bdb] hover:underline flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-3">
            {(insights?.subjectPerformance ?? []).slice(0, 4).map((s) => (
              <div key={s.subject} className="flex items-center gap-3">
                <div className="text-[10px] text-[#78788c] w-20 shrink-0 truncate">{s.subject}</div>
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${s.score}%`, background: s.score >= 85 ? "#3b5bdb" : s.score >= 70 ? "#6366f1" : "#c08a3a" }} />
                </div>
                <div className="text-[10px] font-bold tabular-nums text-white w-8 text-right shrink-0">{s.score}%</div>
                <div className="shrink-0">
                  {s.trend === "up" ? <TrendingUp className="w-3 h-3 text-[#3b5bdb]" /> : s.trend === "down" ? <TrendingDown className="w-3 h-3 text-[#cc5069]" /> : <div className="w-3 h-3" />}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Latest Test Result */}
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold text-white">Latest Test Result</div>
            <button onClick={() => setPage("children")} className="text-[10px] text-[#3b5bdb] hover:underline flex items-center gap-1">
              All results <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          {lastTest ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white">{lastTest.testName}</div>
                  <div className="text-[10px] text-[#78788c]">{lastTest.subject} · {lastTest.testDate}</div>
                </div>
                <GradeChip grade={lastTest.grade} />
              </div>
              <div className="flex items-center gap-3">
                <div className="text-2xl font-black text-white tabular-nums">{lastTest.marksObtained}<span className="text-sm font-normal text-[#46465a]">/{lastTest.totalMarks}</span></div>
                <div className="flex-1">
                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#3b5bdb]" style={{ width: `${lastTest.percentage}%` }} />
                  </div>
                  <div className="text-[9px] text-[#78788c] mt-1">Class avg: {lastTest.classAverage}/{lastTest.totalMarks}</div>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/3">
                <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-1">Teacher Remarks</div>
                <div className="text-xs text-[#78788c] italic">"{lastTest.teacherRemarks}"</div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-[#78788c] text-center pt-6">No test results yet</div>
          )}
        </div>

        {/* Homework Due Today */}
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold text-white">Homework Due Today</div>
            <button onClick={() => setPage("children")} className="text-[10px] text-[#3b5bdb] hover:underline flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          {dueToday.length > 0 ? (
            <div className="space-y-2">
              {dueToday.map((h) => (
                <div key={h.id} className="flex items-start gap-3 p-3 rounded-xl bg-white/3">
                  <AlertCircle className="w-3.5 h-3.5 text-[#c08a3a] mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white truncate">{h.title}</div>
                    <div className="text-[10px] text-[#78788c]">{h.subject}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-6">
              <CheckCircle2 className="w-8 h-8 text-[#3b5bdb]/30" />
              <div className="text-xs text-[#78788c]">No homework due today</div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Upcoming Examination */}
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="w-4 h-4 text-[#6366f1]" />
            <div className="text-sm font-bold text-white">Upcoming Examination</div>
          </div>
          {nextExam ? (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-bold text-white">{nextExam.name}</div>
                <div className="text-[10px] text-[#78788c]">{nextExam.type} · {nextExam.startDate} – {nextExam.endDate}</div>
              </div>
              <div className="space-y-1.5">
                {nextExam.schedule.slice(0, 3).map((s) => (
                  <div key={s.subject} className="flex items-center justify-between text-[10px]">
                    <span className="text-[#78788c]">{s.subject}</span>
                    <span className="text-white">{s.date}</span>
                  </div>
                ))}
                {nextExam.schedule.length > 3 && (
                  <div className="text-[9px] text-[#46465a]">+{nextExam.schedule.length - 3} more subjects</div>
                )}
              </div>
              <div className="p-2 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20">
                <div className="text-[9px] text-[#a5b4fc] leading-relaxed">{nextExam.instructions.slice(0, 100)}…</div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-[#78788c] text-center pt-6">No upcoming examinations</div>
          )}
        </div>

        {/* Recent Announcements */}
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#c08a3a]" />
              <div className="text-sm font-bold text-white">Announcements</div>
            </div>
            <button onClick={() => setPage("announcements")} className="text-[10px] text-[#3b5bdb] hover:underline flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-3">
            {parentAnnouncements.slice(0, 3).map((a) => (
              <div key={a.id} className="space-y-0.5">
                <div className="flex items-center gap-2">
                  {!a.read && <div className="w-1.5 h-1.5 rounded-full bg-[#c08a3a] shrink-0" />}
                  <div className="text-xs font-semibold text-white">{a.title}</div>
                </div>
                <div className="text-[10px] text-[#46465a] pl-3.5">{a.from} · {a.date}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
          <div className="text-sm font-bold text-white mb-4">Quick Actions</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "View Attendance", icon: <UserCheck className="w-4 h-4" />, color: "#3b5bdb", page: "children" as ParentPageKey },
              { label: "Homework", icon: <BookOpen className="w-4 h-4" />, color: "#c08a3a", page: "children" as ParentPageKey },
              { label: "Message Teacher", icon: <MessageSquare className="w-4 h-4" />, color: "#6366f1", page: "messages" as ParentPageKey },
              { label: "Announcements", icon: <Bell className="w-4 h-4" />, color: "#8f7dd6", page: "announcements" as ParentPageKey },
              { label: "Exam Schedule", icon: <ClipboardList className="w-4 h-4" />, color: "#4b9fd4", page: "children" as ParentPageKey },
              { label: "Notifications", icon: <Bell className="w-4 h-4" />, color: "#cc5069", page: "notifications" as ParentPageKey },
            ].map((item) => (
              <button key={item.label} onClick={() => setPage(item.page)}
                className="flex items-center gap-2 p-2.5 rounded-xl bg-white/3 hover:bg-white/6 transition-all text-left group">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform"
                  style={{ background: `${item.color}18`, color: item.color }}>
                  {item.icon}
                </div>
                <span className="text-[10px] font-semibold text-[#78788c] group-hover:text-white transition-all leading-tight">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
