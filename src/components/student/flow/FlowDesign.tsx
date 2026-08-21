import { Children, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import "./student-panel-premium.css";

/** Shared student UX — premium card flow (Analysis page design language). */

export function FlowPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flow-page student-premium max-w-3xl mx-auto space-y-8 pb-6", className)}>{children}</div>
  );
}

export function FlowTopBar({
  backTo = "/student",
  backLabel = "Back",
  action,
}: {
  backTo?: string;
  backLabel?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-2 -mx-1">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground h-9">
        <Link to={backTo}>
          <ArrowLeft className="w-4 h-4 mr-1" /> {backLabel}
        </Link>
      </Button>
      {action}
    </div>
  );
}

export function FlowHero({
  eyebrow,
  title,
  metrics,
  footer,
}: {
  eyebrow: string;
  title: string;
  metrics: { label: string; value: string | number }[];
  footer?: ReactNode;
}) {
  return (
    <section className="sp-hero rounded-3xl overflow-hidden shadow-elevated bg-[#074b37] text-primary-foreground p-6 sm:p-8 relative">
      <div className="absolute top-0 right-0 w-48 h-48 bg-[#b2f0d4]/20 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
        {eyebrow}
      </p>
      <h1 className="font-['Sora'] text-2xl sm:text-3xl font-semibold mt-2 tracking-tight">{title}</h1>
      <div
        className={cn(
          "grid gap-3 mt-8",
          metrics.length <= 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-5",
        )}
      >
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-2xl bg-black/10 ring-1 ring-black/15 px-4 py-3 backdrop-blur-sm"
          >
            <p className="text-[10px] uppercase tracking-wider text-primary-foreground/65">{m.label}</p>
            <p className="text-xl sm:text-2xl font-semibold mt-1 tabular-nums">{m.value}</p>
          </div>
        ))}
      </div>
      {footer && <div className="mt-6 pt-6 border-t border-black/15">{footer}</div>}
      </div>
    </section>
  );
}

export function FlowSectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold text-foreground mb-3">{children}</h2>;
}

export function FlowStatGrid({
  items,
  columns = 4,
}: {
  items: { label: string; value: string | number; sub?: string }[];
  columns?: 2 | 3 | 4;
}) {
  const colClass =
    columns === 2 ? "grid-cols-2" : columns === 3 ? "grid-cols-3" : "grid-cols-2 lg:grid-cols-4";
  return (
    <div className={cn("grid gap-3", colClass)}>
      {items.map((item) => (
        <div
          key={item.label}
          className="sp-stat-card rounded-2xl border border-border/60 bg-card p-4 shadow-sm"
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {item.label}
          </p>
          <p className="text-2xl font-semibold text-foreground mt-1 tabular-nums">{item.value}</p>
          {item.sub && <p className="text-[11px] text-muted-foreground mt-0.5">{item.sub}</p>}
        </div>
      ))}
    </div>
  );
}

export function FlowConceptTag({
  label,
  meta,
  variant,
}: {
  label: string;
  meta?: string;
  variant: "strong" | "weak";
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-col gap-0.5 rounded-xl border px-3 py-2 text-left max-w-full",
        variant === "strong"
          ? "bg-emerald-50/80 border-emerald-200/80 text-emerald-900"
          : "bg-orange-50/80 border-orange-200/80 text-orange-950",
      )}
    >
      <span className="text-sm font-medium truncate">{label}</span>
      {meta && <span className="text-[10px] opacity-70 truncate">{meta}</span>}
    </span>
  );
}

export function FlowConceptPanel({
  title,
  icon,
  variant,
  children,
  empty,
}: {
  title: string;
  icon: ReactNode;
  variant: "strong" | "weak";
  children: ReactNode;
  empty?: string;
}) {
  const isStrong = variant === "strong";
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <p
        className={cn(
          "text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 mb-3",
          isStrong ? "text-emerald-700" : "text-orange-700",
        )}
      >
        {icon} {title}
      </p>
      <div className="flex flex-wrap gap-2">
        {Children.count(children) > 0 ? children : empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
      </div>
    </div>
  );
}

