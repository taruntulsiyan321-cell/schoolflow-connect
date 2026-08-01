import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import { toast } from "@/hooks/use-toast";
import {
  Award,
  Loader2,
  Plus,
  Sword,
  Users,
  Zap,
} from "lucide-react";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { StreakFlame } from "@/components/battleground/bg-bits";
import { BattleFeed } from "@/components/battleground/BattleFeed";
import { MyInvites } from "@/components/battleground/Invites";
import { ArenaLeaderboard } from "@/components/battleground/ArenaLeaderboard";
import { ArenaLiveBattleCard } from "@/components/battleground/ArenaLiveBattleCard";
import { ArenaFocusCards } from "@/components/battleground/ArenaFocusCards";
import { StudentDashboardSkeleton } from "@/components/student/StudentPanelStates";
import { notifyStudentXpUpdated } from "@/hooks/useStudentXp";
import "./battle-arena.css";

const BG_BASE = "/student/battleground";

/** Legacy shell — not product home. Canonical: gurukul/pages/Battleground.tsx */

function levelTitle(level: number): string {
  const tiers = ["Scholar", "Elite Scholar", "Master Scholar", "Grandmaster"];
  const tierIdx = Math.min(Math.floor(Math.max(level - 1, 0) / 3), tiers.length - 1);
  const numerals = ["I", "II", "III"];
  const sub = numerals[(Math.max(level, 1) - 1) % 3];
  return `${tiers[tierIdx]} ${sub}`;
}

function ArenaHeroRing({ xp, level }: { xp: number; level: number }) {
  const xpInLevel = xp % 100;
  const size = 128;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (xpInLevel / 100) * c;
  const nextLevelXp = 100 - xpInLevel;

  return (
    <div className="ba-glass p-4 rounded-2xl flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.15)" strokeWidth={stroke} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="var(--ba-secondary-fixed)"
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.8s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
          <span className="ba-display text-2xl">{Math.round((xpInLevel / 100) * 100)}%</span>
          <span className="ba-label text-[9px] text-[var(--ba-primary-fixed-dim)]">Progress</span>
        </div>
      </div>
      <div className="mt-2 text-center">
        <div className="ba-headline text-[var(--ba-secondary-fixed)]">{xp.toLocaleString()} XP</div>
        <div className="ba-label text-[10px] text-white/60">
          {nextLevelXp} XP to level {level + 1}
        </div>
      </div>
    </div>
  );
}

