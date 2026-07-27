import {
  TrendingUp, TrendingDown, Minus, BookOpen, BarChart2,
  CheckCircle2, AlertCircle, Users, Star, Target, Zap, Brain,
} from "lucide-react";
import { cn } from "./shared";
import { children, richInsightsByChild, type RichInsights } from "./data";

// ── Text generators (no charts — clear conclusions) ───────────────────────────

function genOverallSummary(ins: RichInsights, name: string): string {
  const delta = ins.overallPercentage - ins.previousOverallPercentage;
  const perfWord = ins.overallPercentage >= 85 ? "excellent" : ins.overallPercentage >= 75 ? "good" : ins.overallPercentage >= 60 ? "average" : "below expectations";
  const perfChange = Math.abs(delta) < 2 ? "Overall academic performance has remained consistent." : delta > 0 ? `Overall academic performance has improved by ${delta.toFixed(1)} percentage points since the previous assessment.` : `Overall academic performance has declined by ${Math.abs(delta).toFixed(1)} percentage points. Attention is needed.`;
  const strong = ins.strongSubjects.join(" and ");
  const weak = ins.weakSubjects.join(" and ");
  const hwWord = ins.homeworkCompletion >= 90 ? "excellent" : ins.homeworkCompletion >= 75 ? "good" : "needs attention";
  const attWord = ins.attendancePct >= 90 ? "consistently excellent" : ins.attendancePct >= 80 ? "satisfactory" : "low and may be affecting academic performance";
  return `${name} is currently performing at an ${perfWord} level with an overall score of ${ins.overallPercentage}% (Grade ${ins.overallGrade}), ranked ${ins.classRank} out of ${ins.totalStudents} students. ${perfChange} The strongest areas are ${strong}, where performance is well above the class average. ${weak} require closer attention and more focused practice. Homework discipline is ${hwWord} at ${ins.homeworkCompletion}%. Attendance is ${attWord} at ${ins.attendancePct}%. Practice consistency stands at ${ins.practiceConsistency}%, with a current learning streak of ${ins.learningStreak} days.`;
}

function genSubjectSummary(sub: RichInsights["subjectPerformance"][0]): string {
  const delta = sub.score - sub.previousScore;
  const vsClass = sub.score - sub.classAvg;
  const improvement = Math.abs(delta) < 2 ? `performance in ${sub.subject} remains consistent at ${sub.score}%.` : delta > 0 ? `${sub.subject} performance has improved by ${delta.toFixed(1)}% since the previous assessment, now at ${sub.score}%.` : `${sub.subject} performance has declined by ${Math.abs(delta).toFixed(1)}% to ${sub.score}%.`;
  const classCmp = vsClass > 5 ? ` This is ${vsClass.toFixed(1)}% above the class average.` : vsClass < -3 ? ` This is ${Math.abs(vsClass).toFixed(1)}% below the class average — improvement is recommended.` : ` This is close to the class average of ${sub.classAvg}%.`;
  return improvement + classCmp;
}

function genAttendanceSummary(ins: RichInsights): string {
  const delta = ins.attendancePct - ins.previousMonthAttendancePct;
  const base = ins.attendancePct >= 90 ? "Attendance is consistently excellent." : ins.attendancePct >= 80 ? "Attendance is satisfactory but has room for improvement." : ins.attendancePct < 75 ? "Attendance is low and may be negatively affecting academic performance. Immediate improvement is strongly recommended." : "Attendance requires improvement to reach the expected standard.";
  const change = Math.abs(delta) < 1.5 ? " Attendance has remained stable compared to the previous month." : delta > 0 ? ` Attendance has improved by ${delta.toFixed(1)} percentage points compared to the previous month.` : ` Attendance has declined by ${Math.abs(delta).toFixed(1)} percentage points compared to the previous month.`;
  return base + change;
}

