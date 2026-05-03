import { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export const StatCard = ({ icon, label, value, tone = "primary" }: {
  icon: ReactNode; label: string; value: string | number; tone?: "primary" | "accent" | "warning" | "secondary";
}) => {
  const toneMap = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/10 text-accent",
    warning: "bg-warning/10 text-warning",
    secondary: "bg-secondary/10 text-secondary",
  };
  return (
    <Card className="p-5 shadow-card hover:shadow-elevated transition-shadow">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${toneMap[tone]}`}>{icon}</div>
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        </div>
      </div>
    </Card>
  );
};

export const PageHeader = ({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) => (
  <div className="flex items-start justify-between gap-4 mb-6">
    <div>
      <h1 className="text-2xl md:text-3xl font-bold">{title}</h1>
      {subtitle && <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>}
    </div>
    {action}
  </div>
);
