import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Sword, Swords, Trophy, Target, Flame, Award, Activity, Radio } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

type FeedEvent = {
  id: string;
  kind: string;
  actor_name: string;
  detail: string;
  subject: string | null;
  icon: string | null;
  created_at: string;
};

const ICONS: Record<string, { Icon: any; ring: string }> = {
  sword: { Icon: Sword, ring: "bg-gradient-battle" },
  swords: { Icon: Swords, ring: "bg-gradient-hero" },
  trophy: { Icon: Trophy, ring: "bg-gradient-victory" },
  target: { Icon: Target, ring: "bg-accent" },
  flame: { Icon: Flame, ring: "bg-warning" },
  badge: { Icon: Award, ring: "bg-gradient-primary" },
};

function pick(ev: FeedEvent) {
  return ICONS[ev.icon ?? ""] ?? ICONS[ev.kind] ?? { Icon: Activity, ring: "bg-primary" };
}

export function BattleFeed({ limit = 25, className }: { limit?: number; className?: string }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const flashRef = useRef<Set<string>>(new Set());

  const load = async () => {
    const { data } = await (supabase as any).rpc("rpc_battle_feed", { _limit: limit });
    setEvents((data ?? []) as FeedEvent[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("battle-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "battle_events" },
        (payload: any) => {
          const ev = payload.new as FeedEvent;
          flashRef.current.add(ev.id);
          setEvents((prev) => {
            if (prev.some((p) => p.id === ev.id)) return prev;
            return [ev, ...prev].slice(0, limit);
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
        </span>
        <h2 className="font-bold text-sm flex items-center gap-1.5">
          <Radio className="w-4 h-4 text-primary" /> Activity Feed
        </h2>
        <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Live</span>
      </div>

      <div className="max-h-[360px] overflow-y-auto divide-y divide-border/60">
        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading the arena…</div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center">
            <Activity className="w-9 h-9 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground mt-2">No battles yet. Be the first to make the feed move.</p>
          </div>
        ) : (
          events.map((ev) => {
            const { Icon, ring } = pick(ev);
            const isNew = flashRef.current.has(ev.id);
            return (
              <div
                key={ev.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 transition-colors",
                  isNew && "animate-rise bg-primary/[0.04]",
                )}
              >
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0", ring)}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">
                    <span className="font-semibold">{ev.actor_name}</span>{" "}
                    <span className="text-muted-foreground">{ev.detail}</span>
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                  {timeAgo(ev.created_at)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: false })
      .replace(" seconds", "s").replace(" second", "s")
      .replace(" minutes", "m").replace(" minute", "m")
      .replace(" hours", "h").replace(" hour", "h")
      .replace(" days", "d").replace(" day", "d");
  } catch {
    return "";
  }
}
