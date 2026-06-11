import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, Calculator, Target } from "lucide-react";

export function AnalyticsEmptyState() {
  return (
    <Card className="p-8 text-center shadow-card">
      <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
      <h3 className="font-semibold">No performance data yet</h3>
      <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
        Complete a DPP, battle, or Class 12 self-practice session to unlock readiness scores, weekly summaries, and topic insights.
      </p>
      <div className="flex gap-2 justify-center mt-4 flex-wrap">
        <Button asChild><Link to="/student/dpp"><Target className="w-4 h-4 mr-1" /> Start a DPP</Link></Button>
        <Button asChild variant="outline"><Link to="/student/battleground">Battleground</Link></Button>
        <Button asChild variant="outline"><Link to="/student/practice/math12"><Calculator className="w-4 h-4 mr-1" /> Class 12 Math</Link></Button>
      </div>
    </Card>
  );
}
