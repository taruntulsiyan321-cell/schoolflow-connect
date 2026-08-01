import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard, SectionLabel, cn, subjectColor } from "@/gurukul/components/shared";
import { Clock, MapPin, User, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

const PERIODS = ["1", "2", "3", "4", "Lunch", "5", "6", "7"] as const;
const DAY_MAP = [
  { short: "Mon", full: "Monday" },
  { short: "Tue", full: "Tuesday" },
  { short: "Wed", full: "Wednesday" },
  { short: "Thu", full: "Thursday" },
  { short: "Fri", full: "Friday" },
] as const;

const SUBJECT_ICONS: Record<string, string> = {
  Mathematics: "∑",
  Physics: "⚡",
  Chemistry: "⚗",
  Biology: "🧬",
  English: "✍",
  "Physics Lab": "⚡",
  "Chemistry Lab": "⚗",
};

const TODAY_IDX = Math.min(new Date().getDay() - 1, 4);

interface PeriodRow {
  time: string;
  subject: string;
  teacher: string;
  room: string;
  color: string;
}

interface DaySchedule {
  day: string;
  periods: PeriodRow[];
}

function normalizeTimetableGrid(grid: unknown): Record<string, string> {
  if (!grid || typeof grid !== "object" || Array.isArray(grid)) return {};
  return Object.fromEntries(
    Object.entries(grid as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]),
  );
}

function gridToTimetable(grid: Record<string, string>): DaySchedule[] {
  return DAY_MAP.map(({ short, full }) => ({
    day: full,
    periods: PERIODS.map((period) => {
      const raw = grid[`${short}-${period}`]?.trim() ?? "";
      const isLunchSlot = period === "Lunch";
      const isBreak = isLunchSlot || !raw;
      const subject = isLunchSlot ? (raw || "Lunch") : (raw || "Free Period");
      return {
        time: isLunchSlot ? "Break" : `Period ${period}`,
        subject,
        teacher: "",
        room: "",
        color: isBreak ? "#78788c" : (subjectColor[subject] ?? subjectColor[raw] ?? "#78788c"),
      };
    }),
  }));
}

