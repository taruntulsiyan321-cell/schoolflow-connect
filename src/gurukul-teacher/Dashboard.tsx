import { useEffect, useState } from "react";
import {
  BookOpen, ClipboardList, CheckSquare, MessageCircle, Calendar,
  Users, FileText, HelpCircle, Loader2,
} from "lucide-react";
import { cn } from "./shared";
import type { TeacherPageKey } from "./nav";
import {
  AttendanceService,
  HomeworkService,
  TestService,
  DoubtService,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

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

/** Teacher home — Academic Engine stats only (no mock assignedClasses / homeworkByClass). */
export default function TeacherHome({ setPage }: { setPage: (p: TeacherPageKey) => void }) {
  const { ctx, ready } = useAcademicContext();
  const [loading, setLoading] = useState(true);
  const [classCount, setClassCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [hwPending, setHwPending] = useState(0);
  const [testsCount, setTestsCount] = useState(0);
  const [doubtsOpen, setDoubtsOpen] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const classes = await AttendanceService.listAssignedClasses(ctx);
        let students = 0;
        let pending = 0;
        let tests = 0;
        for (const c of classes) {
          students += c.studentCount;
          const hw = await HomeworkService.listForClassWithStats(ctx, c.id, { limit: 50 });
          pending += hw.reduce((s, h) => s + h.pending, 0);
          const t = await TestService.listForClass(ctx, c.id);
          tests += t.length;
        }
        let open = 0;
        try {
          const doubts = await DoubtService.list(ctx);
          open = (doubts as any[]).filter((d) => d.status === "open" || d.status === "pending").length;
        } catch {
          open = 0;
        }
        if (cancelled) return;
        setClassCount(classes.length);
        setStudentCount(students);
        setHwPending(pending);
        setTestsCount(tests);
        setDoubtsOpen(open);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading academic dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#3b5bdb]/10 to-[#f59e0b]/5 border border-[#3b5bdb]/20 rounded-2xl p-5">
        <div className="text-sm font-black text-white">Teacher Dashboard</div>
        <div className="text-xs text-[#78788c] mt-0.5">
          {studentCount} students across {classCount} assigned classes · Academic Engine
        </div>
        {error && <div className="text-xs text-[#cc5069] mt-2">{error}</div>}
      </div>

      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-3">Quick Actions</div>
        <div className="grid grid-cols-4 gap-3">
          <QuickAction icon={<Users className="w-5 h-5" />} label="Mark Attendance" color="#f59e0b" onClick={() => setPage("myclasses")} />
          <QuickAction icon={<BookOpen className="w-5 h-5" />} label="Homework" color="#10b981" onClick={() => setPage("myclasses")} />
          <QuickAction icon={<ClipboardList className="w-5 h-5" />} label="Tests" color="#6366f1" onClick={() => setPage("myclasses")} />
          <QuickAction icon={<FileText className="w-5 h-5" />} label="Leave" color="#78788c" onClick={() => setPage("leave")} />
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-3">Pending Items</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<BookOpen className="w-5 h-5" />} label="HW pending reviews" value={hwPending} color="#f59e0b" sublabel="From HomeworkService" />
          <StatCard icon={<CheckSquare className="w-5 h-5" />} label="Class tests" value={testsCount} color="#10b981" sublabel="From TestService" />
          <StatCard icon={<HelpCircle className="w-5 h-5" />} label="Open doubts" value={doubtsOpen} color="#6366f1" sublabel="From DoubtService" />
          <StatCard icon={<Users className="w-5 h-5" />} label="Students" value={studentCount} color="#3b5bdb" sublabel={`${classCount} classes`} />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setPage("myclasses")}
        className={cn("w-full p-4 rounded-2xl border border-white/7 bg-[#131316] text-left hover:border-[#3b5bdb]/40")}
      >
        <div className="text-xs font-bold text-white flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#3b5bdb]" /> Open My Classes
        </div>
        <div className="text-[10px] text-[#78788c] mt-1">Students · Attendance · Homework · Tests · Insights</div>
      </button>
    </div>
  );
}
