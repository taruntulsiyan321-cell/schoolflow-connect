import { useState } from "react";
import { withAlpha } from "@/lib/colorAlpha";
import { cn } from "./shared";
import { ParentLiveAttendance, useParentLiveChildren } from "./ParentLiveAttendance";
import { ParentLiveHomework, ParentLiveExams, ParentLivePerformance } from "./ParentLiveAcademic";
import { toDisplayText } from "@/lib/presentation";

type ChildTab = "profile" | "attendance" | "homework" | "exams" | "performance";

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("text-[10px] font-semibold px-3 py-1.5 rounded-[2px] whitespace-nowrap transition-all",
        active ? "bg-primary/15 text-primary border border-primary/25" : "text-muted-foreground hover:text-foreground border border-transparent")}>
      {children}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    // `bg-card` with a border, not `bg-muted`. Muted ink on a muted fill
    // measured 2.93:1 — `--muted-foreground` and `--muted` are adjacent steps
    // on the same warm ramp, so stacking them leaves the label barely there.
    // The design puts content on the card surface and separates it with a
    // hairline, which is both on-pattern and legible.
    <div className="flex flex-col gap-0.5 p-3 rounded-[2px] bg-card border border-border">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">{label}</div>
      <div className="text-sm text-foreground">{value}</div>
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
    return <div className="text-xs text-muted-foreground py-16 text-center">Loading linked children…</div>;
  }

  if (liveError) {
    return (
      <div className="text-xs text-destructive py-16 text-center">
        Failed to load children: {liveError}
      </div>
    );
  }

  if (liveChildren.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-16 text-center space-y-2">
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
              className={cn("flex items-center gap-3 px-4 py-3 rounded-[2px] border transition-all text-left",
                c.id === liveChild?.id
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-surface border-border/70 text-muted-foreground hover:border-border")}>
              <div className="w-8 h-8 rounded-[2px] flex items-center justify-center font-black text-xs"
                style={{ background: c.id === liveChild?.id ? withAlpha("hsl(var(--primary))", 0.19) : "hsl(var(--muted))", color: c.id === liveChild?.id ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
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

      <div className="bg-surface border border-border/70 rounded-[2px] overflow-hidden">
        <div className="p-5 border-b border-border/70 flex items-center gap-4 bg-gradient-to-r from-primary/5 to-transparent">
          <div className="w-14 h-14 rounded-[2px] bg-primary flex items-center justify-center shrink-0">
            <span className="text-lg font-black text-primary-foreground">{displayName.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-black text-foreground">{displayName}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{displayClass} · Roll {displayRoll}</div>
          </div>
        </div>

        <div className="flex gap-1 px-4 py-3 border-b border-border/70 overflow-x-auto">
          {tabs.map((t) => <TabBtn key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</TabBtn>)}
        </div>

        <div className="p-5">
          {tab === "profile" && (
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Full Name", value: displayName },
                { label: "Class", value: displayClass },
                { label: "Roll Number", value: displayRoll },
                // Never the row's UUID — parents identify a child by the
                // school's admission number.
                { label: "Admission Number", value: toDisplayText(liveChild?.admissionNumber, { kind: "label" }) },
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
