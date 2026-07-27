import { useState, useMemo } from "react";
import {
  Search, ChevronDown, Eye, GraduationCap, Calendar, SortAsc, SortDesc,
} from "lucide-react";
import { cn, GradeChip } from "./shared";
import { children, testResultsByChild, type TestResult } from "./data";

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

function ScoreVsClass({ score, classAvg, total }: { score: number; classAvg: number; total: number }) {
  const myPct = Math.round((score / total) * 100);
  const classPct = Math.round((classAvg / total) * 100);
  const diff = myPct - classPct;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[9px] text-[#46465a]">
        <span>Your score</span>
        <span>Class avg: {classAvg}/{total} ({classPct}%)</span>
      </div>
      <div className="relative flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div className="absolute top-0 bottom-0 w-0.5 bg-white/20 z-10" style={{ left: `${classPct}%` }} />
        <div className="h-full rounded-full" style={{ width: `${myPct}%`, background: diff >= 0 ? "#3b5bdb" : "#c08a3a" }} />
      </div>
      <div className="text-[9px]" style={{ color: diff >= 0 ? "#3b5bdb" : "#c08a3a" }}>
        {diff >= 0 ? `+${diff}% above` : `${Math.abs(diff)}% below`} class average
      </div>
    </div>
  );
}

type SortKey = "date" | "marks" | "percentage";
type SortDir = "asc" | "desc";

