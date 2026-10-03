import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { QuestionFilter } from "./analyseSession";

type Props = {
  filters: QuestionFilter[];
  active: QuestionFilter["key"];
  onFilter: (key: QuestionFilter["key"]) => void;
  /** Every question's card, by its order in the session. */
  cards: Array<{ order: number; card: ReactNode }>;
  /** Shown when the session holds no question to review. */
  empty: string;
};

/** The session's questions, filtered to what the analysis found: wrong, skipped, rushed, stuck, met before… */
export function QuestionsTab({ filters, active, onFilter, cards, empty }: Props) {
  const filter = filters.find((f) => f.key === active) ?? filters[0];
  const shown = filter ? cards.filter((c) => filter.orders.includes(c.order)) : cards;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show questions">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter?.key === f.key}
              onClick={() => onFilter(f.key)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                filter?.key === f.key
                  ? "border border-primary/40 bg-primary/15 text-foreground"
                  : "border border-border bg-muted text-muted-foreground hover:bg-secondary",
              )}
            >
              {f.label} ({f.orders.length})
            </button>
          ))}
        </div>
        <Link to="/student/mistakes/types" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          <Tag className="h-3.5 w-3.5" aria-hidden /> Your mistake types
        </Link>
      </div>
      {cards.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">{empty}</Card>
      ) : (
        <div className="space-y-4">{shown.map((c) => <div key={c.order}>{c.card}</div>)}</div>
      )}
    </div>
  );
}
