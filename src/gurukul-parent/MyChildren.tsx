import { useState } from "react";
import {
  ChevronDown, ChevronLeft, ChevronRight, Search, Filter,
  Calendar, BookOpen, ClipboardList, TrendingUp, BarChart2,
  CheckCircle2, AlertCircle, Clock, Download, Eye,
  User, GraduationCap, Users,
} from "lucide-react";
import { cn, InitialsAvatar, GradeChip, ScoreBar, Card, ACCENT } from "./shared";
import {
  children, attendanceByChild, homeworkByChild, testResultsByChild,
  examinationsByChild, academicInsightsByChild, type Child,
  type AttendanceDayStatus,
} from "./data";

type ChildTab = "profile" | "attendance" | "homework" | "exams";

// ── Helpers ───────────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("text-[10px] font-semibold px-3 py-1.5 rounded-xl whitespace-nowrap transition-all",
        active ? "bg-[#3b5bdb]/15 text-[#3b5bdb] border border-[#3b5bdb]/25" : "text-[#78788c] hover:text-white border border-transparent")}>
      {children}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 p-3 rounded-xl bg-white/3">
      <div className="text-[9px] text-[#46465a] uppercase tracking-wider">{label}</div>
      <div className="text-xs text-white">{value}</div>
    </div>
  );
}

// ── Attendance Calendar ───────────────────────────────────────────────────────

