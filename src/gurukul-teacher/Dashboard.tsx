import {
  BookOpen, ClipboardList, CheckSquare, MessageCircle, Calendar,
  Clock, AlertCircle, ChevronRight, Users, FileText, HelpCircle,
} from "lucide-react";
import { cn } from "./shared";
import {
  assignedClasses, homeworkByClass, assignmentsByClass, testsByClass, teacherDoubts, teacherMessages,
} from "./data";
import type { TeacherPageKey } from "./nav";

function QuickAction({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-white/7 bg-[#131316] hover:border-white/15 hover:bg-white/3 transition-all group text-center">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-all group-hover:scale-110" style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      <div className="text-[10px] font-semibold text-[#78788c] group-hover:text-white transition-all leading-tight">{label}</div>
    </button>
  );
}

function StatCard({ icon, label, value, color, sublabel }: { icon: React.ReactNode; label: string; value: number | string; color: string; sublabel?: string }) {
  return (
    <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-black text-white tabular-nums">{value}</div>
        <div className="text-[10px] text-[#78788c] font-medium mt-0.5">{label}</div>
        {sublabel && <div className="text-[9px] text-[#46465a] mt-0.5">{sublabel}</div>}
      </div>
    </div>
  );
}

export default function TeacherHome({ setPage }: { setPage: (p: TeacherPageKey) => void }) {
  // Computed stats
  const totalStudents = assignedClasses.reduce((s, c) => s + c.studentCount, 0);

  const allHw = Object.values(homeworkByClass).flat();
  const hwPending = allHw.filter((h) => h.status === "active" && h.pending > 0).length;

  const allAsgn = Object.values(assignmentsByClass).flat();
  const asgnPendingGrade = allAsgn.reduce((s, a) => s + (a.submitted - a.graded), 0);

  const allTests = Object.values(testsByClass).flat();
  const testsPendingMarks = allTests.filter((t) => t.status === "completed" && !t.marksPublished).length;

  const openDoubts = teacherDoubts.filter((d) => d.status === "open").length;
  const unreadMsgs = teacherMessages.reduce((s, m) => s + m.unreadCount, 0);

  const today = new Date().toISOString().split("T")[0];
  const todayDay = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const todayClasses = assignedClasses.filter((c) => c.schedule.some((s) => s.day === todayDay));

  const upcomingTests = allTests.filter((t) => t.status === "scheduled" && t.testDate >= today).slice(0, 3);

  const recentDoubts = teacherDoubts.filter((d) => d.status === "open").slice(0, 3);
  const recentMsgs = teacherMessages.slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="bg-gradient-to-r from-[#3b5bdb]/10 to-[#f59e0b]/5 border border-[#3b5bdb]/20 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
          <span className="text-lg font-black text-white">AR</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-black text-white">Good morning, Mrs. Ananya Rajan</div>
          <div className="text-xs text-[#78788c] mt-0.5">
            {todayClasses.length > 0
              ? `You have ${todayClasses.length} class${todayClasses.length > 1 ? "es" : ""} scheduled today`
              : "No classes scheduled today"}
            {" · "}{totalStudents} students across {assignedClasses.length} classes
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-bold text-[#3b5bdb]">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-3">Quick Actions</div>
        <div className="grid grid-cols-4 gap-3">
          <QuickAction icon={<Users className="w-5 h-5" />} label="Mark Attendance" color="#f59e0b" onClick={() => setPage("myclasses")} />
          <QuickAction icon={<BookOpen className="w-5 h-5" />} label="Create Homework" color="#10b981" onClick={() => setPage("myclasses")} />
          <QuickAction icon={<ClipboardList className="w-5 h-5" />} label="Create Test" color="#6366f1" onClick={() => setPage("myclasses")} />
          <QuickAction icon={<FileText className="w-5 h-5" />} label="Apply for Leave" color="#78788c" onClick={() => setPage("leave")} />
        </div>
      </div>

      {/* Pending Items */}
      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-3">Pending Items</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<BookOpen className="w-5 h-5" />} label="Homework Reviews" value={hwPending} color="#f59e0b" sublabel="Active homeworks with pending" />
          <StatCard icon={<CheckSquare className="w-5 h-5" />} label="Assignments to Grade" value={asgnPendingGrade} color="#10b981" sublabel="Submissions awaiting grading" />
          <StatCard icon={<ClipboardList className="w-5 h-5" />} label="Tests Pending Marks" value={testsPendingMarks} color="#6366f1" sublabel="Tests without marks entry" />
          <StatCard icon={<HelpCircle className="w-5 h-5" />} label="Open Doubts" value={openDoubts} color="#cc5069" sublabel="Student doubts awaiting reply" />
        </div>
      </div>

      {/* Today's Classes */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/7">
            <Calendar className="w-4 h-4 text-[#3b5bdb]" />
            <div className="text-sm font-bold text-white">Today&apos;s Classes</div>
            <span className="ml-auto text-[9px] font-bold text-[#3b5bdb] bg-[#3b5bdb]/10 px-1.5 py-0.5 rounded-full">{todayClasses.length}</span>
          </div>
          <div className="p-3 space-y-2">
            {todayClasses.length === 0 && (
              <div className="text-center py-4 text-xs text-[#46465a]">No classes today</div>
            )}
            {todayClasses.map((c) => {
              const slot = c.schedule.find((s) => s.day === todayDay);
              return (
                <button key={c.id} onClick={() => setPage("myclasses")}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/3 hover:bg-white/6 transition-all text-left group">
                  <div className="w-8 h-8 rounded-lg bg-[#3b5bdb]/15 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4 text-[#3b5bdb]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-white">{c.className} {c.section} — {c.subject}</div>
                    <div className="flex items-center gap-1 mt-0.5 text-[10px] text-[#78788c]">
                      <Clock className="w-2.5 h-2.5" />
                      {slot?.time}
                    </div>
                  </div>
                  {c.isClassTeacher && <span className="text-[8px] font-bold text-[#3b5bdb] bg-[#3b5bdb]/10 px-1.5 py-0.5 rounded-full shrink-0">CT</span>}
                  <ChevronRight className="w-3 h-3 text-[#46465a] group-hover:text-white transition-all" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Upcoming Tests */}
        <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/7">
            <ClipboardList className="w-4 h-4 text-[#6366f1]" />
            <div className="text-sm font-bold text-white">Upcoming Tests</div>
          </div>
          <div className="p-3 space-y-2">
            {upcomingTests.length === 0 && (
              <div className="text-center py-4 text-xs text-[#46465a]">No upcoming tests</div>
            )}
            {upcomingTests.map((t) => (
              <button key={t.id} onClick={() => setPage("myclasses")}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/3 hover:bg-white/6 transition-all text-left group">
                <div className="w-8 h-8 rounded-lg bg-[#6366f1]/15 flex items-center justify-center shrink-0">
                  <ClipboardList className="w-4 h-4 text-[#6366f1]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white">{t.testName}</div>
                  <div className="text-[10px] text-[#78788c] mt-0.5">{t.className} {t.section} · {t.subject}</div>
                  <div className="flex items-center gap-1 mt-0.5 text-[10px] text-[#46465a]">
                    <Calendar className="w-2.5 h-2.5" /> {t.testDate} · {t.startTime}
                  </div>
                </div>
                <ChevronRight className="w-3 h-3 text-[#46465a] group-hover:text-white transition-all" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Doubts + Messages */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/7">
            <HelpCircle className="w-4 h-4 text-[#cc5069]" />
            <div className="text-sm font-bold text-white">Recent Doubts</div>
            {openDoubts > 0 && (
              <span className="ml-auto text-[9px] font-bold text-white bg-[#cc5069] px-1.5 py-0.5 rounded-full">{openDoubts}</span>
            )}
          </div>
          <div className="p-3 space-y-2">
            {recentDoubts.length === 0 && (
              <div className="text-center py-4 text-xs text-[#46465a]">No open doubts</div>
            )}
            {recentDoubts.map((d) => (
              <button key={d.id} onClick={() => setPage("doubts")}
                className="w-full flex items-start gap-3 p-3 rounded-xl bg-white/3 hover:bg-white/6 transition-all text-left group">
                <AlertCircle className="w-4 h-4 text-[#cc5069] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white truncate">{d.studentName}</div>
                  <div className="text-[10px] text-[#78788c] line-clamp-2 mt-0.5">{d.question}</div>
                  <div className="text-[9px] text-[#46465a] mt-1">{d.subject} · {d.askedAt}</div>
                </div>
              </button>
            ))}
            {openDoubts > 3 && (
              <button onClick={() => setPage("doubts")} className="w-full text-center text-[10px] text-[#3b5bdb] hover:underline py-1">
                View all {openDoubts} open doubts →
              </button>
            )}
          </div>
        </div>

        <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/7">
            <MessageCircle className="w-4 h-4 text-[#10b981]" />
            <div className="text-sm font-bold text-white">Recent Messages</div>
            {unreadMsgs > 0 && (
              <span className="ml-auto text-[9px] font-bold text-white bg-[#10b981] px-1.5 py-0.5 rounded-full">{unreadMsgs}</span>
            )}
          </div>
          <div className="p-3 space-y-2">
            {recentMsgs.map((m) => (
              <button key={m.id} onClick={() => setPage("communication")}
                className={cn("w-full flex items-start gap-3 p-3 rounded-xl transition-all text-left group",
                  m.unreadCount > 0 ? "bg-[#10b981]/5 hover:bg-[#10b981]/8" : "bg-white/3 hover:bg-white/6")}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-[9px] font-black"
                  style={{ background: m.participantRole === "parent" ? "#f59e0b18" : m.participantRole === "principal" ? "#6366f118" : "#10b98118", color: m.participantRole === "parent" ? "#f59e0b" : m.participantRole === "principal" ? "#6366f1" : "#10b981" }}>
                  {m.participantName.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-bold text-white truncate">{m.participantName}</div>
                    {m.unreadCount > 0 && <div className="w-1.5 h-1.5 rounded-full bg-[#10b981] shrink-0" />}
                  </div>
                  <div className="text-[10px] text-[#78788c] truncate mt-0.5">{m.lastMessage}</div>
                  <div className="text-[9px] text-[#46465a] mt-0.5">{m.lastTimestamp}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
