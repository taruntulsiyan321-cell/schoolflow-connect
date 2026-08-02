import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { Users, Search, Send, Inbox, Check, X, Swords } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { acceptBattleInvite } from "@/gurukul/hooks/useBattlegroundData";
import { displayChapter, displayTopic, displaySubject } from "@/lib/academicDisplay";
import { BattleExperienceService, resolveStudentServiceContext } from "@/academic";

type InviteBattle = {
  id: string;
  title: string;
  subject: string;
  topic?: string | null;
  chapter?: string | null;
  question_count?: number;
  per_question_sec?: number;
  status?: string;
  starts_at?: string;
};

type InviteRow = {
  id: string;
  status: string;
  battle_id: string;
  battles: InviteBattle | null;
};

/** Multi-select classmates and send invites for a battle the current user created. */
export function InviteFriends({ battleId, classId }: { battleId: string; classId: string }) {
  const { user } = useAuth();
  const [classmates, setClassmates] = useState<
    { id: string; full_name: string; user_id: string; roll_number: string | null }[]
  >([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!classId) return;
    supabase.rpc("rpc_classmates").then(({ data, error }) => {
      if (error) {
        toast({ title: "Could not load classmates", description: error.message, variant: "destructive" });
        return;
      }
      setClassmates(
        (data ?? []).map((m) => ({
          id: m.student_id,
          full_name: m.full_name,
          user_id: m.user_id,
          roll_number: m.roll_number,
        })),
      );
    });
  }, [classId, user]);

  const send = async () => {
    if (!user) return;
    const ids = Object.entries(picked)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!ids.length) return toast({ title: "Pick at least one classmate" });
    setSending(true);
    try {
      const ctx = await resolveStudentServiceContext();
      await BattleExperienceService.sendInvites(ctx, battleId, ids);
      toast({ title: `Sent ${ids.length} invite${ids.length === 1 ? "" : "s"}` });
      setPicked({});
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : "Could not send invites",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const filtered = classmates.filter((c) =>
    c.full_name?.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-primary" />
        <div className="font-semibold text-sm">Invite classmates</div>
      </div>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search…"
          className="pl-9 h-9"
        />
      </div>
      <div className="max-h-56 overflow-y-auto space-y-1 -mx-1 px-1">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No classmates with accounts yet.
          </p>
        )}
        {filtered.map((c) => (
          <label
            key={c.id}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
          >
            <Checkbox
              checked={!!picked[c.user_id]}
              onCheckedChange={(v) => setPicked((p) => ({ ...p, [c.user_id]: !!v }))}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{c.full_name}</div>
              <div className="text-[10px] text-muted-foreground">Roll {c.roll_number || "-"}</div>
            </div>
          </label>
        ))}
      </div>
      <Button onClick={send} disabled={sending} className="w-full" size="sm">
        <Send className="w-3.5 h-3.5 mr-2" /> Send invites
      </Button>
    </Card>
  );
}

/** Pending battle invites with accept / decline — two-query load (no embed). */
export function MyInvites() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [accepting, setAccepting] = useState<string | null>(null);

  const refresh = async () => {
    if (!user) return;
    const { data: rows, error } = await supabase
      .from("battle_invites")
      .select("id, status, battle_id")
      .eq("invited_user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Could not load invites", description: error.message, variant: "destructive" });
      setInvites([]);
      return;
    }

    const list = rows ?? [];
    if (!list.length) {
      setInvites([]);
      return;
    }

    const ids = [...new Set(list.map((r) => r.battle_id).filter(Boolean))];
    const { data: battles, error: battleErr } = await supabase
      .from("battles")
      .select(
        "id,title,subject,topic,chapter,question_count,per_question_sec,status,starts_at",
      )
      .in("id", ids);

    if (battleErr) {
      toast({
        title: "Could not load invite battles",
        description: battleErr.message,
        variant: "destructive",
      });
    }

    const byId: Record<string, InviteBattle> = {};
    for (const b of battles || []) byId[b.id] = b as InviteBattle;

    setInvites(
      list.map((r) => ({
        id: r.id,
        status: r.status,
        battle_id: r.battle_id,
        battles: byId[r.battle_id] ?? null,
      })),
    );
  };

  useEffect(() => {
    void refresh();
  }, [user]);

  const accept = async (invite: InviteRow) => {
    setAccepting(invite.id);
    try {
      const battleId = await acceptBattleInvite(invite.id, invite.battle_id);
      toast({ title: "Challenge accepted!", description: "Entering the arena…" });
      nav(`/student/battleground/battle/${battleId}`);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: string }).message)
          : "Could not accept challenge";
      toast({ title: "Could not accept challenge", description: msg, variant: "destructive" });
    } finally {
      setAccepting(null);
    }
  };

  const decline = async (id: string) => {
    try {
      const ctx = await resolveStudentServiceContext();
      await BattleExperienceService.declineInvite(ctx, id);
      toast({ title: "Challenge declined" });
      void refresh();
    } catch (e) {
      toast({
        title: "Could not decline challenge",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      });
    }
  };

  if (!invites.length) return null;
  return (
    <Card className="p-4 surface-card animate-rise">
      <div className="flex items-center gap-2 mb-3">
        <Inbox className="w-4 h-4 text-primary" />
        <h3 className="font-medium text-sm">Incoming challenges · {invites.length}</h3>
      </div>
      <div className="space-y-2">
        {invites.map((i) => (
          <div
            key={i.id}
            className={cn(
              "flex items-center gap-2 p-3 rounded-lg border bg-card transition-all",
              accepting === i.id && "border-primary bg-primary/5",
            )}
          >
            <div className="icon-tile shrink-0">
              <Swords className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {i.battles?.title || "Battle challenge"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {[
                  displaySubject(i.battles?.subject),
                  i.battles?.chapter ? displayChapter(i.battles.chapter) : "",
                  i.battles?.topic ? displayTopic(i.battles.topic) : "",
                  i.battles?.question_count != null ? `${i.battles.question_count}Q` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <Button size="sm" variant="outline" disabled={accepting !== null} onClick={() => decline(i.id)}>
              <X className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              className="btn-cta shrink-0"
              disabled={accepting !== null}
              onClick={() => void accept(i)}
            >
              {accepting === i.id ? (
                "…"
              ) : (
                <>
                  <Check className="w-3.5 h-3.5 mr-1" /> Accept
                </>
              )}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
