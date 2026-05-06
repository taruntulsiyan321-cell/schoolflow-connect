import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui-bits";
import { Sparkles } from "lucide-react";

export default function PlaceholderPage({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle ?? "This module is part of the planned feature set"} />
      <Card className="p-10 text-center bg-gradient-soft border-dashed">
        <div className="w-14 h-14 rounded-2xl bg-gradient-primary text-primary-foreground flex items-center justify-center mx-auto mb-4 shadow-elevated">
          <Sparkles className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-semibold mb-1">Coming soon</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          The <span className="font-medium text-foreground">{title}</span> module is scaffolded and visible in navigation.
          Functionality will be wired up in an upcoming iteration.
        </p>
      </Card>
    </>
  );
}
