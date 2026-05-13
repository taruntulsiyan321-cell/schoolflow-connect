import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { Users, Search, Send, Inbox, Check, X } from "lucide-react";
import { Link } from "react-router-dom";

/** Multi-select classmates and send invites for a battle the current user created. */
export function InviteFriends({ battleId, classId }: { battleId: string; classId: string }) {
  const { user } = useAuth();
  const [classmates, setClassmates] = useState<any[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!classId) return;
    supabase.from("students").select("id, full_name, user_id, roll_number").eq("class_id", classId)
      .then(({ data }) => setClassmates((data ?? []).filter((s: any) => s.user_id && s.user_id !== user?.id)));
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

/** Show pending battle invites for the current user. */
export function MyInvites() {
  const { user } = useAuth();
  const [invites, setInvites] = useState<any[]>([]);

  const refresh = async () => {
    if (!user) return;
    const { data } = await supabase.from("battle_invites")
      .select("id, status, battle_id, battles(id,title,subject,topic,question_count,per_question_sec,status,starts_at)")
      .eq("invited_user_id", user.id).eq("status", "pending").order("created_at", { ascending: false });
    setInvites(data ?? []);
  };
  useEffect(() => { refresh(); }, [user]);

  const respond = async (id: string, status: "accepted" | "declined") => {
    await supabase.from("battle_invites").update({ status }).eq("id", id);
    refresh();
  };

  if (!invites.length) return null;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Inbox className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Battle invites · {invites.length}</h3>
      </div>
      <div className="space-y-2">
        {invites.map((i: any) => (
          <div key={i.id} className="flex items-center gap-2 p-3 rounded-lg border bg-card">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{i.battles?.title}</div>
              <div className="text-[11px] text-muted-foreground">{i.battles?.subject}{i.battles?.topic ? ` · ${i.battles.topic}` : ""} · {i.battles?.question_count}Q</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => respond(i.id, "declined")}><X className="w-3.5 h-3.5" /></Button>
            <Link to={`/student/battleground/battle/${i.battle_id}`} onClick={() => respond(i.id, "accepted")}>
              <Button size="sm" className="bg-gradient-battle text-white"><Check className="w-3.5 h-3.5 mr-1" /> Join</Button>
            </Link>
          </div>
        ))}
      </div>
    </Card>
  );
}
