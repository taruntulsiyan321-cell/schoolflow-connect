/**
 * Live data for the Gurukul Battleground design page.
 * Maps Supabase rows → the design's BattleCard / history shapes.
 * Does not change any UI — consumers keep existing JSX.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { accuracyFromXp, formatBattleStatus, motivationCard } from "@/lib/battlegroundHelpers";

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
  xpReward: number;
  featured?: boolean;
  hot?: boolean;
  participantId?: string;
  battleCode?: string | null;
};

export type DesignHistoryEntry = {
  id: string;
  participantId: string;
  type: DesignBattleType;
  subject: string;
  opponent: string;
  result: "won" | "lost" | "draw";
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
  if (mode === "lobby") return "class";
  return "team";
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
    current_streak: number;
    win_streak: number;
    best_win_streak: number;
    total_correct: number;
    total_answered: number;
  } | null>(null);
  const [classRank, setClassRank] = useState<number | null>(null);
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
      const [{ data: s }, { data: x }, { data: mates }, { data: lb }] = await Promise.all([
        supabase.from("students").select("id, class_id, full_name").eq("user_id", user.id).maybeSingle(),
        supabase.from("student_xp").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.rpc("rpc_classmates"),
        supabase.rpc("rpc_leaderboard", { _scope: "class", _category: "xp", _subject: undefined, _limit: 200 }),
      ]);

      setClassId(s?.class_id ?? null);
      if (x) {
        setXp({
          xp: x.xp ?? 0,
          level: x.level ?? 1,
          wins: x.wins ?? 0,
          total_battles: x.total_battles ?? 0,
          current_streak: x.current_streak ?? 0,
          win_streak: x.win_streak ?? 0,
          best_win_streak: x.best_win_streak ?? 0,
          total_correct: x.total_correct ?? 0,
          total_answered: x.total_answered ?? 0,
        });
      } else {
        setXp({
          xp: 0, level: 1, wins: 0, total_battles: 0,
          current_streak: 0, win_streak: 0, best_win_streak: 0,
          total_correct: 0, total_answered: 0,
        });
      }

      if (Array.isArray(lb)) {
        const i = lb.findIndex((r: { user_id?: string }) => r.user_id === user.id);
        setClassRank(i >= 0 ? i + 1 : null);
      }

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

      // My participations (open + finished) for My Battles / History / pending
      const { data: myParts } = await supabase
        .from("battle_participants")
        .select("*, battles(*)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: false })
        .limit(40);

      const parts = (myParts || []) as PartRow[];
      const myBattleIds = new Set(parts.map((p) => p.battle_id));

      // Open class/school battles I may not have joined yet
      let openQ = supabase
        .from("battles")
        .select("*")
        .in("status", ["live", "scheduled"])
        .in("mode", ["open", "lobby"])
        .order("starts_at", { ascending: false })
        .limit(20);
      if (s?.class_id) {
        openQ = openQ.or(`mode.eq.open,and(mode.eq.lobby,class_id.eq.${s.class_id})`);
      } else {
        openQ = openQ.eq("mode", "open");
      }
      const { data: openBattles } = await openQ;

      // Featured sources
      const { data: featuredRows } = await supabase
        .from("battles")
        .select("*")
        .like("source", "featured_%")
        .in("status", ["live", "scheduled"])
        .order("starts_at", { ascending: false })
        .limit(10);

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

        const statusInfo = formatBattleStatus({
          battleStatus: b.status,
          startsAt: b.starts_at,
          finishedAt: p.finished_at,
          rank: p.rank,
          totalParticipants: 2,
        });

        let status: DesignBattleCard["status"] = "live";
        if (statusInfo.kind === "waiting") status = "upcoming";
        else if (statusInfo.kind === "active") status = "live";
        else if (statusInfo.kind === "won" || statusInfo.kind === "lost" || statusInfo.kind === "completed") {
          status = "completed";
        } else if (b.status === "scheduled") status = "upcoming";
        else if (b.mode === "duel" && !p.finished_at && b.status !== "finished") {
          // Invited duel waiting for me / opponent
          status = b.creator_user_id === user.id ? "pending" : "pending";
        }

        // Opponent from co-participants (lazy: show "Opponent" if unknown)
        const type = modeToType(b.mode);
        const isFeatured = (b.source || "").startsWith("featured_");
        const xpReward = Math.max(50, (b.question_count || 10) * 10);

        let result: DesignBattleCard["result"];
        if (status === "completed") {
          if (statusInfo.kind === "won") result = "won";
          else if (statusInfo.kind === "lost") result = "lost";
          else result = "draw";
        }

        pushCard({
          id: b.id,
          type,
          title: b.title || `${b.subject} Battle`,
          subject: b.subject || "Mathematics",
          status,
          players: 1,
          maxPlayers: b.mode === "duel" ? 2 : b.mode === "lobby" ? 40 : 20,
          opponent: type === "1v1" ? "Opponent" : undefined,
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
        });

        if (p.finished_at || b.status === "finished") {
          const answered = p.answered_count ?? 0;
          const correct = p.correct_count ?? 0;
          const acc = answered > 0 ? Math.round((correct / answered) * 100) : 0;
          const mins = p.total_time_ms ? Math.round(p.total_time_ms / 60000) : Math.round((b.duration_sec || 0) / 60);
          const secs = p.total_time_ms ? Math.round((p.total_time_ms % 60000) / 1000) : 0;
          hist.push({
            id: p.id,
            participantId: p.id,
            type,
            subject: b.subject || "Mathematics",
            opponent: type === "class" ? "Class Battle" : "Opponent",
            result: result === "won" ? "won" : result === "lost" ? "lost" : "draw",
            myScore: p.score ?? 0,
            theirScore: 0,
            xp: xpReward,
            coins: Math.round(xpReward / 5),
            date: formatRelativeDate(p.finished_at || b.starts_at),
            duration: `${mins}m ${secs.toString().padStart(2, "0")}s`,
            accuracy: acc,
            rank: p.rank ?? 0,
          });
        }
      }

      // Enrich opponent names for duel cards
      const duelIds = cards.filter((c) => c.type === "1v1").map((c) => c.id);
      if (duelIds.length) {
        const { data: coParts } = await supabase
          .from("battle_participants")
          .select("battle_id, user_id, display_name, score")
          .in("battle_id", duelIds);
        const byBattle: Record<string, { display_name: string; user_id: string; score: number }[]> = {};
        for (const cp of coParts || []) {
          (byBattle[cp.battle_id] ||= []).push({
            display_name: cp.display_name || "Challenger",
            user_id: cp.user_id,
            score: cp.score ?? 0,
          });
        }
        for (const c of cards) {
          if (c.type !== "1v1") continue;
          const others = (byBattle[c.id] || []).filter((x) => x.user_id !== user.id);
          const opp = others[0];
          if (opp) {
            c.opponent = opp.display_name;
            c.opponentAvatar = initials(opp.display_name);
            c.opponentColor = colorFor(opp.user_id);
            c.theirScore = opp.score;
            c.players = (byBattle[c.id] || []).length;
          }
          // Pending invite: duel I'm in, not finished, only 1 participant or I'm not creator waiting
          const all = byBattle[c.id] || [];
          const me = all.find((x) => x.user_id === user.id);
          if (c.status !== "completed" && all.length < 2 && me) {
            // keep pending/live as mapped
          }
        }

        // History opponent names
        for (const h of hist) {
          const card = cards.find((c) => c.participantId === h.participantId);
          if (card?.opponent) h.opponent = card.opponent;
          if (card?.theirScore != null) h.theirScore = card.theirScore;
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
          title: b.title || `${b.subject} Battle`,
          subject: b.subject || "Mathematics",
          status,
          players: 0,
          maxPlayers: b.mode === "lobby" ? 40 : 20,
          startsIn: status === "upcoming" ? startsInLabel(b.starts_at) : undefined,
          timeLeft: status === "live" ? timeLeftLabel(b.starts_at, b.duration_sec) : undefined,
          xpReward: Math.max(50, (b.question_count || 10) * 10),
          featured: isFeatured,
          hot: status === "live" && isFeatured,
          battleCode: b.battle_code ?? null,
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
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const heroStats = useMemo(() => {
    const wins = xp?.wins ?? 0;
    const total = xp?.total_battles ?? 0;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
    return [
      { label: "Battles Won", value: String(wins), color: "#4aa87a" },
      { label: "Win Rate", value: `${winRate}%`, color: "#3b5bdb" },
      { label: "Class Rank", value: classRank ? `#${classRank}` : "—", color: "#c08a3a" },
      { label: "Battle XP", value: (xp?.xp ?? 0).toLocaleString(), color: "#6882e8" },
    ];
  }, [xp, classRank]);

  const motivation = useMemo(
    () =>
      motivationCard({
        xp: xp?.xp ?? 0,
        level: xp?.level ?? 1,
        streak: xp?.current_streak ?? 0,
        wins: xp?.wins ?? 0,
        classRank,
      }),
    [xp, classRank],
  );

  return {
    loading,
    error,
    xp,
    classRank,
    classId,
    battles,
    history,
    classmates,
    heroStats,
    motivation,
    accuracy: accuracyFromXp(xp || {}),
    reload,
  };
}

/** Create a battle from design wizard config; returns battle id. */
export async function createBattleFromDesign(opts: {
  type: DesignBattleType;
  subject: string;
  chapter?: string;
  difficulty: string;
  questions: number;
  timeLimitMin: number;
  opponentUserId?: string;
  classId?: string | null;
}): Promise<string> {
  const perQ = Math.max(10, Math.floor((opts.timeLimitMin * 60) / Math.max(1, opts.questions)));
  const chap = opts.chapter && opts.chapter !== "All" ? opts.chapter : undefined;
  const base = {
    _subject: opts.subject,
    _difficulty: opts.difficulty === "mixed" ? "medium" : opts.difficulty,
    _count: opts.questions,
    _per_q: perQ,
    _chapter: chap,
    _class_id: opts.classId ?? undefined,
  };

  if (opts.type === "1v1" && opts.opponentUserId) {
    const res = await supabase.rpc("rpc_challenge_student", {
      _opponent_user_id: opts.opponentUserId,
      _subject: base._subject,
      _difficulty: base._difficulty,
      _count: base._count,
      _per_q: base._per_q,
      _chapter: chap,
    });
    if (res.error) throw res.error;
    if (!res.data) throw new Error("Challenge could not be created");
    return res.data as string;
  }

  if (opts.type === "class") {
    const res = await supabase.rpc("rpc_create_class_battle" as never, base as never);
    if (res.error) throw (res as { error: Error }).error;
    if (!res.data) throw new Error("Class battle could not be created");
    return res.data as string;
  }

  // team / open / 1v1 without opponent → open battle with join code
  const res = await supabase.rpc("rpc_create_open_battle" as never, base as never);
  if (res.error) throw (res as { error: Error }).error;
  if (!res.data) throw new Error("Battle could not be created");
  return res.data as string;
}

