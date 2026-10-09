import { cn } from "@/lib/utils";
import type { SessionTab } from "./useSessionTabs";

const SESSION_TABS: ReadonlyArray<{ key: SessionTab; label: string }> = [
  { key: "summary", label: "Summary" },
  { key: "topics", label: "Topics" },
  { key: "time", label: "Time" },
  { key: "questions", label: "Questions" },
];

/** The four tabs a finished practice session or mock paper is read through (useSessionTabs). */
export function SessionTabBar({ tab, onTab, label }: { tab: SessionTab; onTab: (tab: SessionTab) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-5 -mx-1 flex gap-0 overflow-x-auto border-b border-border/70 px-1">
      {SESSION_TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={tab === t.key}
          onClick={() => onTab(t.key)}
          className={cn(
            "shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-all duration-150",
            tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
