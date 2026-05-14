import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, FileText, Timer } from "lucide-react";
import { Link } from "react-router-dom";

export type DppCardData = {
  id: string;
  title: string;
  subject: string;
  chapter?: string | null;
  difficulty: string;
  due_at?: string | null;
  duration_sec: number;
  question_count: number;
  total_marks: number;
};

export function DppCard({ dpp, to, status }: { dpp: DppCardData; to: string; status?: { label: string; tone: "default" | "success" | "warning" } }) {
  const due = dpp.due_at ? new Date(dpp.due_at) : null;
  const overdue = due && due.getTime() < Date.now();
  return (
    <Link to={to} className="block">
      <Card className="p-4 hover:shadow-elevated transition-all">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-[10px] uppercase">{dpp.subject}</Badge>
              {dpp.chapter && <span className="text-xs text-muted-foreground truncate">{dpp.chapter}</span>}
            </div>
            <h3 className="font-semibold leading-tight truncate">{dpp.title}</h3>
          </div>
          {status && (
            <Badge className={
              status.tone === "success" ? "bg-accent/15 text-accent border-accent/30"
              : status.tone === "warning" ? "bg-warning/15 text-warning border-warning/30"
              : "bg-primary/15 text-primary border-primary/30"
            } variant="outline">{status.label}</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {dpp.question_count} Qs</span>
          <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> {Math.round(dpp.duration_sec / 60)} min</span>
          <span>·</span>
          <span className="capitalize">{dpp.difficulty}</span>
          <span>·</span>
          <span>{dpp.total_marks} marks</span>
          {due && (
            <span className={`ml-auto flex items-center gap-1 ${overdue ? "text-destructive" : ""}`}>
              <Clock className="w-3 h-3" /> {due.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}
