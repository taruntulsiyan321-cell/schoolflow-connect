import {
  UserCheck, BookOpen, ClipboardList, Bell,
  ChevronRight, TrendingUp, Loader2,
} from "lucide-react";
import { cn } from "./shared";
import type { ParentPageKey } from "./nav";
import {
  useChildAttendancePct,
  useParentLiveChildren,
} from "./ParentLiveAttendance";
import { ParentLivePerformance } from "./ParentLiveAcademic";
import { HomeworkService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { useEffect, useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";

function QuickStat({
  label,
  value,
  sub,
  color,
  icon,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-lg font-black tabular-nums text-white">{value}</div>
        <div className="text-[10px] font-semibold text-[#78788c]">{label}</div>
        {sub && <div className="text-[9px] text-[#46465a]">{sub}</div>}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="bg-[#131316] border border-white/7 rounded-2xl p-4 flex items-center gap-3 text-left hover:border-white/15 transition-all w-full"
      >
        {body}
      </button>
    );
  }
  return (
    <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 flex items-center gap-3">
      {body}
    </div>
  );
}

/**
 * Parent Dashboard — academic stats from Academic Engine only.
 */
export default function ParentDashboard({
  setPage,
  activeChildId,
  setActiveChildId,
}: {
  setPage: (p: ParentPageKey) => void;
  activeChildId: string;
  setActiveChildId: (id: string) => void;
}) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "profile"]);
  const { children: liveChildren, loading: childrenLoading, error: childrenError } = useParentLiveChildren();
  const liveChild = liveChildren.find((c) => c.id === activeChildId) ?? liveChildren[0];
  const attendanceId = liveChild?.id ?? null;
  const {
    pct: attendancePct,
    present: presentDays,
    total: schoolDays,
    todayStatus,
    unavailable: attendanceUnavailable,
    loading: attendanceLoading,
  } = useChildAttendancePct(attendanceId);
  const [pendingHw, setPendingHw] = useState(0);
  const { unread: unreadNotifications } = useNotifications();

  useEffect(() => {
    if (liveChild && liveChild.id !== activeChildId) {
      setActiveChildId(liveChild.id);
    }
  }, [liveChild, activeChildId, setActiveChildId]);

  useEffect(() => {
    if (!ready || !ctx || !attendanceId) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await HomeworkService.listForStudent(ctx, attendanceId);
        if (!cancelled) {
          setPendingHw(rows.filter((r) => !r.submission || ["pending", "returned"].includes(r.submission.status)).length);
        }
      } catch {
        if (!cancelled) setPendingHw(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, attendanceId, liveVersion]);

  if (childrenLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading children…
      </div>
    );
  }

  if (childrenError) {
    return (
      <div className="text-sm text-[#cc5069] py-16 text-center">
        Failed to load children: {childrenError}
      </div>
    );
  }

  if (!liveChild) {
    return (
      <div className="text-sm text-[#78788c] py-16 text-center">
        No linked children. Connect a student to this parent account to see Academic Engine data.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {liveChildren.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {liveChildren.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveChildId(c.id)}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all",
                activeChildId === c.id || liveChild.id === c.id
                  ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30 text-[#3b5bdb]"
                  : "bg-[#131316] border-white/7 text-[#78788c]",
              )}
            >
              <div className="text-xs font-bold">{c.fullName}</div>
              <div className="text-[9px] opacity-60">{c.classLabel}</div>
            </button>
          ))}
        </div>
      )}

      <div className="bg-gradient-to-br from-[#131316] to-[#0d1a14] border border-[#3b5bdb]/15 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
          <span className="text-lg font-black text-white">
            {liveChild.fullName.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-black text-white">{liveChild.fullName}</div>
          <div className="text-xs text-[#78788c] mt-0.5">
            {liveChild.classLabel} · Roll {liveChild.rollNumber ?? "—"}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={cn(
              "text-xs font-bold px-3 py-1.5 rounded-xl capitalize",
              attendanceLoading || attendanceUnavailable
                ? "bg-white/8 text-[#78788c]"
                : todayStatus === "present" || todayStatus === "late"
                  ? "bg-[#3b5bdb]/15 text-[#3b5bdb]"
                  : todayStatus === "absent"
                    ? "bg-[#cc5069]/15 text-[#cc5069]"
                    : "bg-white/8 text-[#78788c]",
            )}
          >
            {attendanceLoading
              ? "Loading…"
              : attendanceUnavailable
                ? "Status unavailable"
                : todayStatus
                  ? `${todayStatus.replace("_", " ")} today`
                  : "Not marked today"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickStat
          label="Attendance"
          value={attendanceLoading ? "…" : attendanceUnavailable ? "—" : `${attendancePct}%`}
          sub={
            attendanceLoading
              ? "Loading…"
              : attendanceUnavailable
                ? "Unavailable — try again later"
                : `${presentDays}/${schoolDays} days`
          }
          color="#3b5bdb"
          icon={<UserCheck className="w-5 h-5" />}
        />
        <QuickStat
          label="Pending Homework"
          value={pendingHw}
          sub="HomeworkService"
          color={pendingHw > 0 ? "#c08a3a" : "#3b5bdb"}
          icon={<BookOpen className="w-5 h-5" />}
        />
        <QuickStat
          label="Notifications"
          value={unreadNotifications}
          sub="unread — tap to open"
          color={unreadNotifications > 0 ? "#cc5069" : "#78788c"}
          icon={<Bell className="w-5 h-5" />}
          onClick={() => setPage("notifications")}
        />
        <QuickActionCard setPage={setPage} />
      </div>

      <div className="bg-[#131316] border border-white/7 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#3b5bdb]" /> Academic Performance
          </div>
          <button
            type="button"
            onClick={() => setPage("academic_insights")}
            className="text-[10px] text-[#3b5bdb] hover:underline flex items-center gap-1"
          >
            Full insights <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        <ParentLivePerformance studentId={liveChild.id} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setPage("children")}
          className="p-4 rounded-2xl border border-white/7 bg-[#131316] text-left"
        >
          <ClipboardList className="w-4 h-4 text-[#6366f1] mb-2" />
          <div className="text-xs font-bold text-white">My Children</div>
          <div className="text-[10px] text-[#78788c]">Attendance · Homework · Exams</div>
        </button>
        <button
          type="button"
          onClick={() => setPage("test_results")}
          className="p-4 rounded-2xl border border-white/7 bg-[#131316] text-left"
        >
          <BookOpen className="w-4 h-4 text-[#3b5bdb] mb-2" />
          <div className="text-xs font-bold text-white">Test Results</div>
          <div className="text-[10px] text-[#78788c]">MarksService · TestService</div>
        </button>
      </div>
    </div>
  );
}

function QuickActionCard({ setPage }: { setPage: (p: ParentPageKey) => void }) {
  return (
    <button
      type="button"
      onClick={() => setPage("children")}
      className="bg-[#131316] border border-white/7 rounded-2xl p-4 flex items-center gap-3 text-left hover:border-[#3b5bdb]/40"
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[#3b5bdb]/15 text-[#3b5bdb]">
        <ClipboardList className="w-5 h-5" />
      </div>
      <div>
        <div className="text-lg font-black text-white">Open</div>
        <div className="text-[10px] font-semibold text-[#78788c]">Child details</div>
      </div>
    </button>
  );
}