export async function joinBattleByCode(code: string): Promise<string> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) throw new Error("Enter a battle code to join.");

  const res = await supabase.rpc("rpc_join_battle_by_code" as never, { _code: trimmed } as never);
  if (res.error) {
    const msg = res.error.message || "";
    // Migration not applied yet — try legacy lookup if column missing
    if (msg.includes("rpc_join_battle_by_code") || msg.includes("schema cache") || msg.includes("battle_code")) {
      throw new Error("Battle codes need a database update. Ask your admin to apply the battle_code migration.");
    }
    throw res.error;
  }
  if (!res.data) throw new Error("Could not join battle");
  return res.data as string;
}

export async function ensureFeatured(kind: "daily" | "weekly" | "ncert" | "beat_topper" | "teacher"): Promise<string> {
  const res = await supabase.rpc("rpc_ensure_featured_battle" as never, { _kind: kind } as never);
  if (res.error) throw res.error;
  if (!res.data) throw new Error("Featured battle unavailable");
  return res.data as string;
}

export async function loadLeaderboardEntries(
  scope: "class" | "section" | "school" | "subject",
  subject: string | undefined,
  myUserId: string | undefined,
): Promise<DesignLbEntry[]> {
  const rpcScope = scope === "subject" ? "school" : scope === "section" ? "class" : scope;
  const { data, error } = await supabase.rpc("rpc_leaderboard", {
    _scope: rpcScope,
    _category: "xp",
    _subject: scope === "subject" ? subject : undefined,
    _limit: 50,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((r: {
    user_id?: string;
    full_name?: string;
    score?: number;
    detail?: string;
    equipped_badge?: string;
  }, i: number) => {
    const name = r.full_name || "Student";
    const uid = r.user_id || String(i);
    // detail often holds streak / accuracy hints; score is XP for category=xp
    const streakMatch = typeof r.detail === "string" ? r.detail.match(/(\d+)/) : null;
    return {
      rank: i + 1,
      name,
      avatar: initials(name),
      color: colorFor(uid),
      xp: r.score ?? 0,
      streak: streakMatch ? Number(streakMatch[1]) : 0,
      accuracy: 0,
      you: !!myUserId && r.user_id === myUserId,
    };
  });
}
