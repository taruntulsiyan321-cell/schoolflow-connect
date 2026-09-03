import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WeeklyActivityPoint } from "@/hooks/useStudentPerformanceCharts";
import { accuracyBand, riskBand, type AccuracyBand, type Band } from "@/academic/metrics/bands";

/**
 * Palettes, keyed by rung. Five rungs over a four-colour palette, so `building`
 * and `near` share a swatch — the LABEL separates them, and inventing a fifth
 * hex to fill the gap would be a design decision made by a refactor.
 *
 * `unknown` is new. These bars took a non-null `number` and drew NaN as the
 * worst rung; an unmeasured subject is now drawn as unmeasured.
 */
const SOFT_BAR: Record<AccuracyBand, string> = {
  unknown: "bg-[#E0DDD4]",
  low: "bg-[#E07A5F]",
  weak: "bg-[#D4A574]",
  building: "bg-[#81B29A]",
  near: "bg-[#81B29A]",
  high: "bg-[#7A9E7E]",
};
const DEFAULT_BAR: Record<AccuracyBand, string> = {
  unknown: "bg-muted",
  low: "bg-destructive",
  weak: "bg-warning",
  building: "bg-primary",
  near: "bg-primary",
  high: "bg-accent",
};
const SOFT_TEXT: Record<AccuracyBand, string> = {
  unknown: "text-[#8A8578]",
  low: "text-[#C45C44]",
  weak: "text-[#B8864A]",
  building: "text-[#5A8A6E]",
  near: "text-[#5A8A6E]",
  high: "text-[#5A7D5E]",
};
const DEFAULT_TEXT: Record<AccuracyBand, string> = {
  unknown: "text-muted-foreground",
  low: "text-destructive",
  weak: "text-warning",
  building: "text-primary",
  near: "text-primary",
  high: "text-accent",
};

/** Readiness rings read `riskBand`, not the accuracy ladder — ruling 4. */
const SOFT_RING: Record<Band, string> = {
  unknown: "stroke-[#E0DDD4]",
  low: "stroke-[#E07A5F]",
  middle: "stroke-[#81B29A]",
  high: "stroke-[#7A9E7E]",
};
const DEFAULT_RING: Record<Band, string> = {
  unknown: "stroke-muted",
  low: "stroke-warning",
  middle: "stroke-primary",
  high: "stroke-accent",
};

/** Light Scandinavian variant for analytics studio. */
export function SoftReadinessRing({ score, size = 108, label }: { score: number; size?: number; label?: string }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, score)) / 100) * c;
  const tone = SOFT_RING[riskBand(score)];

  return (
    <div className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-[#E0DDD4]" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className={cn(tone, "transition-all duration-700 ease-out")}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-semibold tabular-nums leading-none text-[#2C3E2D]">{score}%</div>
        {label && <div className="text-[10px] uppercase tracking-wide text-[#8A8578] mt-1">{label}</div>}
      </div>
    </div>
  );
}

