/**
 * Live data for the Gurukul Battleground design page.
 * Maps Supabase rows → the design's BattleCard / history shapes.
 * Does not change any UI — consumers keep existing JSX.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { useAcademicLive } from "@/academic";
import {
  accuracyFromXp,
  battleRatingFromXp,
  formatBattleStatus,
  motivationCard,
} from "@/lib/battlegroundHelpers";

export type DesignBattleType = "1v1" | "team" | "class";

export type DesignBattleCard = {
  id: string;
  type: DesignBattleType;
  title: string;
  subject: string;
  status: "live" | "upcoming" | "completed" | "pending";
  players: number;
  maxPlayers: number;
  opponent?: string;
  opponentAvatar?: string;
  opponentColor?: string;
  myScore?: number;
  theirScore?: number;
  result?: "won" | "lost" | "draw";
  timeLeft?: string;
  startsIn?: string;
  date?: string;
  /** Finished battle score points (not Progression XP). 0 when not finished. */
  xpReward: number;
  featured?: boolean;
  hot?: boolean;
  participantId?: string;
  battleCode?: string | null;
  /** DB battles.source — e.g. featured_daily (preserved after question gen). */
  source?: string | null;
  chapter?: string | null;
  difficulty?: string | null;
  /** Pending battle_invites.id — Accept Challenge updates this row. */
  inviteId?: string;
};

export type DesignHistoryEntry = {
  id: string;
  participantId: string;
  type: DesignBattleType;
  subject: string;
  opponent: string;
  result: "won" | "lost" | "draw" | "finished";
  myScore: number;
  theirScore: number;
  xp: number;
  coins: number;
  date: string;
  duration: string;
  accuracy: number;
  rank: number;
};

export type DesignLbEntry = {
  rank: number;
  name: string;
  avatar: string;
  color: string;
  xp: number;
  streak: number;
  accuracy: number;
  you?: boolean;
};

export type ClassmateOption = {
  user_id: string;
  full_name: string;
  avatar: string;
  color: string;
};

const AVATAR_COLORS = ["#c08a3a", "#4b9fd4", "#4aa87a", "#6882e8", "#cc5069", "#3b5bdb"];

function initials(name: string): string {
  const parts = (name || "S").trim().split(/\s+/);
  return ((parts[0]?.[0] || "S") + (parts[1]?.[0] || parts[0]?.[1] || "")).toUpperCase();
}

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function modeToType(mode: string): DesignBattleType {
  if (mode === "duel" || mode === "solo") return "1v1";
  if (mode === "lobby" || mode === "open") return "class";
  if (mode === "team") return "team";
  return "class";
}

function formatRelativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday.getTime() - startThat.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function startsInLabel(startsAt: string): string | undefined {
  const ms = new Date(startsAt).getTime() - Date.now();
  if (ms <= 0) return undefined;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `Starts in ${mins}m`;
  const hrs = Math.round(mins / 60);
  return `Starts in ${hrs}h`;
}

