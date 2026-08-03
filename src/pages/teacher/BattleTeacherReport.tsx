import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { BattleReportView } from "@/components/battleground/BattleReportView";

export default function BattleTeacherReport() {
  const { participantId, id: battleId } = useParams<{ participantId: string; id: string }>();

  if (!participantId) {
    return <p className="text-muted-foreground text-center py-8">Invalid report link.</p>;
  }

  const backTo = battleId
    ? `/teacher/battleground/monitor/${battleId}`
    : "/teacher/battleground";

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to={backTo}>
          <ArrowLeft className="w-4 h-4" /> Back to monitor
        </Link>
      </Button>
      <BattleReportView participantId={participantId} forTeacher />
    </div>
  );
}
