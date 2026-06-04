import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { BattleReportView } from "@/components/battleground/BattleReportView";

export default function BattleTeacherReport() {
  const { participantId, battleId } = useParams<{ participantId: string; battleId: string }>();

  if (!participantId) {
    return <p className="text-muted-foreground text-center py-8">Invalid report link.</p>;
  }

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to={battleId ? `/teacher/battleground/monitor/${battleId}` : "/teacher/battleground"}>
          <ArrowLeft className="w-4 h-4" /> Back to monitor
        </Link>
      </Button>
      <BattleReportView participantId={participantId} forTeacher />
    </div>
  );
}