export function ArenaHub() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data: recovery } = useRecoveryZone();
  const [student, setStudent] = useState<any>(null);
  const [xp, setXp] = useState<any>({
    xp: 0,
    level: 1,
    current_streak: 0,
    total_battles: 0,
    wins: 0,
  });
  const [battles, setBattles] = useState<any[]>([]);
  const [participantsByBattle, setParticipantsByBattle] = useState<Record<string, { display_name: string }[]>>({});
  const [loading, setLoading] = useState(true);
  const [quickLoading, setQuickLoading] = useState(false);

  const refreshXp = useCallback(async () => {
    if (!user) return;
    const { data: x } = await supabase.from("student_xp").select("*").eq("user_id", user.id).maybeSingle();
    if (x) setXp(x);
  }, [user]);

  const loadArena = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: s } = await supabase
      .from("students")
      .select("*, classes(name,section,display_name)")
      .eq("user_id", user.id)
      .maybeSingle();
    setStudent(s);
    await refreshXp();

    let battleQuery = supabase
      .from("battles")
      .select("*")
      .in("status", ["live", "scheduled"])
      .in("mode", ["open", "lobby"]);
    if (s?.class_id) {
      battleQuery = battleQuery.or(`mode.eq.open,and(mode.eq.lobby,class_id.eq.${s.class_id})`);
    } else {
      battleQuery = battleQuery.eq("mode", "open");
    }
    const { data: b } = await battleQuery.order("starts_at", { ascending: true }).limit(8);
    let battleList = b ?? [];

    if (battleList.length > 0) {
      const ids = battleList.map((x) => x.id);
      const { data: parts } = await supabase
        .from("battle_participants")
        .select("battle_id, display_name, user_id, finished_at")
        .in("battle_id", ids)
        .order("joined_at", { ascending: true });
      const finishedByMe = new Set(
        (parts ?? [])
          .filter((p) => p.user_id === user.id && p.finished_at)
          .map((p) => p.battle_id),
      );
      battleList = battleList.filter((battle) => !finishedByMe.has(battle.id)).slice(0, 6);
      battleList = battleList.map((battle) => ({
        ...battle,
        joinedByMe: (parts ?? []).some((p) => p.battle_id === battle.id && p.user_id === user.id && !p.finished_at),
      }));
      setBattles(battleList);
      const map: Record<string, { display_name: string }[]> = {};
      (parts ?? []).forEach((p) => {
        if (!battleList.some((battle) => battle.id === p.battle_id)) return;
        if (!map[p.battle_id]) map[p.battle_id] = [];
        map[p.battle_id].push({ display_name: p.display_name });
      });
      setParticipantsByBattle(map);
    } else {
      setBattles([]);
      setParticipantsByBattle({});
    }

    setLoading(false);
  }, [user, refreshXp]);

  useEffect(() => {
    loadArena();
  }, [loadArena]);

  useEffect(() => {
    const onXp = () => refreshXp();
    window.addEventListener("student-xp-updated", onXp);
    return () => window.removeEventListener("student-xp-updated", onXp);
  }, [refreshXp]);

  const firstName = useMemo(
    () => student?.full_name?.split(" ")[0] || "Student",
    [student?.full_name],
  );

  const launchQuickBattle = async () => {
    setQuickLoading(true);
    const { data, error } = await supabase.rpc("rpc_create_quick_battle", {
      _subject: "Mathematics",
      _difficulty: "medium",
      _count: 5,
      _per_q: 20,
      _chapter: null,
      _class_id: student?.class_id ?? null,
      _topic: null,
    });
    setQuickLoading(false);
    if (error) {
      toast({ title: error.message, variant: "destructive" });
      return;
    }
    notifyStudentXpUpdated();
    nav(`${BG_BASE}/battle/${data}`);
  };

  if (loading) return <StudentDashboardSkeleton />;

  return (
    <div className="wisdom-arena space-y-8 animate-rise pb-24 md:pb-8 relative">
      {/* Hero */}
      <section className="ba-hero p-6 md:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-1/2 h-full opacity-10 bg-[radial-gradient(circle,var(--ba-primary-fixed)_0%,transparent_70%)] pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex-1 space-y-3 text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full ba-glass">
              <Award className="w-4 h-4 text-[var(--ba-secondary-fixed)]" />
              <span className="ba-label text-[var(--ba-secondary-fixed)]">{levelTitle(xp.level)}</span>
            </div>
            <h2 className="ba-display text-2xl md:text-3xl text-white">
              The arena awaits, {firstName}.
            </h2>
            <p className="text-[var(--ba-primary-fixed-dim)] max-w-lg text-sm md:text-base">
              You are{" "}
              <span className="text-[var(--ba-secondary-fixed)] font-semibold">
                {100 - (xp.xp % 100)} XP
              </span>{" "}
              from level {xp.level + 1}. Win battles to climb the class leaderboard.
            </p>
            <div className="flex flex-wrap gap-2 justify-center md:justify-start">
              <StreakFlame streak={xp.current_streak} />
              <span className="text-xs px-2.5 py-1 rounded-full ba-glass text-white/90 font-medium">
                {xp.wins} wins
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full ba-glass text-white/90 font-medium">
                {xp.total_battles} battles
              </span>
              {xp.equipped_badge && (
                <EquippedBadge code={xp.equipped_badge} size="sm" showLabel />
              )}
            </div>
          </div>
          <ArenaHeroRing xp={xp.xp} level={xp.level} />
        </div>
      </section>

      {/* Bento: battles + leaderboard */}
      <div className="ba-gradient">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-1">
          <section className="lg:col-span-8 space-y-4">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[var(--ba-primary-container)]" />
                <h3 className="ba-headline text-sm uppercase tracking-tight text-[var(--ba-primary)]">
                  Live battles
                </h3>
              </div>
              <Link
                to={`${BG_BASE}/create`}
                className="ba-label text-[var(--ba-secondary)] font-bold hover:underline"
              >
                Start a match
              </Link>
            </div>

            {battles.length === 0 ? (
              <div className="ba-card p-8 text-center space-y-3">
                <Sword className="w-10 h-10 mx-auto text-[var(--ba-on-surface-variant)] opacity-40" />
                <p className="text-sm text-[var(--ba-on-surface-variant)]">
                  No open battles right now. Start a quick match or challenge a classmate.
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  <button
                    type="button"
                    onClick={launchQuickBattle}
                    disabled={quickLoading}
                    className="px-4 py-2 rounded-lg bg-[var(--ba-primary-container)] text-white text-sm font-semibold"
                  >
                    {quickLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : "Quick match"}
                  </button>
                  <Link
                    to={`${BG_BASE}/create`}
                    className="px-4 py-2 rounded-lg border border-[var(--ba-outline-variant)] text-sm font-semibold"
                  >
                    Challenge
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {battles.slice(0, 4).map((b) => (
                  <ArenaLiveBattleCard
                    key={b.id}
                    battle={b}
                    participants={participantsByBattle[b.id] ?? []}
                    onJoin={() => nav(`${BG_BASE}/battle/${b.id}`)}
                  />
                ))}
              </div>
            )}

            <MyInvites />

            <BattleFeed limit={12} className="ba-card border-[var(--ba-outline-variant)]" />
          </section>

          <aside className="lg:col-span-4 space-y-4">
            <ArenaLeaderboard />

            <div className="ba-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[var(--ba-primary-container)]" />
                <h3 className="ba-headline text-sm">Quick actions</h3>
              </div>
              <Link
                to={`${BG_BASE}/create`}
                className="flex items-center gap-3 p-3 rounded-lg bg-[var(--ba-surface-low)] hover:bg-[var(--ba-surface-high)] transition-colors"
              >
                <Users className="w-5 h-5 text-[var(--ba-primary-container)]" />
                <div>
                  <div className="text-sm font-semibold">Challenge a classmate</div>
                  <div className="text-xs text-[var(--ba-on-surface-variant)]">1v1 or class lobby</div>
                </div>
              </Link>
              <Link
                to="/student/practice/math12"
                className="flex items-center gap-3 p-3 rounded-lg bg-[var(--ba-surface-low)] hover:bg-[var(--ba-surface-high)] transition-colors"
              >
                <Sword className="w-5 h-5 text-[var(--ba-primary-container)]" />
                <div>
                  <div className="text-sm font-semibold">Class 12 practice</div>
                  <div className="text-xs text-[var(--ba-on-surface-variant)]">Warm up before battling</div>
                </div>
              </Link>
            </div>
          </aside>
        </div>
      </div>

      <ArenaFocusCards streak={xp.current_streak} wins={xp.wins} recovery={recovery} />

      {/* Quick match FAB */}
      <button
        type="button"
        onClick={launchQuickBattle}
        disabled={quickLoading}
        aria-label="Start quick match"
        className="ba-fab fixed bottom-20 md:bottom-8 right-5 md:right-8 w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center transition-transform z-40 disabled:opacity-70"
      >
        {quickLoading ? (
          <Loader2 className="w-7 h-7 animate-spin" />
        ) : (
          <Plus className="w-7 h-7" />
        )}
      </button>
    </div>
  );
}