export function SoftWeekActivityBars({ days }: { days: WeeklyActivityPoint[] }) {
  const recent = days.slice(-7);
  const max = Math.max(1, ...recent.map((d) => d.total ?? 0));

  if (recent.length === 0) {
    return <p className="text-sm text-[#6B756C]">No activity this week yet.</p>;
  }

  return (
    <div className="flex items-end gap-2.5 h-32">
      {recent.map((d) => {
        const total = d.total ?? 0;
        const h = total > 0 ? Math.max((total / max) * 100, 10) : 4;
        const parsed = d.date.includes("T") ? new Date(d.date) : new Date(`${d.date}T12:00:00`);
        const dayLabel = Number.isNaN(parsed.getTime())
          ? String(d.date).slice(5)
          : parsed.toLocaleDateString("en-IN", { weekday: "short" });
        const test = d.test ?? 0;
        const battles = d.battles ?? 0;
        const practice = d.self_practice ?? 0;

        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-2 min-w-0">
            <div
              className="w-full flex flex-col justify-end rounded-xl overflow-hidden bg-[#F0EDE6]"
              style={{ height: "100%" }}
            >
              {total > 0 ? (
                <div
                  className="w-full flex flex-col-reverse rounded-t-xl overflow-hidden"
                  style={{ height: `${h}%` }}
                >
                  {test > 0 && <div className="w-full bg-[#7A9E7E]" style={{ flex: test }} title={`Test: ${test}`} />}
                  {battles > 0 && <div className="w-full bg-[#E07A5F]" style={{ flex: battles }} title={`Battles: ${battles}`} />}
                  {practice > 0 && (
                    <div className="w-full bg-[#81B29A]" style={{ flex: practice }} title={`Self-practice: ${practice}`} />
                  )}
                </div>
              ) : (
                <div className="w-full h-1.5 rounded-full bg-[#E0DDD4] mx-auto max-w-[50%] mt-auto mb-2" />
              )}
            </div>
            <div className="text-center w-full">
              <div className="text-[10px] font-medium text-[#8A8578] truncate">{dayLabel}</div>
              <div className="text-xs font-semibold tabular-nums text-[#2C3E2D]">{total || "—"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ReadinessRing({ score, size = 112, label }: { score: number; size?: number; label?: string }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, score)) / 100) * c;
  const tone = DEFAULT_RING[riskBand(score)];

  return (
    <div className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="stroke-white/20"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className={cn(tone, "transition-all duration-700 ease-out")}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-foreground">
        <div className="text-3xl font-bold tabular-nums leading-none">{score}%</div>
        {label && <div className="text-[10px] uppercase tracking-wider text-foreground/70 mt-1">{label}</div>}
      </div>
    </div>
  );
}

export function SubjectBar({
  name,
  accuracy,
  attempts,
  rank,
  variant = "default",
}: {
  name: string;
  accuracy: number;
  attempts: number;
  rank?: number;
  variant?: "default" | "soft";
}) {
  // The PALETTE stays local — it is this screen's design. The BOUNDARIES do
  // not: they come from `accuracyBand`, so this bar and the one on Analysis can
  // no longer disagree about where "weak" starts for the same subject.
  const band = accuracyBand(accuracy);
  const tone = (variant === "soft" ? SOFT_BAR : DEFAULT_BAR)[band];
  const textTone = (variant === "soft" ? SOFT_TEXT : DEFAULT_TEXT)[band];

  return (
    <div className="group">
      <div className="flex items-end justify-between gap-3 mb-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {rank != null && (
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wider w-4",
                  variant === "soft" ? "text-[#8A8578]" : "text-muted-foreground",
                )}
              >
                {rank}
              </span>
            )}
            <span className={cn("font-medium text-sm truncate", variant === "soft" && "text-[#2C3E2D]")}>{name}</span>
          </div>
          <div className={cn("text-[11px] mt-0.5", variant === "soft" ? "text-[#8A8578]" : "text-muted-foreground")}>
            {attempts} attempts
          </div>
        </div>
        <span className={cn("text-lg font-bold tabular-nums shrink-0", textTone)}>{accuracy}%</span>
      </div>
      <div className={cn("h-2.5 rounded-full overflow-hidden", variant === "soft" ? "bg-[#F0EDE6]" : "bg-muted")}>
        <div
          className={cn("h-full rounded-full transition-all duration-500", tone)}
          style={{ width: `${Math.max(accuracy, 4)}%` }}
        />
      </div>
    </div>
  );
}

