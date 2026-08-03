import { useEffect, useMemo, useState } from "react";
import { HomeworkService, MarksService, TestService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toast } from "@/hooks/use-toast";
import { displaySubject } from "@/lib/academicPresentation";
import { GlassCard, SectionLabel, cn, subjectColor } from "@/gurukul/components/shared";
import { ChevronLeft, ChevronRight, CalendarDays, BookOpen, ClipboardList, AlertCircle, Star, Loader2 } from "lucide-react";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type EventType = "test" | "deadline" | "event" | "holiday" | "exam";

interface CalendarEvent {
  id: string;
  date: string;
  title: string;
  subject: string;
  type: EventType;
  color: string;
}

const TYPE_META: Record<EventType, { label: string; color: string; icon: React.ReactNode }> = {
  test: { label: "Test", color: "#3b5bdb", icon: <BookOpen className="w-3 h-3" /> },
  deadline: { label: "Deadline", color: "#c08a3a", icon: <ClipboardList className="w-3 h-3" /> },
  event: { label: "Event", color: "#4aa87a", icon: <Star className="w-3 h-3" /> },
  holiday: { label: "Holiday", color: "#78788c", icon: <CalendarDays className="w-3 h-3" /> },
  exam: { label: "Exam", color: "#cc5069", icon: <AlertCircle className="w-3 h-3" /> },
};

function toDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function colorForSubject(subject: string, type: EventType): string {
  if (type === "exam") return "#cc5069";
  const key = displaySubject(subject) || subject;
  if (type === "deadline") return subjectColor[key] ?? subjectColor[subject] ?? "#c08a3a";
  return subjectColor[key] ?? subjectColor[subject] ?? "#3b5bdb";
}

