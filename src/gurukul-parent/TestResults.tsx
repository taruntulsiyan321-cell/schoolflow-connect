import { ParentLiveExams } from "./ParentLiveAcademic";
import { useParentLiveChildren } from "./ParentLiveAttendance";
import { cn } from "./shared";
import { Loader2 } from "lucide-react";

/**
 * Test Results â€” MarksService + TestService (no mock testResultsByChild).
 */
export default function TestResults({
  activeChildId,
  setActiveChildId,
}: {
  activeChildId: string;
  setActiveChildId: (id: string) => void;
}) {
  const { children, loading, error } = useParentLiveChildren();
  const child = children.find((c) => c.id === activeChildId) ?? children[0];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loadingâ€¦
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-[#cc5069] py-16 text-center">
        Failed to load children: {error}
      </div>
    );
  }

  if (!child) {
    return (
      <div className="text-sm text-muted-foreground py-16 text-center">
        No linked children for test results.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {children.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {children.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveChildId(c.id)}
              className={cn(
                "px-4 py-2 rounded-xl border text-xs font-semibold",
                c.id === child.id
                  ? "bg-[#3b5bdb]/10 border-[#3b5bdb]/30 text-[#3b5bdb]"
                  : "bg-surface border-border/70 text-muted-foreground",
              )}
            >
              {c.fullName}
            </button>
          ))}
        </div>
      )}
      <div className="text-base font-black text-foreground">{child.fullName}</div>
      <ParentLiveExams studentId={child.id} classId={child.classId} />
    </div>
  );
}