export function WeekActivityBars({ days }: { days: WeeklyActivityPoint[] }) {
  const recent = days.slice(-7);
  const max = Math.max(1, ...recent.map((d) => d.total ?? 0));

  if (recent.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity this week yet.</p>;
  }

  return (
    <div className="flex items-end gap-2 h-36">
      {recent.map((d) => {
        const total = d.total ?? 0;
        const h = total > 0 ? Math.max((total / max) * 100, 8) : 4;
        const parsed = d.date.includes("T") ? new Date(d.date) : new Date(`${d.date}T12:00:00`);
        const dayLabel = Number.isNaN(parsed.getTime())
          ? String(d.date).slice(5)
          : parsed.toLocaleDateString("en-IN", { weekday: "short" });
        const test = d.test ?? 0;
        const battles = d.battles ?? 0;
        const practice = d.self_practice ?? 0;

        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-2 min-w-0">
            <div className="w-full flex flex-col justify-end rounded-lg overflow-hidden bg-muted/50" style={{ height: "100%" }}>
              {total > 0 ? (
                <div
                  className="w-full flex flex-col-reverse rounded-t-lg overflow-hidden"
                  style={{ height: `${h}%` }}
                >
                  {test > 0 && <div className="w-full bg-primary" style={{ flex: test }} title={`Test: ${test}`} />}
                  {battles > 0 && <div className="w-full bg-warning" style={{ flex: battles }} title={`Battles: ${battles}`} />}
                  {practice > 0 && (
                    <div className="w-full bg-accent" style={{ flex: practice }} title={`Self-practice: ${practice}`} />
                  )}
                </div>
              ) : (
                <div className="w-full h-1 rounded-full bg-border mx-auto max-w-[60%] mt-auto mb-2" />
              )}
            </div>
            <div className="text-center w-full">
              <div className="text-[10px] font-medium text-muted-foreground truncate">{dayLabel}</div>
              <div className="text-xs font-semibold tabular-nums">{total || "—"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TrendSparkline({ values, tone = "primary" }: { values: number[]; tone?: "primary" | "accent" | "warning" }) {
  const toneClass =
    tone === "accent" ? "bg-accent" : tone === "warning" ? "bg-warning" : "bg-primary";

  if (values.length < 2) {
    return <div className="text-sm text-muted-foreground">Not enough data yet</div>;
  }

  const max = Math.max(...values, 1);
  const latest = values[values.length - 1];
  const prev = values[values.length - 2];
  const delta = latest - prev;

  return (
    <div>
      <div className="flex items-end gap-1 h-16 mb-2">
        {values.map((v, i) => (
          <div
            key={i}
            className={cn("flex-1 rounded-t-sm opacity-90", toneClass, i === values.length - 1 && "ring-2 ring-offset-1 ring-primary/30")}
            style={{ height: `${Math.max((v / max) * 100, 6)}%` }}
            title={`${v}%`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold tabular-nums text-lg text-foreground">{latest}%</span>
        <span className={cn("font-medium", delta >= 0 ? "text-accent" : "text-destructive")}>
          {delta >= 0 ? "+" : ""}
          {delta}% vs prior
        </span>
      </div>
    </div>
  );
}

export function MetricTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "accent" | "warning" | "destructive" | "primary";
}) {
  const valueTone =
    accent === "accent"
      ? "text-accent"
      : accent === "warning"
        ? "text-warning"
        : accent === "destructive"
          ? "text-destructive"
          : accent === "primary"
            ? "text-primary"
            : "text-foreground";

  return (
    <div className="rounded-xl bg-white/10 border border-border px-4 py-3 backdrop-blur-sm">
      <div className="text-[10px] uppercase tracking-wider text-foreground/65">{label}</div>
      <div className={cn("text-2xl font-bold tabular-nums mt-1", valueTone)}>{value}</div>
      {sub && <div className="text-[11px] text-foreground/60 mt-0.5">{sub}</div>}
    </div>
  );
}

export function InsightHighlight({
  kind,
  title,
  subtitle,
  value,
}: {
  kind: "focus";
  title: string;
  subtitle: string;
  value: string;
}) {
  // §10.8: the "strength" branch is removed, not renamed — nothing ever passed
  // it, and a rendered "Top strength" card one prop away from existing is the
  // state the rule calls out.
  const border = "border-l-warning";
  const badge = "bg-warning/15 text-warning";

  return (
    <Card className={cn("p-4 shadow-card border-l-4", border)}>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        Needs focus
      </div>
      <div className="flex items-start justify-between gap-3 mt-2">
        <div className="min-w-0">
          <div className="text-lg font-bold truncate">{title}</div>
          <div className="text-sm text-muted-foreground mt-0.5">{subtitle}</div>
        </div>
        <span className={cn("text-sm font-bold px-2.5 py-1 rounded-lg shrink-0", badge)}>{value}</span>
      </div>
    </Card>
  );
}