export default function Timetable() {
  const { user } = useAuth();
  const [dayIdx, setDayIdx] = useState(TODAY_IDX < 0 ? 0 : TODAY_IDX);
  const [timetable, setTimetable] = useState<DaySchedule[]>([]);
  const [classLabel, setClassLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasTimetable, setHasTimetable] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: s } = await supabase
          .from("students")
          .select("class_id, classes(name, section)")
          .eq("user_id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (s?.classes) {
          const cls = s.classes as { name?: string; section?: string };
          const name = cls.name ?? "";
          const section = cls.section ?? "";
          setClassLabel(section ? `${name} — Section ${section}` : name);
        } else {
          setClassLabel("");
        }

        if (!s?.class_id) {
          setTimetable([]);
          setHasTimetable(false);
          return;
        }

        const { data: tt } = await supabase
          .from("class_timetables")
          .select("grid")
          .eq("class_id", s.class_id)
          .maybeSingle();

        if (cancelled) return;

        const grid = normalizeTimetableGrid(tt?.grid);
        const populated = Object.values(grid).some((v) => v.trim() !== "");
        setHasTimetable(populated);
        setTimetable(populated ? gridToTimetable(grid) : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const day = timetable[dayIdx];
  const periods = day?.periods ?? [];
  const classSubjects = useMemo(
    () =>
      periods.filter(
        (p) =>
          p.subject &&
          p.subject !== "Lunch" &&
          p.subject !== "Free Period" &&
          p.time !== "Break",
      ),
    [periods],
  );

  function getCurrentPeriod() {
    return periods.findIndex((p) => {
      if (!p.time.startsWith("Period ")) return false;
      const n = parseInt(p.time.replace("Period ", ""), 10);
      const hour = new Date().getHours();
      const approxStart = 7 + n;
      return hour === approxStart;
    });
  }
  const currentPeriodIdx = getCurrentPeriod();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#78788c]">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading timetable…
      </div>
    );
  }

  if (!hasTimetable) {
    return (
      <div className="space-y-6">
        <GlassCard glow="blue" className="p-6">
          <h2 className="text-2xl font-black text-white" style={{ fontFamily: "var(--font-display)" }}>
            Class Timetable
          </h2>
          {classLabel && <p className="text-sm text-[#78788c] mt-0.5">{classLabel}</p>}
        </GlassCard>
        <GlassCard className="p-8 text-center">
          <p className="text-sm text-[#78788c]">No timetable set up for your class yet.</p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <GlassCard glow="blue" className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-white" style={{ fontFamily: "var(--font-display)" }}>
              Class Timetable
            </h2>
            <p className="text-sm text-[#78788c] mt-0.5">{classLabel || "Your class schedule"}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDayIdx((i) => Math.max(0, i - 1))}
              className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white hover:border-white/25 transition-all disabled:opacity-30"
              disabled={dayIdx === 0}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex gap-1.5">
              {DAY_MAP.map((d, i) => (
                <button
                  key={d.full}
                  onClick={() => setDayIdx(i)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                    i === dayIdx
                      ? "bg-[#3b5bdb] text-white"
                      : "text-[#78788c] hover:text-white hover:bg-white/5",
                  )}
                >
                  {d.full.slice(0, 3)}
                </button>
              ))}
            </div>
            <button
              onClick={() => setDayIdx((i) => Math.min(4, i + 1))}
              className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white hover:border-white/25 transition-all disabled:opacity-30"
              disabled={dayIdx === 4}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Today summary pills */}
      <div className="flex flex-wrap gap-2">
        {classSubjects.map((p, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold"
            style={{ borderColor: `${p.color}30`, background: `${p.color}10`, color: p.color }}
          >
            {p.subject}
          </div>
        ))}
      </div>

      {/* Period list */}
      <div className="space-y-2">
        <SectionLabel>{day?.day}</SectionLabel>
        {periods.map((period, idx) => {
          const isBreak = period.subject === "Lunch" || period.time === "Break" || period.subject === "Free Period";
          const isCurrent = idx === currentPeriodIdx;
          return (
            <div
              key={idx}
              className={cn(
                "flex items-stretch gap-4 rounded-2xl border transition-all duration-200",
                isCurrent
                  ? "border-[#3b5bdb]/40 bg-[#3b5bdb]/8 shadow-[0_0_24px_rgba(59,130,246,0.12)]"
                  : "border-white/5 bg-[#131316]/70",
                isBreak && "opacity-50",
              )}
            >
              {!isBreak && <div className="w-1 rounded-l-2xl shrink-0" style={{ background: period.color }} />}

              <div className={cn("flex-1 py-4 pr-4", isBreak && "pl-4")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn("text-sm font-bold", isBreak ? "text-[#78788c]" : "text-white")}>
                        {period.subject}
                      </span>
                      {isCurrent && (
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#3b5bdb]/20 text-[#3b5bdb]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3b5bdb] animate-pulse" />
                          NOW
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1 text-[11px] text-[#78788c]">
                        <Clock className="w-3 h-3" />
                        {period.time}
                      </div>
                      {period.teacher && (
                        <div className="flex items-center gap-1 text-[11px] text-[#78788c]">
                          <User className="w-3 h-3" />
                          {period.teacher}
                        </div>
                      )}
                      {period.room && (
                        <div className="flex items-center gap-1 text-[11px] text-[#78788c]">
                          <MapPin className="w-3 h-3" />
                          {period.room}
                        </div>
                      )}
                    </div>
                  </div>
                  {!isBreak && (
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                      style={{ background: `${period.color}15` }}
                    >
                      {SUBJECT_ICONS[period.subject] ?? "📖"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Weekly overview grid */}
      <div>
        <SectionLabel>Full Week at a Glance</SectionLabel>
        <div className="overflow-x-auto">
          <div className="min-w-[640px] grid grid-cols-5 gap-2">
            {timetable.map((d, di) => (
              <div key={d.day}>
                <div
                  className={cn(
                    "text-center text-xs font-bold mb-2 py-1.5 rounded-lg",
                    di === dayIdx ? "bg-[#3b5bdb]/20 text-[#3b5bdb]" : "text-[#78788c]",
                  )}
                >
                  {d.day.slice(0, 3)}
                </div>
                <div className="space-y-1">
                  {d.periods
                    .filter(
                      (p) =>
                        p.subject &&
                        p.subject !== "Lunch" &&
                        p.subject !== "Free Period" &&
                        p.time !== "Break",
                    )
                    .map((p, pi) => (
                      <div
                        key={pi}
                        className="px-2 py-1.5 rounded-lg text-[10px] font-semibold truncate"
                        style={{ background: `${p.color}15`, color: p.color }}
                      >
                        {p.subject.replace(" Lab", "")}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
