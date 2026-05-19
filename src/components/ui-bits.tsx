import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, Inbox } from "lucide-react";

type Tone = "primary" | "accent" | "warning" | "secondary" | "destructive";

const toneMap: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary ring-1 ring-primary/15",
  accent: "bg-accent/10 text-accent ring-1 ring-accent/20",
  warning: "bg-warning/10 text-warning ring-1 ring-warning/20",
  secondary: "bg-secondary text-secondary-foreground ring-1 ring-border",
  destructive: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
};

export const StatCard = ({
  icon, label, value, tone = "primary", hint, trend,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone?: Tone;
  hint?: string;
  trend?: { value: string; up?: boolean };
}) => {
  return (
    <Card className="p-4 sm:p-5 shadow-card hover:shadow-elevated transition-all duration-300 hover:-translate-y-0.5 border-border/70 animate-rise group">
      <div className="flex items-start justify-between gap-3">
        <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center transition-transform duration-300 group-hover:scale-110 ${toneMap[tone]}`}>
          {icon}
        </div>
        {trend && (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${trend.up ? "bg-accent/10 text-accent" : "bg-destructive/10 text-destructive"}`}>
            {trend.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {trend.value}
          </span>
        )}
      </div>
      <div className="mt-3">
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
        <div className="text-2xl sm:text-[28px] font-bold leading-tight tracking-tight mt-1 font-mono tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </div>
    </Card>
  );
};

export const PageHeader = ({
  title, subtitle, action, eyebrow,
}: { title: string; subtitle?: string; action?: ReactNode; eyebrow?: string }) => (
  <div className="flex items-start justify-between gap-4 mb-5 sm:mb-6 pb-4 border-b border-border/60">
    <div className="min-w-0">
      {eyebrow && (
        <div className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-1.5">{eyebrow}</div>
      )}
      <h1 className="text-xl sm:text-2xl md:text-[28px] font-bold tracking-tight text-balance">{title}</h1>
      {subtitle && <p className="text-muted-foreground text-sm mt-1 text-pretty">{subtitle}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

export const SectionTitle = ({ title, count, action }: { title: string; count?: number; action?: ReactNode }) => (
  <div className="flex items-center justify-between mb-3">
    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
      {title}{typeof count === "number" && <span className="ml-2 text-foreground/70 font-mono">{count}</span>}
    </h2>
    {action}
  </div>
);

export const EmptyState = ({
  icon, title, description, action,
}: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) => (
  <Card className="p-8 sm:p-10 text-center border-dashed border-border/80 bg-muted/30 shadow-none">
    <div className="mx-auto w-12 h-12 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground mb-3">
      {icon ?? <Inbox className="w-5 h-5" />}
    </div>
    <div className="font-semibold text-foreground">{title}</div>
    {description && <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto text-pretty">{description}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </Card>
);
