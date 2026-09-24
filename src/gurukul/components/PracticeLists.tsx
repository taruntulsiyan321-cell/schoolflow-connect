import type { ReactNode } from "react";
import type { AcademicTermRef } from "@/academic/services/practiceService";
import { displaySubject, presentAcademicLabel } from "@/lib/academicPresentation";
import { cn } from "@/gurukul/components/shared";
import type { ListState } from "@/lib/listState";

export type PracticeSubject = { id: string; name: string; color: string };

const chipClass = (on: boolean) => cn(
  "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all max-w-full truncate",
  on
    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
    : "border border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
);

export const ListLoading = () => (
  <p role="status" className="text-xs text-muted-foreground">Loading…</p>
);

export const ListFailed = ({ onRetry }: { onRetry?: () => void }) => (
  <p className="text-xs text-destructive">
    Could not load this list.{" "}
    {onRetry && (
      <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button>
    )}
  </p>
);

function PickerBody<T>({ list, empty, onRetry, children }: {
  list: ListState<T>;
  empty: string;
  onRetry?: () => void;
  children: (items: T[]) => ReactNode;
}) {
  if (list.status === "loading") return <ListLoading />;
  if (list.status === "failed") return <ListFailed onRetry={onRetry} />;
  if (list.items.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return <div className="flex flex-wrap gap-2">{children(list.items)}</div>;
}

const PickerLabel = ({ children }: { children: ReactNode }) => (
  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{children}</div>
);

export function SubjectPicker({
  list, selected, onSelect, onRetry, allowAll = true, label = "Subject",
  emptyMessage = "No subjects in the question bank yet for your class and board.",
}: {
  list: ListState<PracticeSubject>;
  selected: string | null;
  onSelect: (s: string | null) => void;
  onRetry?: () => void;
  allowAll?: boolean;
  label?: string;
  emptyMessage?: string;
}) {
  return (
    <div>
      <PickerLabel>{label}</PickerLabel>
      <PickerBody list={list} empty={emptyMessage} onRetry={onRetry}>
        {(subjects) => (
          <>
            {allowAll && (
              <button type="button" onClick={() => onSelect(null)} className={chipClass(selected === null)}>All</button>
            )}
            {subjects.map((s) => (
              <button key={s.id} type="button" onClick={() => onSelect(s.name)} className={chipClass(selected === s.name)}>
                {displaySubject(s.name) || s.name}
              </button>
            ))}
          </>
        )}
      </PickerBody>
    </div>
  );
}

export function OptionChips({
  label, list, selected, onSelect, onRetry, allowClear, empty = "Nothing available yet.",
}: {
  label: string;
  list: ListState<AcademicTermRef>;
  selected: string | null;
  onSelect: (v: string | null) => void;
  onRetry?: () => void;
  allowClear?: boolean;
  empty?: string;
}) {
  return (
    <div>
      <PickerLabel>{label}</PickerLabel>
      <PickerBody list={list} empty={empty} onRetry={onRetry}>
        {(options) => (
          <>
            {allowClear && (
              <button type="button" onClick={() => onSelect(null)} className={chipClass(selected === null)}>Any</button>
            )}
            {options.map((opt) => (
              <button key={opt.id} type="button" onClick={() => onSelect(opt.id)} className={chipClass(selected === opt.id)}
                title={opt.displayName}>
                {opt.displayName || presentAcademicLabel(opt.id)}
              </button>
            ))}
          </>
        )}
      </PickerBody>
    </div>
  );
}
