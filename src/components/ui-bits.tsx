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
  icon, label, value, tone = "primary", hint, trend, featured,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone?: Tone;
  hint?: string;
  trend?: { value: string; up?: boolean };
  featured?: boolean;
}) => {
  const isFeatured = !!featured;
  return (
    <Card
      className={`p-5 sm:p-6 rounded-xl shadow-card transition-shadow duration-200 animate-rise group ${
        isFeatured
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card border-border/70 hover:shadow-elevated"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`text-sm font-medium ${isFeatured ? "text-primary-foreground/90" : "text-muted-foreground"}`}>
          {label}
        </div>
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
            isFeatured
              ? "bg-primary-foreground/15 text-primary-foreground ring-1 ring-primary-foreground/25"
              : toneMap[tone]
          }`}
        >
          <span className="[&_svg]:w-[18px] [&_svg]:h-[18px]">{icon}</span>
        </div>
      </div>
      <div className="mt-8">
        <div className={`text-3xl sm:text-4xl font-semibold leading-none tracking-tight font-mono tabular-nums ${isFeatured ? "text-primary-foreground" : "text-foreground"}`}>
          {value}
        </div>
      </div>
      <div className={`mt-6 flex items-center gap-1.5 text-xs ${isFeatured ? "text-primary-foreground/85" : "text-muted-foreground"}`}>
        {trend ? (
          <>
            {trend.up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            <span className="font-medium">{trend.value}</span>
            {hint && <span className="opacity-80">· {hint}</span>}
          </>
        ) : (
          <>
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>{hint ?? "Updated recently"}</span>
          </>
        )}
        <span className="sr-only">{icon}</span>
      </div>
    </Card>
  );
};


export const PageHeader = ({
  title, subtitle, action, eyebrow,
}: { title: string; subtitle?: string; action?: ReactNode; eyebrow?: string }) => (
  <div className="flex items-start justify-between gap-4 mb-5 sm:mb-6 pb-4 border-b border-border/60 animate-fade-in">
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