export function FlowCoachCard({
  title = "What should you do next?",
  loading,
  lines,
  empty,
}: {
  title?: string;
  loading?: boolean;
  lines: string[];
  empty?: string;
}) {
  return (
    <section className="rounded-2xl border border-border/60 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your coach</p>
      <h2 className="text-lg font-semibold text-foreground mt-0.5">{title}</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground mt-3">Personalising tips…</p>
      ) : lines.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {lines.map((line, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-foreground/90 leading-relaxed">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {line}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground mt-3">{empty}</p>
      )}
    </section>
  );
}

export function FlowRecoveryCard({
  count,
  weakConcepts,
  ctaTo = "/student/recovery",
  ctaLabel = "Fix my mistakes",
  subtitle = "Fix what you missed",
  onCtaClick,
  ctaDisabled,
}: {
  count: number;
  weakConcepts: string[];
  ctaTo?: string;
  ctaLabel?: string;
  subtitle?: string;
  onCtaClick?: () => void;
  ctaDisabled?: boolean;
}) {
  return (
    <section className="sp-recovery-card rounded-3xl border-2 border-[#97d3b8]/40 p-6 sm:p-8 shadow-elevated">
      <div className="flex flex-col sm:flex-row sm:items-center gap-6">
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Recovery zone</p>
          <h2 className="text-2xl sm:text-3xl font-semibold text-foreground mt-1 tracking-tight">
            {subtitle}
          </h2>
          <div className="flex flex-wrap gap-6 mt-5">
            <div>
              <p className="text-3xl font-bold text-foreground tabular-nums">{count}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Recovery questions available</p>
            </div>
            {weakConcepts.length > 0 && (
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Weak concepts
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {weakConcepts.map((c, i) => (
                    <span
                      key={i}
                      className="text-xs font-medium px-2.5 py-1 rounded-full bg-card border border-orange-200 text-orange-900"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        {onCtaClick ? (
          <Button
            size="lg"
            className="rounded-2xl h-14 px-8 text-base font-semibold shadow-lg shrink-0 w-full sm:w-auto"
            onClick={onCtaClick}
            disabled={ctaDisabled}
          >
            {ctaLabel} <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        ) : (
          <Button
            size="lg"
            className="rounded-2xl h-14 px-8 text-base font-semibold shadow-lg shrink-0 w-full sm:w-auto"
            asChild
          >
            <Link to={ctaTo}>
              {ctaLabel} <ArrowRight className="w-5 h-5 ml-2" />
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}

export function FlowTrendCard({
  previous,
  current,
  improvement,
}: {
  previous: number | null;
  current: number | null;
  improvement: number | null;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
      <FlowSectionTitle>Improvement trend</FlowSectionTitle>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Previous</p>
          <p className="text-2xl font-semibold mt-1 tabular-nums text-muted-foreground">
            {previous != null ? `${previous}%` : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">session accuracy</p>
        </div>
        <div className="flex flex-col items-center justify-center">
          {improvement != null ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-sm font-semibold px-3 py-1 rounded-full",
                improvement >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800",
              )}
            >
              <ArrowUpRight className="w-4 h-4" />
              {improvement > 0 ? "+" : ""}
              {improvement}%
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
          <p className="text-[10px] text-muted-foreground mt-2">change</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Current</p>
          <p className="text-2xl font-semibold mt-1 tabular-nums text-foreground">
            {current != null ? `${current}%` : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">session accuracy</p>
        </div>
      </div>
    </section>
  );
}

export function FlowActionCard({
  icon,
  title,
  description,
  to,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="sp-action-card block rounded-2xl border border-border/60 bg-card p-4 shadow-sm hover:shadow-elevated hover:border-[#97d3b8]/50 transition-all"
    >
      <div className="text-primary mb-2">{icon}</div>
      <div className="font-semibold text-foreground">{title}</div>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </Link>
  );
}