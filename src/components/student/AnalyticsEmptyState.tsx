import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, Calculator, Target, Sword } from "lucide-react";

export function AnalyticsEmptyState() {
  return (
    <Card className="p-10 sm:p-12 text-center shadow-card border-dashed border-border/80 bg-gradient-to-b from-muted/40 to-transparent">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <BarChart3 className="w-7 h-7 text-primary" />
      </div>
      <h3 className="text-lg font-semibold">Your analytics will appear here</h3>
      <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto leading-relaxed">
        Complete a DPP, battle, or Class 12 practice session to unlock readiness scores, subject breakdowns, weekly momentum, and a personalised action plan.
      </p>
      <div className="flex gap-2 justify-center mt-6 flex-wrap">
        <Button asChild>
          <Link to="/student/dpp"><Target className="w-4 h-4 mr-1" /> Start a DPP</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/student/battleground"><Sword className="w-4 h-4 mr-1" /> Battleground</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/student/practice/math12"><Calculator className="w-4 h-4 mr-1" /> Class 12 practice</Link>
        </Button>
      </div>
    </Card>
  );
}
