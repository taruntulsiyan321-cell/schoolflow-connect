import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

import { Card } from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";

import { PageHeader, StatCard } from "@/components/ui-bits";

import { Activity, ClipboardCheck, Target, TrendingUp, TrendingDown, Minus } from "lucide-react";



function ClassTrendBadge({ trend }: { trend?: string }) {

  if (trend === "up") {

    return (

      <Badge className="bg-accent/15 text-accent border-0 gap-1">

        <TrendingUp className="w-3 h-3" /> Improving

      </Badge>

    );

  }

  if (trend === "down") {

    return (

      <Badge className="bg-destructive/10 text-destructive border-0 gap-1">

        <TrendingDown className="w-3 h-3" /> Declining

      </Badge>

    );

  }

  return (

    <Badge variant="outline" className="gap-1">

      <Minus className="w-3 h-3" /> Stable

    </Badge>

  );

}



export default function SchoolEngagement() {

  const [data, setData] = useState<any>(null);



  useEffect(() => {

    (async () => {

      const { data: h } = await supabase.rpc("rpc_principal_school_health");

      setData(h);

    })();

  }, []);



  return (

    <>

      <PageHeader

        title="School academic health"

        subtitle="Engagement and participation — school-wide, not individual answers"

      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

        <StatCard icon={<Activity className="w-5 h-5" />} label="Engagement score" value={`${data?.engagement_score ?? 0}%`} tone="accent" />

        <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Attendance today" value={`${data?.attendance_today_pct ?? 0}%`} />

        <StatCard icon={<Target className="w-5 h-5" />} label="DPP completion" value={`${data?.dpp_completion_pct ?? 0}%`} />

        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Classes" value={(data?.classes ?? []).length} />

      </div>

      <h3 className="font-semibold mb-3">Class-wise overview (last 7 days vs prior week)</h3>

      <div className="grid sm:grid-cols-2 gap-3">

        {(data?.classes ?? []).map((c: any) => (

          <Card key={c.class_id} className="p-4 shadow-card">

            <div className="flex items-start justify-between gap-2">

              <div className="font-semibold">{c.name}</div>

              <ClassTrendBadge trend={c.trend} />

            </div>

            <div className="text-sm text-muted-foreground mt-1">{c.students} students · avg {c.avg_xp ?? 0} XP</div>

            <div className="grid grid-cols-3 gap-2 mt-3 text-xs">

              <div className="rounded-md bg-muted p-2">

                <div className="text-muted-foreground">Activity</div>

                <div className="font-semibold flex items-center gap-0.5">

                  {(c.engagement_delta ?? 0) > 0 ? <TrendingUp className="w-3 h-3 text-accent" /> : (c.engagement_delta ?? 0) < 0 ? <TrendingDown className="w-3 h-3 text-destructive" /> : <Minus className="w-3 h-3" />}

                  {c.engagement_delta > 0 ? "+" : ""}{c.engagement_delta ?? 0}

                </div>

              </div>

              <div className="rounded-md bg-muted p-2">

                <div className="text-muted-foreground">DPP</div>

                <div className="font-semibold flex items-center gap-0.5">

                  {(c.dpp_delta ?? 0) > 0 ? <TrendingUp className="w-3 h-3 text-accent" /> : (c.dpp_delta ?? 0) < 0 ? <TrendingDown className="w-3 h-3 text-destructive" /> : <Minus className="w-3 h-3" />}

                  {c.dpp_delta > 0 ? "+" : ""}{c.dpp_delta ?? 0}

                </div>

              </div>

              <div className="rounded-md bg-muted p-2">

                <div className="text-muted-foreground">Attendance</div>

                <div className="font-semibold flex items-center gap-0.5">

                  {(c.attendance_delta ?? 0) > 0 ? <TrendingUp className="w-3 h-3 text-accent" /> : (c.attendance_delta ?? 0) < 0 ? <TrendingDown className="w-3 h-3 text-destructive" /> : <Minus className="w-3 h-3" />}

                  {c.attendance_delta > 0 ? "+" : ""}{c.attendance_delta ?? 0}%

                </div>

              </div>

            </div>

          </Card>

        ))}

      </div>

    </>

  );

}