export default function TestResults({ activeChildId, setActiveChildId }: { activeChildId: string; setActiveChildId: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<string | null>(null);

  const results = testResultsByChild[activeChildId] ?? [];
  const subjects = Array.from(new Set(results.map((r) => r.subject)));

  const filtered = useMemo(() => {
    let list = results.filter((r) => {
      const q = search.toLowerCase();
      if (q && !r.testName.toLowerCase().includes(q) && !r.subject.toLowerCase().includes(q) && !r.teacher.toLowerCase().includes(q)) return false;
      if (subjectFilter !== "all" && r.subject !== subjectFilter) return false;
      if (dateFrom && r.testDate < dateFrom) return false;
      if (dateTo && r.testDate > dateTo) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.testDate.localeCompare(b.testDate);
      else if (sortKey === "marks") cmp = a.marksObtained / a.totalMarks - b.marksObtained / b.totalMarks;
      else cmp = a.percentage - b.percentage;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [results, search, subjectFilter, dateFrom, dateTo, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function setDir(d: SortDir) { setSortDir(d); }

  const SortIcon = sortDir === "asc" ? SortAsc : SortDesc;

  const avg = results.length ? Math.round(results.reduce((s, r) => s + r.percentage, 0) / results.length) : 0;
  const best = results.length ? [...results].sort((a, b) => b.percentage - a.percentage)[0] : null;

  return (
    <div className="space-y-4">
      {/* Child selector */}
      <ChildSelector activeId={activeChildId} setActiveId={setActiveChildId} />

      {/* Summary row */}
      {results.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
            <div className="text-xl font-black text-white tabular-nums">{results.length}</div>
            <div className="text-[10px] text-[#78788c] mt-0.5">Total Tests</div>
          </div>
          <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
            <div className="text-xl font-black text-[#3b5bdb] tabular-nums">{avg}%</div>
            <div className="text-[10px] text-[#78788c] mt-0.5">Average Score</div>
          </div>
          <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
            <div className="text-xs font-black text-[#6366f1] truncate">{best?.subject ?? "—"}</div>
            <div className="text-[10px] text-[#78788c] mt-0.5">Best Subject</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex-1 min-w-40">
          <Search className="w-3.5 h-3.5 text-[#46465a] shrink-0" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by test, subject or teacher…"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-[#46465a] outline-none min-w-0" />
        </div>
        <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none shrink-0">
          <option value="all">All Subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          placeholder="From"
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none shrink-0" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none shrink-0" />
      </div>

      {/* Sort buttons */}
      <div className="flex gap-2">
        <span className="text-[10px] text-[#46465a] self-center">Sort:</span>
        {([["date", "Date"], ["marks", "Marks"], ["percentage", "Score %"]] as [SortKey, string][]).map(([key, label]) => (
          <button key={key} onClick={() => toggleSort(key)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-semibold transition-all",
              sortKey === key ? "bg-[#3b5bdb]/15 text-[#3b5bdb]" : "bg-white/5 text-[#78788c] hover:text-white")}>
            {label}
            {sortKey === key && <SortIcon className="w-3 h-3" />}
          </button>
        ))}
        <span className="text-[10px] text-[#46465a] ml-1 self-center">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Results list */}
      {filtered.length === 0 && (
        <div className="text-center py-12 text-xs text-[#78788c]">No test results match your filters.</div>
      )}

      <div className="space-y-2">
        {filtered.map((r) => (
          <div key={r.id} className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
            <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              className="w-full flex items-center gap-4 p-4 hover:bg-white/3 transition-all text-left">
              {/* Score donut-ish */}
              <div className="w-12 h-12 rounded-2xl flex flex-col items-center justify-center shrink-0"
                style={{ background: r.percentage >= 85 ? "#3b5bdb15" : r.percentage >= 70 ? "#6366f115" : "#c08a3a15" }}>
                <div className="text-sm font-black tabular-nums" style={{ color: r.percentage >= 85 ? "#3b5bdb" : r.percentage >= 70 ? "#6366f1" : "#c08a3a" }}>
                  {r.percentage}
                </div>
                <div className="text-[7px] font-bold" style={{ color: r.percentage >= 85 ? "#3b5bdb" : r.percentage >= 70 ? "#6366f1" : "#c08a3a" }}>%</div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xs font-bold text-white">{r.testName}</div>
                  <GradeChip grade={r.grade} />
                </div>
                <div className="text-[10px] text-[#78788c] mt-0.5">{r.subject} · {r.teacher}</div>
                <div className="text-[9px] text-[#46465a] mt-0.5 flex items-center gap-1">
                  <Calendar className="w-2.5 h-2.5" /> {r.testDate}
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="text-sm font-black text-white tabular-nums">{r.marksObtained}<span className="text-xs font-normal text-[#46465a]">/{r.totalMarks}</span></div>
                <div className="text-[9px] text-[#46465a] mt-0.5 flex items-center gap-1 justify-end">
                  <GraduationCap className="w-2.5 h-2.5" /> #{r.classRank}/{r.totalStudents}
                </div>
              </div>

              <ChevronDown className={cn("w-4 h-4 text-[#46465a] shrink-0 transition-transform", expanded === r.id && "rotate-180")} />
            </button>

            {expanded === r.id && (
              <div className="px-4 pb-4 space-y-4 border-t border-white/7">
                {/* Score vs class */}
                <div className="pt-4">
                  <ScoreVsClass score={r.marksObtained} classAvg={r.classAverage} total={r.totalMarks} />
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-[#3b5bdb]/10 rounded-xl p-3 text-center">
                    <div className="text-sm font-black text-[#3b5bdb]">{r.marksObtained}/{r.totalMarks}</div>
                    <div className="text-[9px] text-[#3b5bdb]">Marks</div>
                  </div>
                  <div className="bg-[#6366f1]/10 rounded-xl p-3 text-center">
                    <div className="text-sm font-black text-[#6366f1]">#{r.classRank}</div>
                    <div className="text-[9px] text-[#6366f1]">Class Rank</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3 text-center">
                    <div className="text-sm font-black text-white">{r.classAverage}/{r.totalMarks}</div>
                    <div className="text-[9px] text-[#78788c]">Class Avg</div>
                  </div>
                </div>

                {/* Teacher Remarks */}
                <div className="p-3 rounded-xl bg-white/3">
                  <div className="text-[9px] font-bold text-[#46465a] uppercase tracking-wider mb-1.5">Teacher Remarks</div>
                  <div className="text-xs text-[#b0b0c0] leading-relaxed italic">"{r.teacherRemarks}"</div>
                  <div className="text-[9px] text-[#46465a] mt-1.5">— {r.teacher}</div>
                </div>

                {/* Answer sheet */}
                {r.hasAnswerSheet && (
                  <button className="flex items-center gap-2 w-full px-4 py-2.5 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 text-xs font-semibold text-[#a5b4fc] hover:bg-[#6366f1]/15 transition-all">
                    <Eye className="w-3.5 h-3.5" /> View Uploaded Answer Sheet
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
