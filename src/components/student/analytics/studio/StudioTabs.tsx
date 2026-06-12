import { cn } from "@/lib/utils";

export type StudioTab = "overview" | "subjects" | "concepts" | "activity";

const TABS: { id: StudioTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "subjects", label: "Subjects" },
  { id: "concepts", label: "Concepts" },
  { id: "activity", label: "Activity" },
];

type Props = {
  active: StudioTab;
  onChange: (tab: StudioTab) => void;
};

export function StudioTabs({ active, onChange }: Props) {
  return (
    <nav className="as-tabs" aria-label="Analytics sections">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={cn("as-tab", active === tab.id && "as-tab--active")}
          onClick={() => onChange(tab.id)}
          aria-current={active === tab.id ? "page" : undefined}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