function AttendanceCalendar({ data }: { data: AttendanceDayStatus[] }) {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const present = data.filter((d) => d.status === "present").length;
  const absent = data.filter((d) => d.status === "absent").length;
  const schoolDays = present + absent;
  const pct = schoolDays ? Math.round((present / schoolDays) * 100) : 0;

  const firstDate = new Date(data[0]?.date ?? "2026-07-01");
  const startDow = (firstDate.getDay() + 6) % 7; // Mon=0

  const statusColor: Record<string, string> = {
    present: "#3b5bdb",
    absent: "#cc5069",
    holiday: "#c08a3a",
    half_day: "#6366f1",
    weekend: "#1e1e24",
  };

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#3b5bdb]/10 border border-[#3b5bdb]/20 rounded-xl p-3 text-center">
          <div className="text-lg font-black text-[#3b5bdb]">{present}</div>
          <div className="text-[9px] text-[#3b5bdb] uppercase tracking-wide font-bold">Present</div>
        </div>
        <div className="bg-[#cc5069]/10 border border-[#cc5069]/20 rounded-xl p-3 text-center">
          <div className="text-lg font-black text-[#cc5069]">{absent}</div>
          <div className="text-[9px] text-[#cc5069] uppercase tracking-wide font-bold">Absent</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
          <div className="text-lg font-black text-white">{pct}%</div>
          <div className="text-[9px] text-[#78788c] uppercase tracking-wide font-bold">Rate</div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {[["present", "#3b5bdb", "Present"], ["absent", "#cc5069", "Absent"], ["holiday", "#c08a3a", "Holiday"], ["half_day", "#6366f1", "Half Day"]].map(([k, c, l]) => (
          <div key={k} className="flex items-center gap-1.5 text-[10px] text-[#78788c]">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
            {l}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {weekdays.map((d) => <div key={d} className="text-[8px] text-[#46465a] text-center font-bold">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: startDow }).map((_, i) => <div key={`empty-${i}`} />)}
          {data.map((day) => {
            const d = parseInt(day.date.split("-")[2]);
            return (
              <div key={day.date} title={`${day.date}: ${day.status}`}
                className="aspect-square rounded-md flex items-center justify-center text-[9px] font-bold transition-all hover:scale-110 cursor-default"
                style={{ background: `${statusColor[day.status]}30`, color: statusColor[day.status] }}>
                {d}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Homework Tab ──────────────────────────────────────────────────────────────

function HomeworkTab({ childId }: { childId: string }) {
  const [filter, setFilter] = useState<"all" | "pending" | "submitted" | "graded">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "homework" | "assignment">("all");
  const items = (homeworkByChild[childId] ?? []).filter((h) => {
    if (filter !== "all" && h.submissionStatus !== filter) return false;
    if (typeFilter !== "all" && h.type !== typeFilter) return false;
    return true;
  });

  const statusColor: Record<string, string> = {
    pending: "#c08a3a", submitted: "#3b5bdb", late: "#cc5069", graded: "#6366f1",
  };
  const statusLabel: Record<string, string> = {
    pending: "Pending", submitted: "Submitted", late: "Late", graded: "Graded",
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "submitted", "graded"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("text-[10px] font-semibold px-3 py-1 rounded-lg capitalize transition-all",
              filter === f ? "bg-[#3b5bdb]/15 text-[#3b5bdb]" : "bg-white/5 text-[#78788c] hover:text-white")}>
            {f === "all" ? "All" : statusLabel[f]}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {(["all", "homework", "assignment"] as const).map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={cn("text-[10px] font-semibold px-3 py-1 rounded-lg capitalize transition-all",
                typeFilter === t ? "bg-[#6366f1]/15 text-[#6366f1]" : "bg-white/5 text-[#78788c] hover:text-white")}>
              {t === "all" ? "All Types" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 && (
        <div className="text-center py-8 text-xs text-[#78788c]">No items found</div>
      )}

      <div className="space-y-2">
        {items.map((h) => (
          <div key={h.id} className="p-4 rounded-2xl bg-white/3 hover:bg-white/5 transition-all border border-white/5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[#6366f1]/15 text-[#a5b4fc]">{h.type}</span>
                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ background: `${statusColor[h.submissionStatus]}18`, color: statusColor[h.submissionStatus] }}>
                    {statusLabel[h.submissionStatus]}
                  </span>
                </div>
                <div className="text-sm font-semibold text-white">{h.title}</div>
                <div className="text-[10px] text-[#78788c] mt-0.5">{h.subject}</div>
                <div className="text-[10px] text-[#46465a] mt-1">{h.description}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] text-[#78788c]">Due</div>
                <div className="text-xs font-bold text-white">{h.dueDate}</div>
                {h.marks !== undefined && (
                  <div className="text-xs font-bold text-[#3b5bdb] mt-1">{h.marks}/{h.totalMarks}</div>
                )}
              </div>
            </div>
            <div className="mt-3 p-2.5 rounded-xl bg-white/3">
              <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-1">Teacher Instructions</div>
              <div className="text-[10px] text-[#78788c]">{h.teacherInstructions}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Examinations Tab ──────────────────────────────────────────────────────────

function ExaminationsTab({ childId }: { childId: string }) {
  const exams = examinationsByChild[childId] ?? [];
  const [selected, setSelected] = useState<string | null>(exams[0]?.id ?? null);
  const exam = exams.find((e) => e.id === selected);

  return (
    <div className="space-y-4">
      {/* Exam switcher */}
      <div className="flex gap-2 flex-wrap">
        {exams.map((e) => (
          <button key={e.id} onClick={() => setSelected(e.id)}
            className={cn("text-xs font-semibold px-4 py-2 rounded-xl transition-all",
              selected === e.id ? "bg-[#3b5bdb]/15 text-[#3b5bdb] border border-[#3b5bdb]/25" : "bg-white/5 text-[#78788c] hover:text-white border border-transparent")}>
            {e.name}
            {e.resultPublished && <span className="ml-1.5 text-[8px] uppercase bg-[#3b5bdb]/20 text-[#3b5bdb] px-1 py-0.5 rounded-full">Results</span>}
          </button>
        ))}
      </div>

      {exam && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-[#6366f1]/8 border border-[#6366f1]/15">
            <div className="text-sm font-bold text-white">{exam.name}</div>
            <div className="text-[10px] text-[#78788c] mt-0.5">{exam.type} · {exam.startDate} – {exam.endDate}</div>
            <div className="mt-3 text-[10px] text-[#a5b4fc] leading-relaxed">{exam.instructions}</div>
          </div>

          {/* Schedule */}
          {!exam.resultPublished && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Examination Timetable</div>
              {exam.schedule.map((s) => (
                <div key={s.subject} className="flex items-center gap-3 p-3 rounded-xl bg-white/3 hover:bg-white/5 transition-all">
                  <div className="w-8 h-8 rounded-lg bg-[#6366f1]/15 flex items-center justify-center shrink-0">
                    <BookOpen className="w-3.5 h-3.5 text-[#6366f1]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white">{s.subject}</div>
                    <div className="text-[10px] text-[#78788c]">{s.time} · {s.duration}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-white">{s.date}</div>
                    <div className="text-[9px] text-[#46465a]">{s.maxMarks} marks</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Published results */}
          {exam.resultPublished && exam.results && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Published Results</div>
              {exam.results.map((r) => (
                <div key={r.subject} className="flex items-center gap-3 p-3 rounded-xl bg-white/3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white">{r.subject}</div>
                    <ScoreBar value={r.marksObtained} max={r.totalMarks} color="#3b5bdb" />
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <div className="text-xs font-bold text-white">{r.marksObtained}/{r.totalMarks}</div>
                    <GradeChip grade={r.grade} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Test Results Tab ──────────────────────────────────────────────────────────

function TestResultsTab({ childId }: { childId: string }) {
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const results = testResultsByChild[childId] ?? [];
  const subjects = Array.from(new Set(results.map((r) => r.subject)));
  const filtered = results.filter((r) => {
    const q = search.toLowerCase();
    if (q && !r.testName.toLowerCase().includes(q) && !r.subject.toLowerCase().includes(q)) return false;
    if (subjectFilter !== "all" && r.subject !== subjectFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
          <Search className="w-3.5 h-3.5 text-[#46465a]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tests…"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none" />
        </div>
        <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
          <option value="all">All Subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {filtered.map((r) => (
          <div key={r.id} className="rounded-2xl bg-white/3 border border-white/5 overflow-hidden">
            <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              className="w-full flex items-center gap-3 p-4 hover:bg-white/3 transition-all text-left">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-white">{r.testName}</div>
                <div className="text-[10px] text-[#78788c]">{r.subject} · {r.teacher} · {r.testDate}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-sm font-black text-white tabular-nums">{r.marksObtained}/{r.totalMarks}</div>
                  <div className="text-[9px] text-[#78788c]">{r.percentage}%</div>
                </div>
                <GradeChip grade={r.grade} />
                <ChevronDown className={cn("w-3.5 h-3.5 text-[#46465a] transition-transform", expanded === r.id && "rotate-180")} />
              </div>
            </button>

            {expanded === r.id && (
              <div className="px-4 pb-4 space-y-3 border-t border-white/5">
                {/* Score vs class average */}
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="bg-[#3b5bdb]/10 rounded-xl p-3 text-center">
                    <div className="text-base font-black text-[#3b5bdb]">{r.percentage}%</div>
                    <div className="text-[9px] text-[#3b5bdb]">Your Score</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3 text-center">
                    <div className="text-base font-black text-white">{Math.round((r.classAverage / r.totalMarks) * 100)}%</div>
                    <div className="text-[9px] text-[#78788c]">Class Average</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-[#78788c]">
                  <GraduationCap className="w-3.5 h-3.5" />
                  Class Rank: <span className="font-bold text-white">#{r.classRank}</span> of {r.totalStudents} students
                </div>

                <div className="p-3 rounded-xl bg-white/3">
                  <div className="text-[9px] text-[#46465a] uppercase tracking-wider mb-1.5">Teacher Remarks</div>
                  <div className="text-xs text-[#78788c] italic">"{r.teacherRemarks}"</div>
                </div>

                {r.hasAnswerSheet && (
                  <button className="flex items-center gap-2 w-full p-2.5 rounded-xl bg-[#6366f1]/10 text-[10px] font-semibold text-[#a5b4fc] hover:bg-[#6366f1]/15 transition-all">
                    <Eye className="w-3.5 h-3.5" /> View Answer Sheet
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Performance Tab ───────────────────────────────────────────────────────────

function PerformanceTab({ childId }: { childId: string }) {
  const insights = academicInsightsByChild[childId];
  if (!insights) return null;

  return (
    <div className="space-y-4">
      {/* Overview */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#3b5bdb]/10 border border-[#3b5bdb]/20 rounded-2xl p-4 text-center">
          <div className="text-2xl font-black text-[#3b5bdb]">{insights.overallPercentage}%</div>
          <div className="text-[9px] text-[#3b5bdb] uppercase tracking-wide mt-0.5">Overall Score</div>
        </div>
        <div className="bg-[#6366f1]/10 border border-[#6366f1]/20 rounded-2xl p-4 text-center">
          <div className="text-2xl font-black text-[#6366f1]">#{insights.classRank}</div>
          <div className="text-[9px] text-[#6366f1] uppercase tracking-wide mt-0.5">Class Rank</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
          <div className="text-2xl font-black text-white">{Math.round((insights.classRank / insights.totalStudents) * 100)}%ile</div>
          <div className="text-[9px] text-[#78788c] uppercase tracking-wide mt-0.5">Percentile</div>
        </div>
      </div>

      {/* Subject-wise comparison */}
      <div className="p-4 rounded-2xl bg-white/3 space-y-3">
        <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Subject-wise vs Class Average</div>
        {insights.subjectPerformance.map((s) => (
          <div key={s.subject} className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-white font-semibold">{s.subject}</span>
              <span className="text-[#46465a]">Class avg: {s.classAvg}%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden relative">
                {/* Class average marker */}
                <div className="absolute top-0 bottom-0 w-0.5 bg-white/20 z-10" style={{ left: `${s.classAvg}%` }} />
                <div className="h-full rounded-full" style={{ width: `${s.score}%`, background: s.score >= s.classAvg ? "#3b5bdb" : "#c08a3a" }} />
              </div>
              <span className="text-[10px] font-bold tabular-nums" style={{ color: s.score >= s.classAvg ? "#3b5bdb" : "#c08a3a" }}>{s.score}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Weak / Strong */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl bg-[#3b5bdb]/8 border border-[#3b5bdb]/15">
          <div className="text-[10px] font-bold text-[#3b5bdb] uppercase tracking-wider mb-2">Strong Subjects</div>
          <div className="flex flex-wrap gap-1.5">
            {insights.strongSubjects.map((s) => (
              <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-[#3b5bdb]/15 text-[#3b5bdb]">{s}</span>
            ))}
          </div>
        </div>
        <div className="p-4 rounded-2xl bg-[#c08a3a]/8 border border-[#c08a3a]/15">
          <div className="text-[10px] font-bold text-[#c08a3a] uppercase tracking-wider mb-2">Needs Improvement</div>
          <div className="flex flex-wrap gap-1.5">
            {insights.weakSubjects.map((s) => (
              <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-[#c08a3a]/15 text-[#c08a3a]">{s}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Focus areas */}
      <div className="p-4 rounded-2xl bg-white/3">
        <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider mb-2">Areas to Focus On</div>
        <div className="flex flex-wrap gap-1.5">
          {insights.weekAreas.map((a) => (
            <span key={a} className="text-[10px] px-2 py-1 rounded-lg bg-[#cc5069]/10 text-[#cc5069] border border-[#cc5069]/15">{a}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Class Insights Tab ────────────────────────────────────────────────────────

function InsightsTab({ childId }: { childId: string }) {
  const insights = academicInsightsByChild[childId];
  if (!insights) return null;

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-xl bg-[#6366f1]/8 border border-[#6366f1]/15 text-[10px] text-[#a5b4fc] flex items-start gap-2">
        <Users className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>Comparisons shown against class averages and percentiles to give context — individual student data is never shared to protect privacy.</span>
      </div>

      {/* Attendance vs class */}
      <div className="p-4 rounded-2xl bg-white/3 space-y-3">
        <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Attendance vs Class</div>
        <div className="space-y-2">
          {[
            { label: "My Attendance", value: insights.attendanceVsClass.mine, color: "#3b5bdb" },
            { label: "Class Average", value: insights.attendanceVsClass.classAvg, color: "#6366f1" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <div className="text-[10px] text-[#78788c] w-28 shrink-0">{item.label}</div>
              <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${item.value}%`, background: item.color }} />
              </div>
              <div className="text-[10px] font-bold tabular-nums" style={{ color: item.color }}>{item.value}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* Homework completion vs class */}
      <div className="p-4 rounded-2xl bg-white/3 space-y-3">
        <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Homework Completion vs Class</div>
        <div className="space-y-2">
          {[
            { label: "My Completion", value: insights.homeworkCompletion, color: "#3b5bdb" },
            { label: "Class Average", value: insights.classHomeworkAvg, color: "#6366f1" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <div className="text-[10px] text-[#78788c] w-28 shrink-0">{item.label}</div>
              <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${item.value}%`, background: item.color }} />
              </div>
              <div className="text-[10px] font-bold tabular-nums" style={{ color: item.color }}>{item.value}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* Practice & streak */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl bg-white/3 space-y-1">
          <div className="text-[9px] text-[#46465a] uppercase tracking-wider">Learning Streak</div>
          <div className="text-2xl font-black text-[#c08a3a]">{insights.learningStreak}</div>
          <div className="text-[10px] text-[#78788c]">consecutive days</div>
        </div>
        <div className="p-4 rounded-2xl bg-white/3 space-y-1">
          <div className="text-[9px] text-[#46465a] uppercase tracking-wider">Questions Solved</div>
          <div className="text-2xl font-black text-[#6366f1]">{insights.questionsAttempted}</div>
          <div className="text-[10px] text-[#78788c]">total this year</div>
        </div>
      </div>

      {/* Teacher observations */}
      <div className="p-4 rounded-2xl bg-white/3">
        <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider mb-2">Teacher Observations</div>
        <div className="text-xs text-[#78788c] leading-relaxed italic">"{insights.observations}"</div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function MyChildren({ activeChildId, setActiveChildId }: { activeChildId: string; setActiveChildId: (id: string) => void }) {
  const [tab, setTab] = useState<ChildTab>("profile");
  const child = children.find((c) => c.id === activeChildId) ?? children[0];

  const tabs: { key: ChildTab; label: string }[] = [
    { key: "profile", label: "Profile" },
    { key: "attendance", label: "Attendance" },
    { key: "homework", label: "Homework" },
    { key: "exams", label: "Exams" },
  ];

  return (
    <div className="space-y-4">
      {/* Child Switcher */}
      {children.length > 1 && (
        <div className="flex gap-2">
          {children.map((c) => (
            <button key={c.id} onClick={() => { setActiveChildId(c.id); setTab("profile"); }}
              className={cn("flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left",
                c.id === activeChildId
                  ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30 text-[#3b5bdb]"
                  : "bg-[#131316] border-white/7 text-[#78788c] hover:border-white/15")}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs"
                style={{ background: c.id === activeChildId ? "#3b5bdb30" : "#ffffff18", color: c.id === activeChildId ? "#3b5bdb" : "#78788c" }}>
                {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <div>
                <div className="text-xs font-bold">{c.name}</div>
                <div className="text-[10px] opacity-70">{c.className} · {c.section}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Panel */}
      <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-white/7 flex items-center gap-4 bg-gradient-to-r from-[#3b5bdb]/5 to-transparent">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
            <span className="text-lg font-black text-white">{child.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-black text-white">{child.name}</div>
            <div className="text-[10px] text-[#78788c] mt-0.5">{child.className} · Section {child.section} · Roll {child.rollNumber}</div>
            <div className="text-[9px] text-[#46465a] mt-0.5">Adm: {child.admissionNumber} · {child.academicYear}</div>
          </div>
          <div className="hidden sm:flex flex-col items-end gap-1">
            <div className="text-[10px] text-[#46465a]">Class Teacher</div>
            <div className="text-xs font-semibold text-white">{child.classTeacher}</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 py-3 border-b border-white/7 overflow-x-auto">
          {tabs.map((t) => <TabBtn key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</TabBtn>)}
        </div>

        {/* Tab content */}
        <div className="p-5">
          {tab === "profile" && (
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Full Name", value: child.name },
                { label: "Class", value: `${child.className} · Section ${child.section}` },
                { label: "Roll Number", value: child.rollNumber },
                { label: "Admission No.", value: child.admissionNumber },
                { label: "Academic Year", value: child.academicYear },
                { label: "Date of Birth", value: child.dob },
                { label: "Gender", value: child.gender.charAt(0).toUpperCase() + child.gender.slice(1) },
                { label: "Blood Group", value: child.bloodGroup },
                { label: "House", value: child.house },
                { label: "Class Teacher", value: child.classTeacher },
                { label: "School", value: child.school },
              ].map((row) => <InfoRow key={row.label} label={row.label} value={row.value} />)}
            </div>
          )}

          {tab === "attendance" && <AttendanceCalendar data={attendanceByChild[child.id] ?? []} />}
          {tab === "homework" && <HomeworkTab childId={child.id} />}
          {tab === "exams" && (
            <div className="space-y-6">
              <ExaminationsTab childId={child.id} />
              <div className="border-t border-white/7 pt-6">
                <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider mb-4">Test Results</div>
                <TestResultsTab childId={child.id} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
