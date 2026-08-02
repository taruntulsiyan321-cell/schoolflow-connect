import { useState } from "react";
import { cn } from "./shared";
import { ParentLiveAttendance, useParentLiveChildren } from "./ParentLiveAttendance";
import { ParentLiveHomework, ParentLiveExams, ParentLivePerformance } from "./ParentLiveAcademic";

type ChildTab = "profile" | "attendance" | "homework" | "exams" | "performance";

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

/** My Children — Academic Engine only (no mock children / homework / exams). */
export default function MyChildren({ activeChildId, setActiveChildId }: { activeChildId: string; setActiveChildId: (id: string) => void }) {
  const [tab, setTab] = useState<ChildTab>("profile");
  const { children: liveChildren, loading: liveLoading, error: liveError } = useParentLiveChildren();

  const liveChild = liveChildren.find((c) => c.id === activeChildId) ?? liveChildren[0];
  const displayName = liveChild?.fullName ?? "Child";
  const displayClass = liveChild?.classLabel ?? "";
  const displayRoll = liveChild?.rollNumber ?? "—";
  const attendanceStudentId = liveChild?.id ?? null;

  const tabs: { key: ChildTab; label: string }[] = [
    { key: "profile", label: "Profile" },
    { key: "attendance", label: "Attendance" },
    { key: "homework", label: "Homework" },
    { key: "exams", label: "Exams" },
    { key: "performance", label: "Performance" },
  ];

  if (liveLoading) {
    return <div className="text-xs text-[#78788c] py-16 text-center">Loading linked children…</div>;
  }

  if (liveError) {
    return (
      <div className="text-xs text-[#cc5069] py-16 text-center">
        Failed to load children: {liveError}
      </div>
    );
  }

  if (liveChildren.length === 0) {
    return (
      <div className="text-xs text-[#78788c] py-16 text-center space-y-2">
        <div>No linked children found.</div>
        <div>Link a student via parent portal mapping to load Academic Engine data.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {liveChildren.length > 1 && (
        <div className="flex gap-2">
          {liveChildren.map((c) => (
            <button key={c.id} onClick={() => { setActiveChildId(c.id); setTab("profile"); }}
              className={cn("flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left",
                c.id === liveChild?.id
                  ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30 text-[#3b5bdb]"
                  : "bg-[#131316] border-white/7 text-[#78788c] hover:border-white/15")}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs"
                style={{ background: c.id === liveChild?.id ? "#3b5bdb30" : "#ffffff18", color: c.id === liveChild?.id ? "#3b5bdb" : "#78788c" }}>
                {c.fullName.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <div>
                <div className="text-xs font-bold">{c.fullName}</div>
                <div className="text-[10px] opacity-70">{c.classLabel}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="bg-[#131316] border border-white/7 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-white/7 flex items-center gap-4 bg-gradient-to-r from-[#3b5bdb]/5 to-transparent">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
            <span className="text-lg font-black text-white">{displayName.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-black text-white">{displayName}</div>
            <div className="text-[10px] text-[#78788c] mt-0.5">{displayClass} · Roll {displayRoll}</div>
          </div>
        </div>

        <div className="flex gap-1 px-4 py-3 border-b border-white/7 overflow-x-auto">
          {tabs.map((t) => <TabBtn key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</TabBtn>)}
        </div>

        <div className="p-5">
          {tab === "profile" && (
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Full Name", value: displayName },
                { label: "Class", value: displayClass },
                { label: "Roll Number", value: displayRoll },
                { label: "Student ID", value: attendanceStudentId ?? "—" },
              ].map((row) => <InfoRow key={row.label} label={row.label} value={row.value} />)}
            </div>
          )}

          {tab === "attendance" && attendanceStudentId && (
            <ParentLiveAttendance studentId={attendanceStudentId} />
          )}
          {tab === "homework" && attendanceStudentId && (
            <ParentLiveHomework studentId={attendanceStudentId} />
          )}
          {tab === "exams" && attendanceStudentId && (
            <ParentLiveExams studentId={attendanceStudentId} classId={liveChild?.classId ?? null} />
          )}
          {tab === "performance" && attendanceStudentId && (
            <ParentLivePerformance studentId={attendanceStudentId} />
          )}
        </div>
      </div>
    </div>
  );
}
