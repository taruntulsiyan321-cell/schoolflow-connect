import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { Users, Search, Send, Inbox, Check, X, Swords } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

/** Multi-select classmates and send invites for a battle the current user created. */
export function InviteFriends({ battleId, classId }: { battleId: string; classId: string }) {
  const { user } = useAuth();
  const [classmates, setClassmates] = useState<any[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!classId) return;
    supabase.rpc("rpc_classmates").then(({ data }) => {
      setClassmates((data ?? []).map((m: any) => ({
        id: m.student_id, full_name: m.full_name, user_id: m.user_id, roll_number: m.roll_number,
      })));
    });
  }, [classId, user]);

  const send = async () => {
    if (!user) return;
    const ids = Object.entries(picked).filter(([, v]) => v).map(([k]) => k);
    if (!ids.length) return toast({ title: "Pick at least one classmate" });
    setSending(true);
    const rows = ids.map(uid => ({ battle_id: battleId, invited_user_id: uid, inviter_user_id: user.id }));
    const { error } = await supabase.from("battle_invites").upsert(rows as any, { onConflict: "battle_id,invited_user_id" });
    setSending(false);
    if (error) return toast({ title: error.message, variant: "destructive" });
    toast({ title: `Sent ${ids.length} invite${ids.length === 1 ? "" : "s"}` });
    setPicked({});
  };

  const filtered = classmates.filter(c => c.full_name?.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-primary" />
        <div className="font-semibold text-sm">Invite classmates</div>
      </div>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search…" className="pl-9 h-9" />
      </div>
      <div className="max-h-56 overflow-y-auto space-y-1 -mx-1 px-1">
        {filtered.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No classmates with accounts yet.</p>}
        {filtered.map(c => (
          <label key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
            <Checkbox checked={!!picked[c.user_id]} onCheckedChange={(v) => setPicked(p => ({ ...p, [c.user_id]: !!v }))} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{c.full_name}</div>
              <div className="text-[10px] text-muted-foreground">Roll {c.roll_number || "-"}</div>
            </div>
          </label>
        ))}
      </div>
      <Button onClick={send} disabled={sending} className="w-full" size="sm"><Send className="w-3.5 h-3.5 mr-2" /> Send invites</Button>
    </Card>
  );
}

/** Pending battle invites with accept / decline animations. */
export function MyInvites() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [invites, setInvites] = useState<any[]>([]);
  const [accepting, setAccepting] = useState<string | null>(null);

  const refresh = async () => {
    if (!user) return;
    const { data } = await supabase.from("battle_invites")
      .select("id, status, battle_id, battles(id,title,subject,topic,chapter,question_count,per_question_sec,status,starts_at)")
      .eq("invited_user_id", user.id).eq("status", "pending").order("created_at", { ascending: false });
    setInvites(data ?? []);
  };
  useEffect(() => { refresh(); }, [user]);

  const accept = async (invite: any) => {
    setAccepting(invite.id);
    await supabase.from("battle_invites").update({ status: "accepted" }).eq("id", invite.id);
    toast({ title: "Challenge accepted!", description: "Entering the arena…" });
    setAccepting(null);
    nav(`/student/battleground/battle/${invite.battle_id}`);
  };

  const decline = async (id: string) => {
    await supabase.from("battle_invites").update({ status: "declined" }).eq("id", id);
    toast({ title: "Challenge declined" });
    refresh();
  };

  if (!invites.length) return null;
  return (
    <Card className="p-4 border-2 border-primary/15 animate-rise">
      <div className="flex items-center gap-2 mb-3">
        <Inbox className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Incoming challenges · {invites.length}</h3>
      </div>
      <div className="space-y-2">
        {invites.map((i: any) => (
          <div
            key={i.id}
            className={cn(
              "flex items-center gap-2 p-3 rounded-lg border bg-card transition-all",
              accepting === i.id && "animate-pop border-primary shadow-glow",
            )}
          >
            <div className="w-9 h-9 rounded-lg bg-gradient-battle text-white flex items-center justify-center shrink-0">
              <Swords className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{i.battles?.title}</div>
              <div className="text-[11px] text-muted-foreground">
                {i.battles?.subject}
                {i.battles?.chapter ? ` · ${i.battles.chapter}` : ""}
                {i.battles?.topic ? ` · ${i.battles.topic}` : ""}
                {" · "}{i.battles?.question_count}Q
              </div>
            </div>
            <Button size="sm" variant="outline" disabled={accepting !== null} onClick={() => decline(i.id)}>
              <X className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              className="bg-gradient-victory text-white shrink-0"
              disabled={accepting !== null}
              onClick={() => accept(i)}
            >
              {accepting === i.id ? "…" : <><Check className="w-3.5 h-3.5 mr-1" /> Accept</>}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
