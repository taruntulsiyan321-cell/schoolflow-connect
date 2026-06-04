import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { BattleReportView } from "@/components/battleground/BattleReportView";

export default function BattleReportPage() {
  const { participantId } = useParams<{ participantId: string }>();
  const nav = useNavigate();

  if (!participantId) {
    return <p className="text-muted-foreground text-center py-8">Invalid report link.</p>;
  }

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to="/student/battleground"><ArrowLeft className="w-4 h-4" /> Arena</Link>
      </Button>
      <BattleReportView
        participantId={participantId}
        onBack={() => nav("/student/battleground")}
      />
    </div>
  );
}