function genPracticeSummary(ins: RichInsights): string {
  const consistency = ins.practiceConsistency >= 85 ? "Practice consistency is excellent — the student is engaging with learning material daily." : ins.practiceConsistency >= 65 ? "Practice consistency is moderate. Increasing daily practice sessions will yield faster improvement." : "Practice activity has reduced recently. Regular daily practice is strongly recommended to maintain academic momentum.";
  const activity = ins.questionsThisWeek >= 100 ? "Question-solving activity has been high this week." : ins.questionsThisWeek >= 50 ? "Question-solving activity is on track this week." : "Question-solving activity is lower than expected this week. Increasing daily practice is recommended.";
  return `${consistency} ${activity} A total of ${ins.questionsThisMonth} questions have been solved this month, and ${ins.questionsToday} questions were solved today.`;
}

function genHomeworkSummary(ins: RichInsights): string {
  const hwPct = ins.homeworkCompletion;
  const asnPct = ins.assignmentsTotal ? Math.round((ins.assignmentsSubmitted / ins.assignmentsTotal) * 100) : 100;
  const hw = hwPct >= 90 ? "Homework completion is excellent." : hwPct >= 75 ? "Homework completion has been good." : "Homework completion requires immediate attention — multiple assignments are pending.";
  const asn = asnPct >= 90 ? "Assignment submission is excellent." : asnPct >= 70 ? "Assignment submission consistency requires attention." : "Multiple assignments are pending. Immediate action is needed.";
  return `${hw} ${ins.homeworkCompleted} of ${ins.homeworkAssigned} homework tasks have been completed (${hwPct}%). ${asn} ${ins.assignmentsSubmitted} of ${ins.assignmentsTotal} assignments have been submitted.`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InsightCard({ color, icon, title, children }: { color: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/7">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}15`, color }}>
          {icon}
        </div>
        <div className="text-sm font-bold text-white">{title}</div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function SummaryText({ text }: { text: string }) {
  return <p className="text-sm text-[#b0b0c0] leading-relaxed">{text}</p>;
}

function StatRow({ label, value, valueColor }: { label: string; value: string | number; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-[#78788c]">{label}</span>
      <span className="text-xs font-bold tabular-nums" style={{ color: valueColor ?? "white" }}>{value}</span>
    </div>
  );
}

function TagList({ items, color }: { items: string[]; color: string }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {items.map((item) => (
        <span key={item} className="text-[10px] px-2.5 py-1 rounded-xl font-medium" style={{ background: `${color}12`, color }}>
          {item}
        </span>
      ))}
    </div>
  );
}

function ComparisonBar({ label, mine, classAvg }: { label: string; mine: number; classAvg: number }) {
  const diff = mine - classAvg;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-white font-semibold">{label}</span>
        <span className="text-[#46465a]">Class avg: {classAvg}%</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
          <div className="absolute top-0 bottom-0 w-0.5 bg-white/20 z-10" style={{ left: `${classAvg}%` }} />
          <div className="h-full rounded-full transition-all" style={{ width: `${mine}%`, background: diff >= 0 ? "#3b5bdb" : "#c08a3a" }} />
        </div>
        <span className="text-[10px] font-bold tabular-nums w-10 text-right shrink-0" style={{ color: diff >= 0 ? "#3b5bdb" : "#c08a3a" }}>{mine}%</span>
        <span className={cn("text-[9px] font-bold shrink-0", diff >= 0 ? "text-[#3b5bdb]" : "text-[#c08a3a]")}>
          {diff >= 0 ? "+" : ""}{diff.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function ChildSelector({ activeId, setActiveId }: { activeId: string; setActiveId: (id: string) => void }) {
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
            <div className="text-[9px] opacity-60 mt-0.5">{c.className} · {c.section}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AcademicInsights({ activeChildId, setActiveChildId }: { activeChildId: string; setActiveChildId: (id: string) => void }) {
  const child = children.find((c) => c.id === activeChildId) ?? children[0];
  const ins = richInsightsByChild[child.id];

  if (!ins) return (
    <div className="text-center py-16 text-xs text-[#78788c]">No academic data available for this student.</div>
  );

  const asnPct = ins.assignmentsTotal ? Math.round((ins.assignmentsSubmitted / ins.assignmentsTotal) * 100) : 100;
  const bestSubject = [...ins.subjectPerformance].sort((a, b) => b.score - a.score)[0];
  const worstSubject = [...ins.subjectPerformance].sort((a, b) => a.score - b.score)[0];
  const overallDelta = ins.overallPercentage - ins.previousOverallPercentage;

  return (
    <div className="space-y-5">
      {/* Child selector */}
      <ChildSelector activeId={activeChildId} setActiveId={setActiveChildId} />

      {/* AI Academic Summary */}
      <div className="bg-gradient-to-br from-[#3b5bdb]/8 to-[#6882e8]/4 border border-[#3b5bdb]/20 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-[#3b5bdb]/20 flex items-center justify-center">
            <Brain className="w-3.5 h-3.5 text-[#3b5bdb]" />
          </div>
          <div className="text-sm font-bold text-white">Academic Summary — {child.name}</div>
          <span className="text-[9px] font-bold bg-[#3b5bdb]/15 text-[#3b5bdb] px-2 py-0.5 rounded-full uppercase tracking-wide ml-auto">
            Updated Jul 26, 2026
          </span>
        </div>
        <p className="text-sm text-[#c8c8d8] leading-relaxed">{genOverallSummary(ins, child.name)}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          {[
            { label: "Overall Score", value: `${ins.overallPercentage}%`, color: "#3b5bdb" },
            { label: "Grade", value: ins.overallGrade, color: "#6366f1" },
            { label: "Class Rank", value: `#${ins.classRank}`, color: "#8f7dd6" },
            { label: "vs Previous", value: `${overallDelta >= 0 ? "+" : ""}${overallDelta.toFixed(1)}%`, color: overallDelta >= 0 ? "#3b5bdb" : "#cc5069" },
          ].map((s) => (
            <div key={s.label} className="bg-black/20 rounded-xl p-3 text-center">
              <div className="text-sm font-black tabular-nums" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[9px] text-[#78788c] mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Two-column layout for the detailed sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Academic Performance */}
        <InsightCard color="#6366f1" icon={<BarChart2 className="w-4 h-4" />} title="Academic Performance">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#3b5bdb]/10 rounded-xl p-3 text-center">
                <div className="text-base font-black text-[#3b5bdb]">{bestSubject.subject}</div>
                <div className="text-[9px] text-[#3b5bdb] mt-0.5">Best Subject · {bestSubject.score}%</div>
              </div>
              <div className="bg-[#c08a3a]/10 rounded-xl p-3 text-center">
                <div className="text-base font-black text-[#c08a3a]">{worstSubject.subject}</div>
                <div className="text-[9px] text-[#c08a3a] mt-0.5">Needs Focus · {worstSubject.score}%</div>
              </div>
            </div>

            <div className="space-y-3">
              {ins.subjectPerformance.map((s) => (
                <div key={s.subject} className="p-3 rounded-xl bg-white/3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-white">{s.subject}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold tabular-nums" style={{ color: s.score >= 85 ? "#3b5bdb" : s.score >= 70 ? "#6366f1" : "#c08a3a" }}>{s.score}%</span>
                      {s.trend === "up" ? <TrendingUp className="w-3 h-3 text-[#3b5bdb]" /> : s.trend === "down" ? <TrendingDown className="w-3 h-3 text-[#cc5069]" /> : <Minus className="w-3 h-3 text-[#78788c]" />}
                    </div>
                  </div>
                  <p className="text-[10px] text-[#78788c] leading-relaxed">{genSubjectSummary(s)}</p>
                </div>
              ))}
            </div>
          </div>
        </InsightCard>

        {/* Attendance Insights */}
        <InsightCard color="#3b5bdb" icon={<CheckCircle2 className="w-4 h-4" />} title="Attendance Insights">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[#3b5bdb]/10 rounded-xl p-3 text-center">
                <div className="text-lg font-black text-[#3b5bdb]">{ins.presentDays}</div>
                <div className="text-[9px] text-[#3b5bdb]">Present</div>
              </div>
              <div className="bg-[#cc5069]/10 rounded-xl p-3 text-center">
                <div className="text-lg font-black text-[#cc5069]">{ins.absentDays}</div>
                <div className="text-[9px] text-[#cc5069]">Absent</div>
              </div>
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <div className="text-lg font-black text-white">{ins.attendancePct}%</div>
                <div className="text-[9px] text-[#78788c]">Rate</div>
              </div>
            </div>
            {ins.lateAttendanceDays > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#c08a3a]/10 text-[10px] text-[#c08a3a]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {ins.lateAttendanceDays} late arrival{ins.lateAttendanceDays > 1 ? "s" : ""} recorded this month
              </div>
            )}
            <div className="p-3 rounded-xl bg-white/3">
              <SummaryText text={genAttendanceSummary(ins)} />
            </div>
            <ComparisonBar label="Attendance vs Class" mine={ins.attendancePct} classAvg={ins.attendanceVsClass.classAvg} />
          </div>
        </InsightCard>

        {/* Practice & Learning Activity */}
        <InsightCard color="#8f7dd6" icon={<Zap className="w-4 h-4" />} title="Practice & Learning Activity">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Today", value: ins.questionsToday, color: "#3b5bdb" },
                { label: "This Week", value: ins.questionsThisWeek, color: "#6366f1" },
                { label: "This Month", value: ins.questionsThisMonth, color: "#8f7dd6" },
                { label: "Total", value: ins.questionsTotal, color: "#4b9fd4" },
              ].map((s) => (
                <div key={s.label} className="bg-white/3 rounded-xl p-3 text-center">
                  <div className="text-lg font-black tabular-nums" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[9px] text-[#78788c] mt-0.5">Questions — {s.label}</div>
                </div>
              ))}
            </div>
            <div className="space-y-0">
              <StatRow label="Practice Sessions" value={ins.practiceSessionsTotal} />
              <StatRow label="Practice Consistency" value={`${ins.practiceConsistency}%`} valueColor={ins.practiceConsistency >= 80 ? "#3b5bdb" : "#c08a3a"} />
              <StatRow label="Learning Streak" value={`${ins.learningStreak} days`} valueColor="#c08a3a" />
              <StatRow label="Homework Completion" value={`${ins.homeworkCompletion}%`} valueColor={ins.homeworkCompletion >= 85 ? "#3b5bdb" : "#c08a3a"} />
              <StatRow label="Assignment Completion" value={`${asnPct}%`} valueColor={asnPct >= 85 ? "#3b5bdb" : "#c08a3a"} />
            </div>
            <div className="p-3 rounded-xl bg-white/3">
              <SummaryText text={genPracticeSummary(ins)} />
            </div>
          </div>
        </InsightCard>

        {/* Homework & Assignment Insights */}
        <InsightCard color="#c08a3a" icon={<BookOpen className="w-4 h-4" />} title="Homework & Assignment Insights">
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Homework</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white/3 rounded-xl p-3 text-center">
                  <div className="text-base font-black text-white">{ins.homeworkAssigned}</div>
                  <div className="text-[9px] text-[#78788c]">Assigned</div>
                </div>
                <div className="bg-[#3b5bdb]/10 rounded-xl p-3 text-center">
                  <div className="text-base font-black text-[#3b5bdb]">{ins.homeworkCompleted}</div>
                  <div className="text-[9px] text-[#3b5bdb]">Completed</div>
                </div>
                <div className="bg-[#c08a3a]/10 rounded-xl p-3 text-center">
                  <div className="text-base font-black text-[#c08a3a]">{ins.homeworkAssigned - ins.homeworkCompleted}</div>
                  <div className="text-[9px] text-[#c08a3a]">Pending</div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider">Assignments</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white/3 rounded-xl p-3 text-center">
                  <div className="text-base font-black text-white">{ins.assignmentsTotal}</div>
                  <div className="text-[9px] text-[#78788c]">Total</div>
                </div>
                <div className="bg-[#3b5bdb]/10 rounded-xl p-3 text-center">
                  <div className="text-base font-black text-[#3b5bdb]">{ins.assignmentsSubmitted}</div>
                  <div className="text-[9px] text-[#3b5bdb]">Submitted</div>
                </div>
                <div className="bg-[#c08a3a]/10 rounded-xl p-3 text-center">
                  <div className="text-base font-black text-[#c08a3a]">{ins.assignmentsTotal - ins.assignmentsSubmitted}</div>
                  <div className="text-[9px] text-[#c08a3a]">Pending</div>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white/3">
              <SummaryText text={genHomeworkSummary(ins)} />
            </div>
            <ComparisonBar label="Homework vs Class Average" mine={ins.homeworkCompletion} classAvg={ins.classHomeworkAvg} />
          </div>
        </InsightCard>

        {/* Learning Insights */}
        <InsightCard color="#4b9fd4" icon={<Brain className="w-4 h-4" />} title="Learning Insights">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-3.5 h-3.5 text-[#3b5bdb]" />
                <div className="text-[10px] font-bold text-[#3b5bdb] uppercase tracking-wider">Strong Areas</div>
              </div>
              <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider mb-1">Subjects</div>
              <TagList items={ins.strongSubjects} color="#3b5bdb" />
              <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider mt-3 mb-1">Chapters</div>
              <TagList items={ins.strongChapters} color="#3b5bdb" />
              <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider mt-3 mb-1">Topics</div>
              <TagList items={ins.strongTopics} color="#3b5bdb" />
            </div>
            <div className="border-t border-white/7 pt-4">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-3.5 h-3.5 text-[#c08a3a]" />
                <div className="text-[10px] font-bold text-[#c08a3a] uppercase tracking-wider">Areas Needing Work</div>
              </div>
              <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider mb-1">Subjects</div>
              <TagList items={ins.weakSubjects} color="#c08a3a" />
              <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider mt-3 mb-1">Chapters</div>
              <TagList items={ins.weakChapters} color="#c08a3a" />
              <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider mt-3 mb-1">Topics</div>
              <TagList items={ins.weakTopics} color="#c08a3a" />
            </div>
            <div className="border-t border-white/7 pt-4">
              <div className="text-[10px] font-bold text-[#cc5069] uppercase tracking-wider mb-2">Frequently Mistaken</div>
              <TagList items={ins.frequentlyMistaken} color="#cc5069" />
            </div>
            <div className="border-t border-white/7 pt-4">
              <div className="text-[10px] font-bold text-[#6366f1] uppercase tracking-wider mb-2">Improving Areas</div>
              <TagList items={ins.improvingAreas} color="#6366f1" />
            </div>
            {ins.urgentAttentionAreas.length > 0 && (
              <div className="p-3 rounded-xl bg-[#cc5069]/8 border border-[#cc5069]/15">
                <div className="text-[10px] font-bold text-[#cc5069] uppercase tracking-wider mb-1">Requires Immediate Attention</div>
                <TagList items={ins.urgentAttentionAreas} color="#cc5069" />
              </div>
            )}
          </div>
        </InsightCard>

        {/* Class Comparison */}
        <InsightCard color="#8f7dd6" icon={<Users className="w-4 h-4" />} title="Class Comparison">
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-xl bg-[#6366f1]/8 border border-[#6366f1]/15 text-[10px] text-[#a5b4fc]">
              <Users className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Class averages and percentiles shown. No individual student data is shared.</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#6366f1]/10 rounded-xl p-3 text-center">
                <div className="text-lg font-black text-[#6366f1]">#{ins.classRank}</div>
                <div className="text-[9px] text-[#6366f1]">Class Rank</div>
              </div>
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <div className="text-lg font-black text-white">{Math.round(((ins.totalStudents - ins.classRank) / ins.totalStudents) * 100)}th</div>
                <div className="text-[9px] text-[#78788c]">Percentile</div>
              </div>
            </div>

            <div className="space-y-3">
              <ComparisonBar label="Overall Score" mine={ins.overallPercentage} classAvg={Math.round(ins.subjectPerformance.reduce((s, x) => s + x.classAvg, 0) / ins.subjectPerformance.length)} />
              {ins.subjectPerformance.map((s) => (
                <ComparisonBar key={s.subject} label={s.subject} mine={s.score} classAvg={s.classAvg} />
              ))}
              <ComparisonBar label="Attendance" mine={ins.attendancePct} classAvg={ins.attendanceVsClass.classAvg} />
              <ComparisonBar label="Homework Completion" mine={ins.homeworkCompletion} classAvg={ins.classHomeworkAvg} />
              <ComparisonBar label="Practice Consistency" mine={ins.practiceConsistency} classAvg={60} />
            </div>

            {/* Auto-generated class observations */}
            <div className="p-3 rounded-xl bg-white/3 space-y-2">
              <div className="text-[9px] font-bold text-[#78788c] uppercase tracking-wider">Observations</div>
              {ins.subjectPerformance.map((s) => {
                const diff = s.score - s.classAvg;
                if (Math.abs(diff) < 3) return null;
                return (
                  <div key={s.subject} className="flex items-start gap-2 text-[10px]">
                    {diff > 0
                      ? <CheckCircle2 className="w-3 h-3 text-[#3b5bdb] shrink-0 mt-0.5" />
                      : <AlertCircle className="w-3 h-3 text-[#c08a3a] shrink-0 mt-0.5" />}
                    <span className="text-[#78788c]">
                      {diff > 0
                        ? `${child.name.split(" ")[0]} is performing ${diff.toFixed(0)}% above the class average in ${s.subject}.`
                        : `${child.name.split(" ")[0]} is ${Math.abs(diff).toFixed(0)}% below the class average in ${s.subject}. Additional practice is recommended.`}
                    </span>
                  </div>
                );
              })}
              {ins.attendancePct > ins.attendanceVsClass.classAvg && (
                <div className="flex items-start gap-2 text-[10px]">
                  <CheckCircle2 className="w-3 h-3 text-[#3b5bdb] shrink-0 mt-0.5" />
                  <span className="text-[#78788c]">Attendance is higher than most classmates.</span>
                </div>
              )}
              {ins.practiceConsistency < 60 && (
                <div className="flex items-start gap-2 text-[10px]">
                  <AlertCircle className="w-3 h-3 text-[#c08a3a] shrink-0 mt-0.5" />
                  <span className="text-[#78788c]">Practice activity is lower than the class average. Increasing daily practice is recommended.</span>
                </div>
              )}
            </div>
          </div>
        </InsightCard>

      </div>

      {/* Teacher Feedback — full width */}
      <InsightCard color="#3b5bdb" icon={<Star className="w-4 h-4" />} title="Teacher Feedback">
        <div className="space-y-4">
          {ins.teacherFeedback.map((fb, i) => (
            <div key={i} className="p-4 rounded-2xl bg-white/3 border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white">{fb.teacher}</div>
                  <div className="text-[10px] text-[#78788c]">{fb.subject} · {fb.date}</div>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  { label: "Remarks", value: fb.remarks },
                  { label: "Observations", value: fb.observations },
                  { label: "Improvement Suggestions", value: fb.suggestions },
                ].map((row) => (
                  <div key={row.label} className="space-y-0.5">
                    <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider">{row.label}</div>
                    <div className="text-xs text-[#b0b0c0] leading-relaxed">{row.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </InsightCard>
    </div>
  );
}