function timeLeftLabel(startsAt: string, durationSec: number): string | undefined {
  const end = new Date(startsAt).getTime() + durationSec * 1000;
  const left = end - Date.now();
  if (left <= 0) return undefined;
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

type BattleRow = {
  id: string;
  title: string;
  subject: string;
  chapter?: string | null;
  difficulty?: string | null;
  status: string;
  mode: string;
  starts_at: string;
  duration_sec: number;
  question_count: number;
  source?: string;
  battle_code?: string | null;
  creator_user_id?: string;
};

type PartRow = {
  id: string;
  battle_id: string;
  user_id: string;
  display_name: string | null;
  score: number | null;
  rank: number | null;
  finished_at: string | null;
  correct_count: number | null;
  answered_count: number | null;
  total_time_ms: number | null;
  battles?: BattleRow | BattleRow[] | null;
};

function unwrapBattle(b: PartRow["battles"]): BattleRow | null {
  if (!b) return null;
  return Array.isArray(b) ? b[0] ?? null : b;
}

export function useBattlegroundData() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [xp, setXp] = useState<{
    xp: number;
    level: number;
    wins: number;
    total_battles: number;
    study_streak: number;
    win_streak: number;
    best_win_streak: number;
    total_correct: number;
    total_answered: number;
    league_code: string | null;
    next_league_min_xp: number | null;
    next_league_remaining: number | null;
    next_league_label: string | null;
  } | null>(null);
  const [classRank, setClassRank] = useState<number | null>(null);
  const [schoolRank, setSchoolRank] = useState<number | null>(null);
  const [battles, setBattles] = useState<DesignBattleCard[]>([]);
  const [history, setHistory] = useState<DesignHistoryEntry[]>([]);
  const [classmates, setClassmates] = useState<ClassmateOption[]>([]);
  const [classId, setClassId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [stuRes, matesRes] = await Promise.all([
        supabase.from("students").select("id, class_id, full_name").eq("user_id", user.id).maybeSingle(),
        supabase.rpc("rpc_classmates"),
      ]);

      let xpData: {
        xp: number;
        level: number;
        wins: number;
        total_battles: number;
        study_streak: number;
        win_streak: number;
        best_win_streak: number;
        total_correct: number;
        total_answered: number;
        league_code: string | null;
        next_league_min_xp: number | null;
        next_league_remaining: number | null;
        next_league_label: string | null;
      } | null = null;
      let classRankFromProg: number | null = null;
      let schoolRankFromProg: number | null = null;
      try {
        const { ProgressionService, resolveStudentServiceContext } = await import("@/academic");
        const ctx = await resolveStudentServiceContext();
        const snap = await ProgressionService.getSnapshot(ctx, user.id);
        xpData = {
          xp: snap.xp,
          level: snap.level,
          wins: snap.battleground.wins,
          total_battles: snap.battleground.total_battles,
          study_streak: snap.study_streak,
          win_streak: snap.battleground.win_streak,
          best_win_streak: snap.battleground.best_win_streak,
          total_correct: snap.battleground.total_correct,
          total_answered: snap.battleground.total_answered,
          league_code: snap.league?.code ?? null,
          next_league_min_xp: snap.next_league?.min_xp ?? null,
          next_league_remaining: snap.next_league?.remaining ?? null,
          next_league_label: snap.next_league?.label ?? null,
        };
        try {
          const [classLb, schoolLb] = await Promise.all([
            ProgressionService.leaderboard(ctx, {
              scope: "class",
              period: "lifetime",
              metric: "xp",
              limit: 200,
            }),
            ProgressionService.leaderboard(ctx, {
              scope: "school",
              period: "lifetime",
              metric: "xp",
              limit: 500,
            }),
          ]);
          const ci = classLb.rows.findIndex((r) => r.user_id === user.id);
          classRankFromProg = ci >= 0 ? ci + 1 : null;
          const si = schoolLb.rows.findIndex((r) => r.user_id === user.id);
          schoolRankFromProg = si >= 0 ? si + 1 : null;
        } catch {
          /* ranks stay null */
        }
      } catch {
        // Honest zeros — do not invent progress from a raw dual-formula fallback.
        xpData = {
          xp: 0,
          level: 1,
          wins: 0,
          total_battles: 0,
          study_streak: 0,
          win_streak: 0,
          best_win_streak: 0,
          total_correct: 0,
          total_answered: 0,
          league_code: null,
          next_league_min_xp: null,
          next_league_remaining: null,
          next_league_label: null,
        };
      }

      if (stuRes.error) throw stuRes.error;
      // Soft-fail classmates — don't blank the arena; never invent ranks
      if (matesRes.error) {
        toast({ title: "Could not load classmates", description: matesRes.error.message, variant: "destructive" });
        setClassmates([]);
      }

      const s = stuRes.data;
      const x = xpData;
      const mates = matesRes.data;

      setClassId(s?.class_id ?? null);
      // Always zeros when no row — never leave prior session demo values
      setXp({
        xp: x?.xp ?? 0,
        level: x?.level ?? 1,
        wins: x?.wins ?? 0,
        total_battles: x?.total_battles ?? 0,
        study_streak: x?.study_streak ?? 0,
        win_streak: x?.win_streak ?? 0,
        best_win_streak: x?.best_win_streak ?? 0,
        total_correct: x?.total_correct ?? 0,
        total_answered: x?.total_answered ?? 0,
        league_code: x?.league_code ?? null,
        next_league_min_xp: x?.next_league_min_xp ?? null,
        next_league_remaining: x?.next_league_remaining ?? null,
        next_league_label: x?.next_league_label ?? null,
      });

      setClassRank(classRankFromProg);
      setSchoolRank(schoolRankFromProg);

      if (!matesRes.error) {
        setClassmates(
          (Array.isArray(mates) ? mates : [])
            .filter((m: { user_id?: string }) => m.user_id && m.user_id !== user.id)
            .map((m: { user_id: string; full_name?: string }) => ({
              user_id: m.user_id,
              full_name: m.full_name || "Classmate",
              avatar: initials(m.full_name || "C"),
              color: colorFor(m.user_id),
            })),
        );
      }

      // My participations (open + finished) for My Battles / History / pending
      // Invites: two-query (no embed) — battle_invites historically lacked an FK, so
      // PostgREST schema cache rejects `battles(...)` embeds until migration is applied.
      const [partsRes, invitesRes] = await Promise.all([
        supabase
          .from("battle_participants")
          .select("*, battles(*)")
          .eq("user_id", user.id)
          .order("joined_at", { ascending: false })
          .limit(40),
        supabase
          .from("battle_invites")
          .select("id, status, battle_id, inviter_user_id, created_at")
          .eq("invited_user_id", user.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      let myParts: PartRow[] | null = (partsRes.data as PartRow[] | null) ?? null;
      if (partsRes.error) {
        // Embed may fail on stale schema cache — fall back to two queries
        const msg = partsRes.error.message || "";
        if (msg.toLowerCase().includes("relationship") || msg.toLowerCase().includes("schema cache")) {
          const { data: flatParts, error: flatErr } = await supabase
            .from("battle_participants")
            .select("*")
            .eq("user_id", user.id)
            .order("joined_at", { ascending: false })
            .limit(40);
          if (flatErr) {
            setError(flatErr.message);
            toast({ title: "Battleground load failed", description: flatErr.message, variant: "destructive" });
            return;
          }
          const ids = [...new Set((flatParts || []).map((p) => p.battle_id))];
          const battleMap: Record<string, BattleRow> = {};
          if (ids.length) {
            const { data: bRows, error: bErr } = await supabase.from("battles").select("*").in("id", ids);
            if (bErr) {
              toast({ title: "Could not load battles", description: bErr.message, variant: "destructive" });
            }
            for (const b of (bRows || []) as BattleRow[]) battleMap[b.id] = b;
          }
          myParts = (flatParts || []).map((p) => ({
            ...p,
            battles: battleMap[p.battle_id] ?? null,
          })) as PartRow[];
        } else {
          setError(msg || "Could not load your battles");
          toast({ title: "Battleground load failed", description: msg, variant: "destructive" });
          return;
        }
      }
      if (invitesRes.error) {
        toast({ title: "Could not load invites", description: invitesRes.error.message, variant: "destructive" });
      }

      type InviteFlat = {
        id: string;
        battle_id: string;
        inviter_user_id: string;
        status?: string;
        battles?: BattleRow | BattleRow[] | null;
      };
      let pendingInvites: InviteFlat[] = invitesRes.error ? [] : ((invitesRes.data || []) as InviteFlat[]);

      // Attach battles via separate query (avoids schema-cache / missing-FK embed failures)
      if (pendingInvites.length) {
        const battleIds = [...new Set(pendingInvites.map((i) => i.battle_id).filter(Boolean))];
        if (battleIds.length) {
          const { data: inviteBattles, error: invBattleErr } = await supabase
            .from("battles")
            .select(
              "id,title,subject,chapter,difficulty,status,mode,starts_at,duration_sec,question_count,source,battle_code,creator_user_id",
            )
            .in("id", battleIds);
          if (invBattleErr) {
            toast({
              title: "Could not load invite battles",
              description: invBattleErr.message,
              variant: "destructive",
            });
          } else {
            const byId: Record<string, BattleRow> = {};
            for (const b of (inviteBattles || []) as BattleRow[]) byId[b.id] = b;
            pendingInvites = pendingInvites.map((inv) => ({
              ...inv,
              battles: byId[inv.battle_id] ?? null,
            }));
          }
        }
      }

      const parts = (myParts || []) as PartRow[];
      const myBattleIds = new Set(parts.map((p) => p.battle_id));

      // Participant counts per battle (for win/loss/draw)
      const partCountIds = [...myBattleIds];
      const partCountMap: Record<string, number> = {};
      if (partCountIds.length) {
        const { data: allParts, error: countErr } = await supabase
          .from("battle_participants")
          .select("battle_id")
          .in("battle_id", partCountIds);
        if (countErr) {
          toast({ title: "Could not load participant counts", description: countErr.message, variant: "destructive" });
        }
        for (const row of allParts || []) {
          partCountMap[row.battle_id] = (partCountMap[row.battle_id] || 0) + 1;
        }
      }

      // Open class/school battles I may not have joined yet
      // Avoid stacking .in(mode) with .or(mode…) — PostgREST ANDs them and can drop rows.
      let openQ = supabase
        .from("battles")
        .select("*")
        .in("status", ["live", "scheduled"])
        .order("starts_at", { ascending: false })
        .limit(20);
      if (s?.class_id) {
        openQ = openQ.or(`mode.eq.open,and(mode.eq.lobby,class_id.eq.${s.class_id})`);
      } else {
        openQ = openQ.eq("mode", "open");
      }
      const { data: openBattles, error: openErr } = await openQ;
      if (openErr) {
        toast({ title: "Could not load open battles", description: openErr.message, variant: "destructive" });
      }

      // Featured sources
      const { data: featuredRows, error: featuredErr } = await supabase
        .from("battles")
        .select("*")
        .like("source", "featured_%")
        .in("status", ["live", "scheduled"])
        .order("starts_at", { ascending: false })
        .limit(10);
      if (featuredErr) {
        toast({ title: "Could not load featured battles", description: featuredErr.message, variant: "destructive" });
      }

      const cards: DesignBattleCard[] = [];
      const hist: DesignHistoryEntry[] = [];
      const seen = new Set<string>();

      const pushCard = (c: DesignBattleCard) => {
        if (seen.has(c.id)) return;
        seen.add(c.id);
        cards.push(c);
      };

      // Cards from my participations
      for (const p of parts) {
        const b = unwrapBattle(p.battles);
        if (!b) continue;

        const totalParticipants = partCountMap[b.id] || 1;
        // Placeholder status; refined after co-participant scores load
        const statusInfo = formatBattleStatus({
          battleStatus: b.status,
          startsAt: b.starts_at,
          finishedAt: p.finished_at,
          rank: p.rank,
          totalParticipants,
          myScore: p.score,
        });

        let status: DesignBattleCard["status"] = "live";
        if (statusInfo.kind === "waiting") status = "upcoming";
        else if (statusInfo.kind === "active") status = "live";
        else if (
          statusInfo.kind === "won" ||
          statusInfo.kind === "lost" ||
          statusInfo.kind === "draw" ||
          statusInfo.kind === "completed"
        ) {
          status = "completed";
        } else if (b.status === "scheduled") status = "upcoming";

        const type = modeToType(b.mode);
        const isFeatured = (b.source || "").startsWith("featured_");
        const isFinishedForXp = !!(p.finished_at || b.status === "finished");
        // Battle score points once finished — not Progression XP (labeled "pts" in UI).
        const xpReward = isFinishedForXp && typeof p.score === "number" ? Math.max(0, p.score) : 0;

        let result: DesignBattleCard["result"];
        if (status === "completed") {
          if (statusInfo.kind === "won") result = "won";
          else if (statusInfo.kind === "lost") result = "lost";
          else if (statusInfo.kind === "draw") result = "draw";
          // solo / unknown → leave undefined (UI shows Finished, not Draw)
        }

        pushCard({
          id: b.id,
          type,
          title: b.title || (b.subject ? `${b.subject} Battle` : "Battle"),
          subject: b.subject || "",
          status,
          players: totalParticipants,
          maxPlayers: b.mode === "duel" ? 2 : b.mode === "lobby" ? 40 : 20,
          opponent: type === "1v1" ? "Waiting for challenger" : undefined,
          myScore: p.score ?? undefined,
          theirScore: undefined,
          result,
          timeLeft: status === "live" ? timeLeftLabel(b.starts_at, b.duration_sec) : undefined,
          startsIn: status === "upcoming" ? startsInLabel(b.starts_at) : undefined,
          date: status === "completed" ? formatRelativeDate(p.finished_at || b.starts_at) : undefined,
          xpReward,
          featured: isFeatured,
          hot: status === "live",
          participantId: p.id,
          battleCode: b.battle_code ?? null,
          source: b.source ?? null,
          chapter: b.chapter ?? null,
          difficulty: b.difficulty ?? null,
        });

        if (isFinishedForXp) {
          const answered = p.answered_count ?? 0;
          const correct = p.correct_count ?? 0;
          const acc = answered > 0 ? Math.round((correct / answered) * 100) : 0;
          const mins = p.total_time_ms ? Math.round(p.total_time_ms / 60000) : Math.round((b.duration_sec || 0) / 60);
          const secs = p.total_time_ms ? Math.round((p.total_time_ms % 60000) / 1000) : 0;
          hist.push({
            id: p.id,
            participantId: p.id,
            type,
            subject: b.subject || "",
            opponent: type === "class" ? "Class Battle" : "—",
            result: result === "won" ? "won" : result === "lost" ? "lost" : result === "draw" ? "draw" : "finished",
            myScore: p.score ?? 0,
            theirScore: 0,
            // Battle score points (UI shows as pts); Progression XP is separate on student_xp.
            xp: xpReward,
            coins: 0,
            date: formatRelativeDate(p.finished_at || b.starts_at),
            duration: `${mins}m ${secs.toString().padStart(2, "0")}s`,
            accuracy: acc,
            rank: p.rank ?? 0,
          });
        }
      }

      // Incoming challenges (pending invites) — must stay "pending", not overwritten to live
      const inviterIds = pendingInvites.map((inv) => inv.inviter_user_id).filter(Boolean);
      const inviterNames: Record<string, string> = {};
      if (inviterIds.length) {
        const { data: inviters } = await supabase
          .from("students")
          .select("user_id, full_name")
          .in("user_id", inviterIds);
        for (const row of inviters || []) {
          inviterNames[row.user_id] = row.full_name || "Challenger";
        }
      }
      for (const inv of pendingInvites) {
        const b = unwrapBattle(inv.battles);
        if (!b) continue;
        if (seen.has(b.id)) {
          // Upgrade to pending only when not already a live/playing participant
          const existing = cards.find((c) => c.id === b.id);
          if (existing && existing.status !== "completed" && !existing.participantId) {
            existing.status = "pending";
            existing.inviteId = inv.id;
          } else if (existing && existing.participantId && !existing.inviteId) {
            // Already joined — attach invite id but keep live/upcoming status
            existing.inviteId = inv.id;
          }
          continue;
        }
        const oppName = inviterNames[inv.inviter_user_id] || "Challenger";
        pushCard({
          id: b.id,
          type: modeToType(b.mode),
          title: b.title || (b.subject ? `${b.subject} Challenge` : "Challenge"),
          subject: b.subject || "",
          status: "pending",
          players: 1,
          maxPlayers: b.mode === "duel" ? 2 : 20,
          opponent: oppName,
          opponentAvatar: initials(oppName),
          opponentColor: colorFor(inv.inviter_user_id),
          xpReward: 0, // not played yet — no real XP earned
          featured: (b.source || "").startsWith("featured_"),
          battleCode: b.battle_code ?? null,
          source: b.source ?? null,
          chapter: b.chapter ?? null,
          difficulty: b.difficulty ?? null,
          inviteId: inv.id,
        });
      }

      // Enrich opponent names for duel cards + fix draw mapping with real scores
      const duelIds = cards.filter((c) => c.type === "1v1").map((c) => c.id);
      if (duelIds.length) {
        const { data: coParts } = await supabase
          .from("battle_participants")
          .select("battle_id, user_id, display_name, score, finished_at, rank")
          .in("battle_id", duelIds);
        const byBattle: Record<string, { display_name: string; user_id: string; score: number; finished_at: string | null; rank: number | null }[]> = {};
        for (const cp of coParts || []) {
          (byBattle[cp.battle_id] ||= []).push({
            display_name: cp.display_name || "Challenger",
            user_id: cp.user_id,
            score: cp.score ?? 0,
            finished_at: cp.finished_at,
            rank: cp.rank,
          });
        }
        for (const c of cards) {
          if (c.type !== "1v1") continue;
          const all = byBattle[c.id] || [];
          const others = all.filter((x) => x.user_id !== user.id);
          const opp = others[0];
          if (opp) {
            c.opponent = opp.display_name;
            c.opponentAvatar = initials(opp.display_name);
            c.opponentColor = colorFor(opp.user_id);
            c.theirScore = opp.score;
          }
          c.players = all.length || c.players;

          // Recompute win/loss/draw with real participant count + scores
          if (c.status === "completed") {
            const me = all.find((x) => x.user_id === user.id);
            const statusInfo = formatBattleStatus({
              battleStatus: "finished",
              startsAt: new Date().toISOString(),
              finishedAt: me?.finished_at || new Date().toISOString(),
              rank: me?.rank ?? (c.result === "won" ? 1 : 2),
              totalParticipants: all.length,
              myScore: me?.score ?? c.myScore,
              opponentScore: opp?.score ?? c.theirScore,
            });
            if (statusInfo.kind === "won") c.result = "won";
            else if (statusInfo.kind === "lost") c.result = "lost";
            else if (statusInfo.kind === "draw") c.result = "draw";
          }
        }

        // History opponent names + draw results
        for (const h of hist) {
          const card = cards.find((c) => c.participantId === h.participantId);
          if (card?.opponent) h.opponent = card.opponent;
          if (card?.theirScore != null) h.theirScore = card.theirScore;
          if (card?.result) h.result = card.result;
        }
      }

      // Open / featured battles not yet joined
      for (const b of [...(featuredRows || []), ...(openBattles || [])] as BattleRow[]) {
        if (myBattleIds.has(b.id) && seen.has(b.id)) {
          const existing = cards.find((c) => c.id === b.id);
          if (existing && (b.source || "").startsWith("featured_")) existing.featured = true;
          continue;
        }
        const isFeatured = (b.source || "").startsWith("featured_");
        const status: DesignBattleCard["status"] =
          b.status === "scheduled" && new Date(b.starts_at).getTime() > Date.now() ? "upcoming" : "live";
        pushCard({
          id: b.id,
          type: modeToType(b.mode),
          title: b.title || (b.subject ? `${b.subject} Battle` : "Battle"),
          subject: b.subject || "",
          status,
          players: 0,
          maxPlayers: b.mode === "lobby" ? 40 : 20,
          startsIn: status === "upcoming" ? startsInLabel(b.starts_at) : undefined,
          timeLeft: status === "live" ? timeLeftLabel(b.starts_at, b.duration_sec) : undefined,
          xpReward: 0, // not played yet — no real XP earned
          featured: isFeatured,
          hot: status === "live" && isFeatured,
          battleCode: b.battle_code ?? null,
          source: b.source ?? null,
          chapter: b.chapter ?? null,
          difficulty: b.difficulty ?? null,
        });
      }

      // Player counts for open cards
      const needCounts = cards.filter((c) => c.players === 0).map((c) => c.id);
      if (needCounts.length) {
        const { data: counts } = await supabase
          .from("battle_participants")
          .select("battle_id")
          .in("battle_id", needCounts);
        const tally: Record<string, number> = {};
        for (const row of counts || []) tally[row.battle_id] = (tally[row.battle_id] || 0) + 1;
        for (const c of cards) {
          if (tally[c.id] != null) c.players = tally[c.id];
        }
      }

      setBattles(cards);
      setHistory(hist);
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "Failed to load battleground";
      setError(msg);
      toast({ title: "Battleground load failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Reload after any battle/xp write — covers BattleExperienceService writes (bus + realtime)
  // and the raw-RPC last-resort finish path (student-xp-updated + battle_participants realtime).
  const liveVersion = useAcademicLive(["battle", "xp"]);
  useEffect(() => {
    if (liveVersion > 0) void reload();
  }, [liveVersion, reload]);

  useEffect(() => {
    const handler = () => void reload();
    window.addEventListener("student-xp-updated", handler);
    return () => window.removeEventListener("student-xp-updated", handler);
  }, [reload]);

  const heroStats = useMemo(() => {
    const wins = xp?.wins ?? 0;
    const total = xp?.total_battles ?? 0;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
    return [
      { label: "Battles Won", value: String(wins), color: "#4aa87a" },
      { label: "Win Rate", value: `${winRate}%`, color: "#3b5bdb" },
      { label: "Class Rank", value: classRank ? `#${classRank}` : "—", color: "#c08a3a" },
      { label: "XP", value: (xp?.xp ?? 0).toLocaleString(), color: "#6882e8" },
    ];
  }, [xp, classRank]);

  const motivation = useMemo(
    () =>
      motivationCard({
        xp: xp?.xp ?? 0,
        level: xp?.level ?? 1,
        streak: xp?.win_streak ?? 0,
        wins: xp?.wins ?? 0,
        classRank,
        schoolRank,
      }),
    [xp, classRank, schoolRank],
  );

  const accuracy = useMemo(() => accuracyFromXp(xp || {}), [xp]);

  /** Wins from student_xp lifetime; losses = non-wins (SSOT). Draws remain history-window only. */
  const record = useMemo(() => {
    const wins = xp?.wins ?? 0;
    const totalBattles = xp?.total_battles ?? 0;
    const finished = history.filter((h) => h.result === "won" || h.result === "lost" || h.result === "draw");
    const draws = finished.filter((h) => h.result === "draw").length;
    const losses = Math.max(0, totalBattles - wins);
    return {
      totalBattles,
      wins,
      losses,
      draws,
      accuracy,
      rating: battleRatingFromXp(xp?.xp ?? 0, wins, totalBattles),
      xp: xp?.xp ?? 0,
      level: xp?.level ?? 1,
      streak: xp?.win_streak ?? 0,
      bestStreak: xp?.best_win_streak ?? 0,
      classRank,
      schoolRank,
      leagueCode: xp?.league_code ?? null,
      nextLeagueMinXp: xp?.next_league_min_xp ?? null,
      nextLeagueRemaining: xp?.next_league_remaining ?? null,
      nextLeagueLabel: xp?.next_league_label ?? null,
    };
  }, [xp, history, accuracy, classRank, schoolRank]);

  return {
    loading,
    error,
    xp,
    classRank,
    schoolRank,
    classId,
    battles,
    history,
    classmates,
    heroStats,
    motivation,
    accuracy,
    /** Flat stats for hero / statistics panels */
    stats: record,
    totalBattles: record.totalBattles,
    wins: record.wins,
    losses: record.losses,
    draws: record.draws,
    rating: record.rating,
    streak: record.streak,
    reload,
  };
}

/** Create a battle from design wizard config; returns id + real DB battle_code. */
export async function createBattleFromDesign(opts: {
  type: DesignBattleType;
  subject: string;
  chapter?: string;
  difficulty: string;
  questions: number;
  timeLimitMin: number;
  opponentUserId?: string;
  classId?: string | null;
  /** When false, mark battle private after create (code-gated). */
  isPublic?: boolean;
}): Promise<{ id: string; battleCode: string | null }> {
  const { BattleExperienceService, resolveStudentServiceContext } = await import("@/academic");
  const ctx = await resolveStudentServiceContext();
  const result = await BattleExperienceService.createFromDesign(ctx, opts);
  if (!result.battleCode) {
    toast({
      title: "Battle code missing",
      description: "Ask your admin to apply the battle_code migration, or share the battle link instead.",
      variant: "destructive",
    });
  }
  return result;
}

export async function joinBattleByCode(code: string): Promise<string> {
  const { BattleExperienceService, resolveStudentServiceContext } = await import("@/academic");
  const ctx = await resolveStudentServiceContext();
  return BattleExperienceService.joinByCode(ctx, code);
}

/** Join a known battle id (featured card / open lobby) without going through code. */
export async function joinBattleById(battleId: string): Promise<string> {
  const { BattleExperienceService, resolveStudentServiceContext } = await import("@/academic");
  const ctx = await resolveStudentServiceContext();
  return BattleExperienceService.joinById(ctx, battleId);
}

export async function acceptBattleInvite(inviteId: string, battleId: string): Promise<string> {
  const { BattleExperienceService, resolveStudentServiceContext } = await import("@/academic");
  const ctx = await resolveStudentServiceContext();
  return BattleExperienceService.acceptInvite(ctx, inviteId, battleId);
}

export async function ensureFeatured(kind: "daily" | "weekly" | "ncert" | "beat_topper" | "teacher"): Promise<string> {
  const { BattleExperienceService, resolveStudentServiceContext } = await import("@/academic");
  const ctx = await resolveStudentServiceContext();
  return BattleExperienceService.ensureFeatured(ctx, kind);
}

export async function loadLeaderboardEntries(
  scope: "class" | "section" | "school" | "subject",
  subject: string | undefined,
  myUserId: string | undefined,
  period: "daily" | "weekly" | "monthly" | "overall" = "overall",
): Promise<DesignLbEntry[]> {
  // rpc_leaderboard categories: xp | wins | streak | weekly | monthly | subject
  // No true "daily" — map daily → weekly battle score (closest supported period).
  const rpcScope = scope === "subject" ? "school" : scope === "section" ? "class" : scope;
  let category = "xp";
  if (scope === "subject") category = "subject";
  else if (period === "weekly" || period === "daily") category = "weekly";
  else if (period === "monthly") category = "monthly";
  else category = "xp";

  const { data, error } = await supabase.rpc("rpc_leaderboard", {
    _scope: rpcScope,
    _category: category,
    _subject: scope === "subject" ? subject : undefined,
    _limit: 50,
  });
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const uids = rows.map((r: { user_id?: string }) => r.user_id).filter(Boolean) as string[];
  const accMap: Record<string, number> = {};
  if (uids.length) {
    const { data: xpRows } = await supabase
      .from("student_xp")
      .select("user_id, total_correct, total_answered")
      .in("user_id", uids);
    for (const x of xpRows || []) {
      accMap[x.user_id] = accuracyFromXp(x);
    }
  }

  return rows.map((r: {
    user_id?: string;
    full_name?: string;
    score?: number;
    detail?: string;
    equipped_badge?: string;
  }, i: number) => {
    const name = r.full_name || "Student";
    const uid = r.user_id || String(i);
    const streakMatch = typeof r.detail === "string" ? r.detail.match(/(\d+)\s*-?\s*day/i) || r.detail.match(/(\d+)/) : null;
    const accFromDetail =
      typeof r.detail === "string" ? r.detail.match(/(\d+)\s*%?\s*acc/i) : null;
    return {
      rank: i + 1,
      name,
      avatar: initials(name),
      color: colorFor(uid),
      xp: r.score ?? 0,
      streak: streakMatch ? Number(streakMatch[1]) : 0,
      accuracy: accFromDetail ? Number(accFromDetail[1]) : (accMap[uid] ?? 0),
      you: !!myUserId && r.user_id === myUserId,
    };
  });
}