export default function Calendar() {
  const now = new Date();
  const { ctx, ready, studentId, classId } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "test", "examination", "marks"]);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  useEffect(() => {
    if (!ready || !ctx || !studentId) {
      setCalendarEvents([]);
      endLoading(setLoading);
      return;
    }
    let cancelled = false;
    (async () => {
      beginLoading(setLoading);
      try {
        const settled = await Promise.allSettled([
          HomeworkService.listForStudent(ctx, studentId),
          classId ? TestService.listForClass(ctx, classId) : Promise.resolve([]),
          classId ? MarksService.listExamsForClass(ctx, classId, { limit: 50 }) : Promise.resolve([]),
        ]);
        if (cancelled) return;

        const events: CalendarEvent[] = [];

        const homeworkRows = settled[0].status === "fulfilled" ? settled[0].value : [];
        for (const row of homeworkRows) {
          const date = toDateKey(row.homework.dueDate);
          if (!date) continue;
          const subject = row.homework.subject ?? "";
          events.push({
            id: `hw-${row.homework.id}`,
            date,
            title: row.homework.title,
            subject,
            type: "deadline",
            color: colorForSubject(subject, "deadline"),
          });
        }

        const tests = settled[1].status === "fulfilled" ? settled[1].value : [];
        for (const t of tests as { id: string; title: string; subject?: string; due_at?: string | null }[]) {
          const date = toDateKey(t.due_at);
          if (!date) continue;
          const subject = t.subject ?? "";
          events.push({
            id: `test-${t.id}`,
            date,
            title: t.title,
            subject,
            type: "test",
            color: colorForSubject(subject, "test"),
          });
        }

        const exams = settled[2].status === "fulfilled" ? settled[2].value : [];
        for (const e of exams) {
          const date = toDateKey(e.examDate);
          if (!date) continue;
          const subject = e.subject ?? "";
          events.push({
            id: `exam-${e.id}`,
            date,
            title: e.name,
            subject,
            type: "exam",
            color: colorForSubject(subject, "exam"),
          });
        }

        setCalendarEvents(events);
        if (settled.every((s) => s.status === "rejected")) {
          toast({
            title: "Could not load calendar",
            description: "Showing an empty calendar until Academic Engine responds.",
            variant: "destructive",
          });
        }
      } catch (e) {
        if (!cancelled) {
          setCalendarEvents([]);
          toast({
            title: "Could not load calendar",
            description: e instanceof Error ? e.message : "Unknown error",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) endLoading(setLoading);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId, classId, liveVersion]);

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function dateKey(day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function eventsFor(day: number) {
    const key = dateKey(day);
    return calendarEvents.filter((e) => e.date === key);
  }

  const selectedEvents = selectedDate ? calendarEvents.filter((e) => e.date === selectedDate) : [];

  const upcoming = useMemo(
    () =>
      [...calendarEvents]
        .filter((e) => e.date >= new Date().toISOString().slice(0, 10))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 8),
    [calendarEvents],
  );

  if (showLoading(loading)) {
    return (
      <div className="flex items-center justify-center py-16 text-[#78788c]">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading calendar…
      </div>
    );
  }

  if (ready && !studentId) {
    return (
      <div className="text-center text-sm text-[#78788c] py-16">
        No student profile linked to this account.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <GlassCard glow="cyan" className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-white" style={{ fontFamily: "var(--font-display)" }}>
              Class Calendar
            </h2>
            <p className="text-sm text-[#78788c] mt-0.5">Tests, exams, events & deadlines</p>
          </div>
          <div className="flex items-center gap-2">
            {(Object.entries(TYPE_META) as [EventType, (typeof TYPE_META)[EventType]][]).slice(0, 4).map(([type, meta]) => (
              <div
                key={type}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-semibold"
                style={{ borderColor: `${meta.color}30`, color: meta.color, background: `${meta.color}12` }}
              >
                {meta.icon}
                {meta.label}
              </div>
            ))}
          </div>
        </div>
      </GlassCard>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* Calendar grid */}
        <GlassCard className="p-5">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-5">
            <button
              onClick={prevMonth}
              className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white hover:border-white/25 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h3 className="text-base font-black text-white" style={{ fontFamily: "var(--font-display)" }}>
              {MONTH_NAMES[month]} {year}
            </h3>
            <button
              onClick={nextMonth}
              className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white hover:border-white/25 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-2">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-[10px] uppercase tracking-widest text-[#78788c] py-1.5">
                {d}
              </div>
            ))}
          </div>

          {/* Days */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} />;
              const key = dateKey(day);
              const events = eventsFor(day);
              const isSelected = selectedDate === key;
              const isToday = key === new Date().toISOString().slice(0, 10);
              const hasExam = events.some((e) => e.type === "exam");
              const hasTest = events.some((e) => e.type === "test");
              const hasDeadline = events.some((e) => e.type === "deadline");
              const hasEvent = events.some((e) => e.type === "event");
              const isHoliday = events.some((e) => e.type === "holiday");
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedDate(isSelected ? null : key)}
                  className={cn(
                    "aspect-square flex flex-col items-center justify-between rounded-xl p-1 transition-all duration-150 text-xs font-semibold relative",
                    isSelected
                      ? "bg-[#3b5bdb] text-white"
                      : isToday
                        ? "bg-[#3b5bdb]/15 text-blue-400 border border-[#3b5bdb]/30"
                        : isHoliday
                          ? "opacity-40 text-[#78788c]"
                          : "text-[#a0aec0] hover:bg-white/5 hover:text-white",
                  )}
                >
                  <span className="mt-1">{day}</span>
                  {events.length > 0 && (
                    <div className="flex gap-0.5 mb-1 flex-wrap justify-center">
                      {hasExam && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#cc5069" }} />}
                      {hasTest && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#3b5bdb" }} />}
                      {hasDeadline && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#c08a3a" }} />}
                      {hasEvent && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#4aa87a" }} />}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected day events */}
          {selectedDate && selectedEvents.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
              <div className="text-xs font-semibold text-[#78788c] uppercase tracking-wider">
                {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-IN", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </div>
              {selectedEvents.map((e) => {
                const meta = TYPE_META[e.type as EventType];
                return (
                  <div
                    key={e.id}
                    className="flex items-center gap-3 p-3 rounded-xl border"
                    style={{ borderColor: `${e.color}25`, background: `${e.color}08` }}
                  >
                    <span style={{ color: e.color }}>{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{e.title}</div>
                      {e.subject && <div className="text-[11px] text-[#78788c]">{displaySubject(e.subject) || e.subject}</div>}
                    </div>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                      style={{ color: e.color, background: `${e.color}15` }}
                    >
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* Upcoming events */}
        <div className="space-y-4">
          <GlassCard glow="rose" className="p-5">
            <SectionLabel>Upcoming</SectionLabel>
            {upcoming.length === 0 ? (
              <p className="text-xs text-[#78788c] py-4 text-center">No upcoming events</p>
            ) : (
              <div className="space-y-2.5">
                {upcoming.map((e) => {
                  const meta = TYPE_META[e.type as EventType];
                  const d = new Date(e.date + "T00:00:00");
                  const dayStr = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
                  const weekday = d.toLocaleDateString("en-IN", { weekday: "short" });
                  return (
                    <div
                      key={e.id}
                      className="flex items-start gap-3 p-3 rounded-xl border border-white/5 hover:border-white/10 transition-all cursor-pointer"
                      onClick={() => setSelectedDate(e.date)}
                    >
                      <div
                        className="flex flex-col items-center justify-center w-10 h-10 rounded-xl shrink-0"
                        style={{ background: `${e.color}15`, color: e.color }}
                      >
                        <span className="text-xs font-black leading-none">{d.getDate()}</span>
                        <span className="text-[9px] leading-none mt-0.5 opacity-70">{weekday}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{e.title}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span style={{ color: meta.color }}>{meta.icon}</span>
                          <span className="text-[10px] text-[#78788c]">{dayStr}</span>
                          {e.subject && <span className="text-[10px] text-[#78788c]">· {displaySubject(e.subject) || e.subject}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>

          {/* Legend */}
          <GlassCard className="p-4">
            <SectionLabel>Legend</SectionLabel>
            <div className="space-y-2">
              {(Object.entries(TYPE_META) as [EventType, (typeof TYPE_META)[EventType]][]).map(([type, meta]) => (
                <div key={type} className="flex items-center gap-2.5">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: meta.color }} />
                  <span className="text-xs text-[#a0aec0]">{meta.label}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
