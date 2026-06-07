import { cn } from "@/lib/utils";

type Day = { date: string; dpp?: number; homework?: number; battles?: number; minutes?: number };

function localDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function AcademicHeatmap({ days }: { days: Day[] }) {
  const map = new Map(days.map((d) => [d.date, (d.dpp ?? 0) + (d.homework ?? 0) + (d.battles ?? 0)]));
  const cells: { date: string; score: number }[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    cells.push({ date: key, score: map.get(key) ?? 0 });
  }
  const max = Math.max(1, ...cells.map((c) => c.score));

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {cells.map((c) => (
        <div
          key={c.date}
          title={`${c.date}: ${c.score} activities`}
          className={cn(
            "aspect-square rounded-md border",
            c.score === 0 && "bg-muted/40 border-border",
            c.score > 0 && c.score < max * 0.4 && "bg-primary/20 border-primary/30",
            c.score >= max * 0.4 && c.score < max * 0.7 && "bg-primary/45 border-primary/40",
            c.score >= max * 0.7 && "bg-primary border-primary",
          )}
        />
      ))}
    </div>
  );
}
