import { useEffect, useState } from "react";

import { Link } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";

import { Card } from "@/components/ui/card";

import { Button } from "@/components/ui/button";

import { Badge } from "@/components/ui/badge";

import { PageHeader } from "@/components/ui-bits";

import { ListChecks, Check, Info } from "lucide-react";

import { toast } from "sonner";



type RevisionItem = {

  id: string;

  subject: string;

  chapter?: string;

  topic?: string;

  reason?: string;

  priority: number;

  due_date: string;

  priority_label?: string;

  sort_factors?: string[];

};



export default function RevisionQueue() {

  const [rows, setRows] = useState<RevisionItem[]>([]);
  const [sortNote, setSortNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.rpc("rpc_student_revision_queue");

    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }

    const payload = data as { items?: RevisionItem[]; sort_note?: string };
    setRows(payload?.items ?? []);
    setSortNote(payload?.sort_note ?? "");
    setLoading(false);
  };



  useEffect(() => { load(); }, []);



  const complete = async (id: string) => {

    const { error } = await supabase.rpc("rpc_complete_revision", { _id: id });

    if (error) return toast.error(error.message);

    toast.success("Revision done!");

    load();

  };



  const priorityTone = (label?: string) => {

    if (label === "High") return "destructive";

    if (label === "Medium") return "default";

    return "secondary";

  };



  return (

    <>

      <PageHeader

        title="Revision Queue"

        subtitle="Personalized priority — weak accuracy, mistakes, overdue items, and recent errors"

      />

      {sortNote && (

        <p className="text-xs text-muted-foreground flex items-start gap-1.5 mb-4">

          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />

          {sortNote}

        </p>

      )}

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading revision queue…</p>
      ) : loadError ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground mb-2">Could not load revision queue.</p>
          <p className="text-xs text-destructive mb-4">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => load()}>Try again</Button>
        </Card>
      ) : rows.length === 0 ? (

        <Card className="p-8 text-center">

          <ListChecks className="w-10 h-10 mx-auto text-muted-foreground mb-2" />

          <p className="text-muted-foreground">Nothing queued yet. Complete DPPs or check your dashboard after practice.</p>

          <div className="flex gap-2 justify-center mt-4">
            <Button asChild><Link to="/student/dpp">Start a DPP</Link></Button>
            <Button asChild variant="outline"><Link to="/student/recovery">Recovery zone</Link></Button>
          </div>

        </Card>

      ) : (

        <div className="space-y-2">

          {rows.map((r) => (

            <Card key={r.id} className="p-4 flex items-center justify-between gap-3 shadow-card">

              <div className="min-w-0 flex-1">

                <div className="font-semibold">{r.subject}</div>

                <div className="text-sm text-muted-foreground">{[r.chapter, r.topic].filter(Boolean).join(" · ")}</div>

                <div className="flex flex-wrap items-center gap-2 mt-2">

                  <Badge variant={priorityTone(r.priority_label) as "default" | "destructive" | "secondary"}>

                    {r.priority_label ?? "Medium"} · {r.priority}

                  </Badge>

                  <span className="text-xs text-muted-foreground">Due {r.due_date}</span>

                </div>

                {(r.sort_factors ?? []).length > 0 && (

                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">

                    {r.sort_factors!.join(" · ")}

                  </p>

                )}

              </div>

              <Button size="sm" className="shrink-0" onClick={() => complete(r.id)}>

                <Check className="w-4 h-4 mr-1" /> Done

              </Button>

            </Card>

          ))}

        </div>

      )}

    </>

  );

}

