/**
 * Student Battleground hub — visual design from DesignAuthenticationPage,
 * wired to live Supabase RPCs via useBattlegroundData.
 * Play rooms stay at /student/battleground/battle/:id (LiveBattleRoom).
 */
import { useState, useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { PageKey } from "@/gurukul/nav";
import { useAuth } from "@/hooks/useAuth";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { toast } from "@/hooks/use-toast";
import {
  useBattlegroundData,
  createBattleFromDesign,
  joinBattleByCode,
  ensureFeatured,
  acceptBattleInvite,
  loadLeaderboardEntries,
  type DesignBattleCard,
  type DesignHistoryEntry,
  type DesignLbEntry,
  type ClassmateOption,
} from "@/gurukul/hooks/useBattlegroundData";
import {
  leagueFromCodeOrXp,
  xpToNextLeague,
  type League as HelperLeague,
} from "@/lib/battlegroundHelpers";
import { getNcertChapters, getNcertSubjects, parseClassGrade } from "@/lib/ncertSyllabus";
import { subjectsForStreamPicker, type AcademicStream } from "@/lib/curriculumScope";
import { displayChapter, displaySubject, humanizeAcademicLabel } from "@/lib/academicDisplay";
import { PracticeService, useAcademicContext } from "@/academic";
import "./battleground-design.css";

/** Fallback subject labels when stream/class cannot be resolved. */
const SUBJECT_OPTIONS = [
  "Mathematics",
  "English",
  "Hindi",
];

// ── Design tokens (DesignAuthenticationPage) ─────────────────────────────────
const C = {
  bg: "#0b0f1a",
  surface: "#131828",
  surface2: "#1a2038",
  border: "rgba(255,255,255,0.07)",
  text: "#eef0f6",
  text2: "rgba(238,240,246,0.6)",
  text3: "rgba(238,240,246,0.32)",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  gold: "#f59e0b",
  green: "#10b981",
  red: "#ef4444",
  orange: "#f97316",
  pink: "#ec4899",
};

type LeagueName = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond";
type BattleStatus = "waiting" | "active" | "won" | "lost" | "completed";
type CreateStep = 1 | 2 | 3;
type BattleType = "1v1" | "team" | "class";
type Phase = "home" | "create";
type FeaturedKind = "daily" | "weekly" | "ncert" | "beat_topper" | "teacher";

const LEAGUE_COLOR: Record<LeagueName, string> = {
  Bronze: "#cd7f32",
  Silver: "#94a3b8",
  Gold: "#f59e0b",
  Platinum: "#22d3ee",
  Diamond: "#818cf8",
};

function toLeagueName(l: HelperLeague): LeagueName {
  if (l.name === "Champion") return "Diamond";
  if (["Bronze", "Silver", "Gold", "Platinum", "Diamond"].includes(l.name)) {
    return l.name as LeagueName;
  }
  return "Bronze";
}

function initials(name: string): string {
  const parts = (name || "S").trim().split(/\s+/);
  return ((parts[0]?.[0] || "S") + (parts[1]?.[0] || parts[0]?.[1] || "")).toUpperCase();
}

function cardStatus(c: DesignBattleCard): BattleStatus {
  if (c.status === "pending" || c.status === "upcoming") return "waiting";
  if (c.status === "live") return "active";
  if (c.result === "won") return "won";
  if (c.result === "lost") return "lost";
  return "completed";
}

const FEATURED_META: {
  kind: FeaturedKind;
  title: string;
  icon: string;
  subject: string;
  chapter: string;
  difficulty: "Easy" | "Medium" | "Hard";
  gradient: string;
  border: string;
}[] = [
  {
    kind: "daily",
    title: "Daily Challenge",
    icon: "🔥",
    subject: "Mathematics",
    chapter: "Today's mixed set",
    difficulty: "Medium",
    gradient: "linear-gradient(135deg, #f97316 0%, #ef4444 100%)",
    border: "rgba(249,115,22,0.25)",
  },
  {
    kind: "ncert",
    title: "NCERT Challenge",
    icon: "📚",
    subject: "Science",
    chapter: "NCERT sprint",
    difficulty: "Hard",
    gradient: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
    border: "rgba(59,130,246,0.25)",
  },
  {
    kind: "teacher",
    title: "Teacher Challenge",
    icon: "🏆",
    subject: "Class focus",
    chapter: "Assigned challenge",
    difficulty: "Easy",
    gradient: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
    border: "rgba(139,92,246,0.25)",
  },
  {
    kind: "beat_topper",
    title: "Beat the Topper",
    icon: "⚡",
    subject: "Physics",
    chapter: "Climb the ranks",
    difficulty: "Hard",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)",
    border: "rgba(245,158,11,0.25)",
  },
  {
    kind: "weekly",
    title: "Weekly Championship",
    icon: "👑",
    subject: "All Subjects",
    chapter: "Mixed — weekly",
    difficulty: "Hard",
    gradient: "linear-gradient(135deg, #10b981 0%, #3b82f6 100%)",
    border: "rgba(16,185,129,0.25)",
  },
];

function guessFeaturedKind(c: DesignBattleCard): FeaturedKind | null {
  const src = (c.source || "").toLowerCase();
  if (src.startsWith("featured_")) {
    const kind = src.slice("featured_".length) as FeaturedKind;
    if (kind === "daily" || kind === "weekly" || kind === "ncert" || kind === "beat_topper" || kind === "teacher") {
      return kind;
    }
  }
  const hay = `${c.title || ""} ${c.id || ""}`.toLowerCase();
  if (hay.includes("daily")) return "daily";
  if (hay.includes("ncert")) return "ncert";
  if (hay.includes("teacher")) return "teacher";
  if (hay.includes("topper") || hay.includes("beat")) return "beat_topper";
  if (hay.includes("week") || hay.includes("champ")) return "weekly";
  if (c.featured) return "daily";
  return null;
}

// ── Small UI atoms ────────────────────────────────────────────────────────────

function Avatar({
  initials: ini,
  size = 40,
  color = C.blue,
  className = "",
}: {
  initials: string;
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `linear-gradient(135deg, ${color}cc, ${color}66)`,
        border: `2px solid ${color}44`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Outfit, sans-serif",
        fontWeight: 700,
        fontSize: size * 0.35,
        color: "#fff",
        flexShrink: 0,
        letterSpacing: "-0.01em",
      }}
    >
      {ini}
    </div>
  );
}

function LeaguePill({ league }: { league: LeagueName }) {
  const col = LEAGUE_COLOR[league];
  return (
    <span
      style={{
        background: `${col}22`,
        border: `1px solid ${col}55`,
        color: col,
        borderRadius: "100px",
        padding: "2px 10px",
        fontSize: "0.72rem",
        fontWeight: 700,
        fontFamily: "Outfit, sans-serif",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {league}
    </span>
  );
}

function DiffBadge({ level }: { level: "Easy" | "Medium" | "Hard" }) {
  const map = {
    Easy: { color: C.green, bg: `${C.green}18` },
    Medium: { color: C.gold, bg: `${C.gold}18` },
    Hard: { color: C.red, bg: `${C.red}18` },
  };
  const { color, bg } = map[level];
  return (
    <span
      style={{
        background: bg,
        color,
        border: `1px solid ${color}33`,
        borderRadius: "4px",
        padding: "1px 7px",
        fontSize: "0.7rem",
        fontWeight: 700,
      }}
    >
      {level}
    </span>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginBottom: "1.25rem",
      }}
    >
      <div>
        <h2
          style={{
            fontFamily: "Outfit, sans-serif",
            fontWeight: 800,
            fontSize: "1.2rem",
            color: C.text,
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p
            style={{
              color: C.text3,
              fontSize: "0.78rem",
              margin: "2px 0 0",
              fontFamily: "Inter, sans-serif",
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function Card({
  children,
  style,
  className = "",
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div className={`glass ${className}`} style={{ borderRadius: "14px", padding: "1.25rem", ...style }}>
      {children}
    </div>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

type MeInfo = {
  name: string;
  initials: string;
  league: LeagueName;
  xp: number;
  xpNext: number;
  rating: number;
  schoolRank: number | null;
  classRank: number | null;
  streak: number;
  bestStreak: number;
  totalBattles: number;
  wins: number;
  losses: number;
  draws: number;
  accuracy: number;
  motivationTitle: string;
  motivationMessage: string;
  xpRemaining: number;
  nextLeague: string;
  dailyXpLabel: string;
};

function HeroSection({
  me,
  onPlayDaily,
  busy,
}: {
  me: MeInfo;
  onPlayDaily: () => void;
  busy: boolean;
}) {
  const xpPct = me.xpNext > 0 ? Math.min(100, Math.round((me.xp / me.xpNext) * 100)) : 100;
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 300);
    return () => clearTimeout(t);
  }, []);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning," : hour < 17 ? "Good afternoon," : "Good evening,";
  const winRate = me.totalBattles > 0 ? Math.round((me.wins / me.totalBattles) * 100) : 0;

  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "1.25rem", marginBottom: "1.5rem" }}
      className="lg-two-col"
    >
      <div
        style={{
          borderRadius: "18px",
          padding: "2rem",
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, #131828 0%, #1a2038 60%, #0f1a30 100%)",
          border: "1px solid rgba(59,130,246,0.2)",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "-60px",
            right: "-40px",
            width: "280px",
            height: "280px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1.25rem", position: "relative" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <div style={{ position: "relative" }}>
              <Avatar initials={me.initials} size={72} color={C.blue} />
              <span
                style={{
                  position: "absolute",
                  bottom: "2px",
                  right: "2px",
                  width: "14px",
                  height: "14px",
                  borderRadius: "50%",
                  background: C.green,
                  border: "2.5px solid #131828",
                }}
              />
            </div>
            <LeaguePill league={me.league} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ color: C.text3, fontSize: "0.75rem", fontFamily: "Inter, sans-serif", margin: "0 0 2px" }}>
              {greet}
            </p>
            <h1
              style={{
                fontFamily: "Outfit, sans-serif",
                fontWeight: 800,
                fontSize: "1.55rem",
                color: C.text,
                margin: "0 0 0.75rem",
                letterSpacing: "-0.02em",
              }}
            >
              {me.name} <span style={{ fontSize: "1.1rem" }}>👋</span>
            </h1>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }} className="sm-one-col">
              {[
                { label: "Battle Rating", value: me.rating.toLocaleString(), color: C.blue },
                {
                  label: "School Rank",
                  value: me.schoolRank ? `#${me.schoolRank}` : "—",
                  color: C.gold,
                },
                {
                  label: "Class Rank",
                  value: me.classRank ? `#${me.classRank}` : "—",
                  color: C.purple,
                },
                { label: "Win Rate", value: `${winRate}%`, color: C.green },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${C.border}`,
                    borderRadius: "10px",
                    padding: "0.6rem 0.75rem",
                  }}
                >
                  <div style={{ fontFamily: "DM Mono, monospace", fontSize: "1.2rem", fontWeight: 500, color, lineHeight: 1 }}>
                    {value}
                  </div>
                  <div style={{ color: C.text3, fontSize: "0.65rem", marginTop: "3px", fontFamily: "Inter, sans-serif" }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
                <span style={{ color: C.text2, fontSize: "0.72rem", fontFamily: "Inter, sans-serif" }}>
                  XP Progress — <span style={{ color: C.purple }}>{me.xp.toLocaleString()}</span> /{" "}
                  {me.xpNext.toLocaleString()}
                </span>
                <span style={{ fontFamily: "DM Mono, monospace", fontSize: "0.72rem", color: C.purple }}>{xpPct}%</span>
              </div>
              <div style={{ height: "8px", background: "rgba(255,255,255,0.06)", borderRadius: "100px", overflow: "hidden" }}>
                <div
                  className="xp-bar-fill"
                  style={
                    {
                      height: "100%",
                      borderRadius: "100px",
                      background: `linear-gradient(90deg, ${C.purple}, ${C.blue})`,
                      "--xp-w": `${xpPct}%`,
                      width: animated ? `${xpPct}%` : "0%",
                      boxShadow: `0 0 10px ${C.purple}66`,
                    } as CSSProperties
                  }
                />
              </div>
              <p style={{ color: C.text3, fontSize: "0.68rem", marginTop: "4px", fontFamily: "Inter, sans-serif" }}>
                {me.xpRemaining > 0 ? (
                  <>
                    {me.xpRemaining} XP to{" "}
                    <strong style={{ color: LEAGUE_COLOR[me.nextLeague as LeagueName] || C.gold }}>{me.nextLeague}</strong>
                  </>
                ) : (
                  "Top league reached — keep battling!"
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div
          style={{
            flex: 1,
            borderRadius: "18px",
            padding: "1.5rem",
            background: "linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(249,115,22,0.08) 100%)",
            border: "1px solid rgba(245,158,11,0.25)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div aria-hidden style={{ position: "absolute", top: "-20px", right: "-20px", fontSize: "5rem", opacity: 0.08 }}>
            🏆
          </div>
          <div className="float-anim" style={{ fontSize: "1.6rem", marginBottom: "0.6rem" }}>
            ⚔️
          </div>
          <p
            style={{
              fontFamily: "Outfit, sans-serif",
              fontWeight: 600,
              fontSize: "0.95rem",
              color: C.text,
              lineHeight: 1.45,
              margin: 0,
            }}
          >
            {me.motivationTitle}
          </p>
          <p style={{ color: C.text3, fontSize: "0.72rem", marginTop: "0.5rem", fontFamily: "Inter, sans-serif" }}>
            {me.motivationMessage}
          </p>
        </div>

        <div
          style={{
            borderRadius: "14px",
            padding: "1rem 1.25rem",
            background: "linear-gradient(135deg, rgba(249,115,22,0.12) 0%, rgba(239,68,68,0.08) 100%)",
            border: "1px solid rgba(249,115,22,0.22)",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <span className="streak-icon" style={{ fontSize: "1.6rem" }}>
            🔥
          </span>
          <div>
            <div style={{ fontFamily: "DM Mono, monospace", fontSize: "1.4rem", fontWeight: 500, color: C.orange, lineHeight: 1 }}>
              {me.streak}
            </div>
            <div style={{ color: C.text3, fontSize: "0.68rem", marginTop: "2px", fontFamily: "Inter, sans-serif" }}>
              Win streak · Don&apos;t break it!
            </div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontFamily: "DM Mono, monospace", fontSize: "0.75rem", color: C.text2 }}>Best: {me.bestStreak}</div>
            <div style={{ display: "flex", gap: "3px", marginTop: "4px", justifyContent: "flex-end" }}>
              {Array.from({ length: Math.max(7, me.bestStreak || 7) }, (_, i) => i + 1)
                .slice(0, 7)
                .map((i) => (
                  <div
                    key={i}
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "2px",
                      background: i <= me.streak ? C.orange : "rgba(255,255,255,0.08)",
                    }}
                  />
                ))}
            </div>
          </div>
        </div>

        <div
          style={{
            borderRadius: "14px",
            padding: "0.85rem 1.25rem",
            background: "linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(59,130,246,0.08) 100%)",
            border: "1px solid rgba(16,185,129,0.22)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "1.1rem" }}>🎯</span>
            <div>
              <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: "0.82rem", color: C.text }}>
                Daily Challenge
              </div>
              <div style={{ color: C.text3, fontSize: "0.67rem", fontFamily: "Inter, sans-serif" }}>{me.dailyXpLabel}</div>
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={onPlayDaily}
            style={{
              background: C.green,
              border: "none",
              borderRadius: "8px",
              padding: "5px 14px",
              color: "#fff",
              fontFamily: "Outfit, sans-serif",
              fontWeight: 700,
              fontSize: "0.75rem",
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            Play
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quick actions + join modal ────────────────────────────────────────────────

function QuickActions({
  onCreate,
  onJoin,
  onDaily,
  onWeekly,
  busy,
  dailyXpLabel,
}: {
  onCreate: () => void;
  onJoin: () => void;
  onDaily: () => void;
  onWeekly: () => void;
  busy: boolean;
  dailyXpLabel: string;
}) {
  const actions = [
    {
      icon: "⚔️",
      label: "Create Challenge",
      desc: "Invite a classmate to battle",
      color: C.blue,
      grad: `linear-gradient(135deg, ${C.blue}22, ${C.blue}08)`,
      border: "rgba(59,130,246,0.3)",
      onClick: onCreate,
    },
    {
      icon: "🎯",
      label: "Join Challenge",
      desc: "Enter a battle with a code",
      color: C.purple,
      grad: `linear-gradient(135deg, ${C.purple}22, ${C.purple}08)`,
      border: "rgba(139,92,246,0.3)",
      onClick: onJoin,
    },
    {
      icon: "🔥",
      label: "Daily Challenge",
      desc: `Today's challenge — ${dailyXpLabel}`,
      color: C.orange,
      grad: `linear-gradient(135deg, ${C.orange}22, ${C.orange}08)`,
      border: "rgba(249,115,22,0.3)",
      onClick: onDaily,
    },
    {
      icon: "👑",
      label: "Championship",
      desc: "Weekly top tournament",
      color: C.gold,
      grad: `linear-gradient(135deg, ${C.gold}22, ${C.gold}08)`,
      border: "rgba(245,158,11,0.3)",
      onClick: onWeekly,
    },
  ];

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <SectionHeader title="Quick Actions" subtitle="Start your next challenge" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.85rem" }} className="sm-one-col">
        {actions.map(({ icon, label, desc, color, grad, border, onClick }) => (
          <button
            key={label}
            type="button"
            className="action-card"
            disabled={busy}
            onClick={onClick}
            style={{
              background: grad,
              border: `1px solid ${border}`,
              borderRadius: "14px",
              padding: "1.25rem",
              cursor: busy ? "wait" : "pointer",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem",
              opacity: busy ? 0.75 : 1,
            }}
          >
            <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>{icon}</span>
            <span
              style={{
                fontFamily: "Outfit, sans-serif",
                fontWeight: 800,
                fontSize: "0.95rem",
                color: C.text,
                letterSpacing: "-0.01em",
                display: "block",
              }}
            >
              {label}
            </span>
            <span style={{ fontFamily: "Inter, sans-serif", fontSize: "0.72rem", color: C.text3, display: "block" }}>
              {desc}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "0.25rem" }}>
              <span style={{ color, fontSize: "0.72rem", fontFamily: "Outfit, sans-serif", fontWeight: 700 }}>Start →</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function JoinCodeModal({
  open,
  onClose,
  onJoin,
  joining,
}: {
  open: boolean;
  onClose: () => void;
  onJoin: (code: string) => Promise<void>;
  joining: boolean;
}) {
  const [code, setCode] = useState("");
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(6px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: "20px",
          padding: "1.75rem",
          maxWidth: "420px",
          width: "100%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontFamily: "Outfit, sans-serif", fontWeight: 800, fontSize: "1.15rem", color: C.text, margin: "0 0 0.35rem" }}>
          Join Challenge
        </h2>
        <p style={{ color: C.text3, fontSize: "0.78rem", margin: "0 0 1rem", fontFamily: "Inter, sans-serif" }}>
          Enter the battle code shared by your classmate.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. A3X9TK"
          autoFocus
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${C.border}`,
            borderRadius: "10px",
            padding: "0.75rem 1rem",
            color: C.text,
            fontFamily: "DM Mono, monospace",
            fontSize: "1.1rem",
            letterSpacing: "0.2em",
            outline: "none",
            marginBottom: "1rem",
          }}
        />
        <div style={{ display: "flex", gap: "0.6rem" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              background: "none",
              border: `1px solid ${C.border}`,
              borderRadius: "10px",
              padding: "0.65rem",
              color: C.text2,
              fontFamily: "Outfit, sans-serif",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={joining || !code.trim()}
            onClick={() => void onJoin(code)}
            style={{
              flex: 1,
              background: C.purple,
              border: "none",
              borderRadius: "10px",
              padding: "0.65rem",
              color: "#fff",
              fontFamily: "Outfit, sans-serif",
              fontWeight: 700,
              cursor: joining ? "wait" : "pointer",
              opacity: joining || !code.trim() ? 0.6 : 1,
            }}
          >
            {joining ? "Joining…" : "Join Battle"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Featured ──────────────────────────────────────────────────────────────────

function FeaturedBattles({
  liveFeatured,
  onLaunch,
  busy,
}: {
  liveFeatured: DesignBattleCard[];
  onLaunch: (kind: FeaturedKind, battleId?: string) => void;
  busy: boolean;
}) {
  const cards = FEATURED_META.map((meta) => {
    const live =
      liveFeatured.find((b) => guessFeaturedKind(b) === meta.kind) ||
      liveFeatured.find((b) => b.featured && b.title.toLowerCase().includes(meta.title.split(" ")[0].toLowerCase()));
    return { meta, live };
  });

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <SectionHeader title="Featured Battles" subtitle="Open challenges for everyone" />
      <div style={{ display: "flex", gap: "0.85rem", overflowX: "auto", paddingBottom: "0.5rem", scrollSnapType: "x mandatory" }}>
        {cards.map(({ meta, live }) => (
          <div
            key={meta.kind}
            className="battle-card"
            style={{
              minWidth: "240px",
              maxWidth: "240px",
              borderRadius: "16px",
              overflow: "hidden",
              border: `1px solid ${meta.border}`,
              scrollSnapAlign: "start",
              background: C.surface,
              flexShrink: 0,
            }}
          >
            <div style={{ background: meta.gradient, padding: "1rem 1.1rem 0.85rem", position: "relative" }}>
              <div style={{ fontSize: "1.4rem", marginBottom: "0.35rem" }}>{meta.icon}</div>
              <div
                style={{
                  fontFamily: "Outfit, sans-serif",
                  fontWeight: 800,
                  fontSize: "0.95rem",
                  color: "#fff",
                  letterSpacing: "-0.01em",
                }}
              >
                {live?.title || meta.title}
              </div>
              <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.72rem", marginTop: "1px", fontFamily: "Inter, sans-serif" }}>
                {live?.chapter ? displayChapter(live.chapter) : humanizeAcademicLabel(meta.chapter)}
              </div>
            </div>
            <div style={{ padding: "0.85rem 1.1rem" }}>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.7rem", alignItems: "center" }}>
                <span
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    color: C.text2,
                    borderRadius: "4px",
                    padding: "2px 7px",
                    fontSize: "0.68rem",
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  {displaySubject(live?.subject) || displaySubject(meta.subject) || "—"}
                </span>
                <DiffBadge level={meta.difficulty} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginBottom: "0.85rem" }}>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: "6px", padding: "0.4rem 0.5rem" }}>
                  <div style={{ fontFamily: "DM Mono, monospace", fontSize: "0.82rem", color: C.gold }}>
                    {live?.xpReward ? `${live.xpReward} XP` : "—"}
                  </div>
                  <div style={{ color: C.text3, fontSize: "0.6rem" }}>Reward</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: "6px", padding: "0.4rem 0.5rem" }}>
                  <div style={{ fontFamily: "DM Mono, monospace", fontSize: "0.82rem", color: C.blue }}>
                    {live?.players ?? "—"}
                  </div>
                  <div style={{ color: C.text3, fontSize: "0.6rem" }}>Players</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: C.text3, fontSize: "0.68rem", fontFamily: "DM Mono, monospace" }}>
                  {live?.timeLeft || live?.startsIn || "Open"}
                </span>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => onLaunch(meta.kind, live?.id)}
                  style={{
                    background: meta.gradient,
                    border: "none",
                    borderRadius: "8px",
                    padding: "5px 14px",
                    color: "#fff",
                    fontFamily: "Outfit, sans-serif",
                    fontWeight: 700,
                    fontSize: "0.75rem",
                    cursor: busy ? "wait" : "pointer",
                  }}
                >
                  Join
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── My Battles ────────────────────────────────────────────────────────────────

const TABS: { key: BattleStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "waiting", label: "Waiting" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "completed", label: "Completed" },
];

const STATUS_META: Record<BattleStatus, { label: string; color: string; dot: string }> = {
  active: { label: "In Progress", color: C.blue, dot: C.blue },
  waiting: { label: "Waiting", color: C.gold, dot: C.gold },
  won: { label: "Victory", color: C.green, dot: C.green },
  lost: { label: "Defeat", color: C.red, dot: C.red },
  completed: { label: "Completed", color: C.text3, dot: C.text3 },
};

function MyBattlesPanel({
  battles,
  onNew,
  onOpen,
  onAnalysis,
  loading,
}: {
  battles: DesignBattleCard[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onAnalysis: (participantId: string) => void;
  loading: boolean;
}) {
  const [tab, setTab] = useState<BattleStatus | "all">("all");
  const mapped = battles.map((b) => ({ card: b, status: cardStatus(b) }));
  const filtered = tab === "all" ? mapped : mapped.filter((b) => b.status === tab);

  return (
    <Card style={{ padding: "1.25rem" }}>
      <SectionHeader
        title="My Battles"
        subtitle={`${battles.length} total battles`}
        action={
          <button
            type="button"
            className="btn-primary"
            onClick={onNew}
            style={{
              background: C.blue,
              border: "none",
              borderRadius: "8px",
              padding: "5px 14px",
              color: "#fff",
              fontFamily: "Outfit, sans-serif",
              fontWeight: 700,
              fontSize: "0.75rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span>⚔️</span> New Battle
          </button>
        }
      />

      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, marginBottom: "1rem", overflowX: "auto" }}>
        {TABS.map(({ key, label }) => {
          const count = key === "all" ? mapped.length : mapped.filter((b) => b.status === key).length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`tab-btn${tab === key ? " active" : ""}`}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0.5rem 0.9rem",
                fontFamily: "Outfit, sans-serif",
                fontWeight: 700,
                fontSize: "0.8rem",
                color: tab === key ? C.blue : C.text3,
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              {label}
              {count > 0 && (
                <span
                  style={{
                    background: tab === key ? `${C.blue}22` : "rgba(255,255,255,0.06)",
                    color: tab === key ? C.blue : C.text3,
                    borderRadius: "100px",
                    padding: "0px 6px",
                    fontSize: "0.65rem",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem", color: C.text3 }}>Loading battles…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: C.text3 }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>⚔️</div>
          <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: "0.9rem", color: C.text2, marginBottom: "0.3rem" }}>
            No battles here
          </div>
          <div style={{ fontSize: "0.75rem", fontFamily: "Inter, sans-serif" }}>
            Create a challenge and invite your classmates.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          {filtered.map(({ card: b, status }) => {
            const meta = STATUS_META[status];
            const isActive = status === "active";
            const isWon = status === "won";
            const oppName = b.opponent || b.title || "Challenger";
            const oppIni = b.opponentAvatar || initials(oppName);
            return (
              <div
                key={b.id + (b.inviteId || "")}
                className="battle-card"
                style={{
                  background: isActive ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isActive ? "rgba(59,130,246,0.2)" : C.border}`,
                  borderRadius: "12px",
                  padding: "0.9rem 1rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.85rem",
                }}
              >
                <Avatar initials={oppIni} size={42} color={isWon ? C.green : isActive ? C.blue : b.opponentColor || C.text3} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                    <span style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: "0.88rem", color: C.text }}>
                      {oppName}
                    </span>
                    {b.battleCode && (
                      <span style={{ fontFamily: "DM Mono, monospace", fontSize: "0.65rem", color: C.text3 }}>{b.battleCode}</span>
                    )}
                  </div>
                  <div style={{ color: C.text3, fontSize: "0.7rem", fontFamily: "Inter, sans-serif" }}>
                    {displaySubject(b.subject) || "—"} · {b.type === "1v1" ? "1v1" : b.type} · {b.players}/{b.maxPlayers}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                    <DiffBadge level="Medium" />
                    <span style={{ fontFamily: "DM Mono, monospace", fontSize: "0.68rem", color: C.gold }}>+{b.xpReward} XP</span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {b.myScore != null && (
                    <div
                      style={{
                        fontFamily: "DM Mono, monospace",
                        fontSize: "1rem",
                        fontWeight: 500,
                        color: isWon ? C.green : status === "lost" ? C.red : C.text,
                        marginBottom: "2px",
                      }}
                    >
                      {b.myScore} <span style={{ color: C.text3, fontSize: "0.75rem" }}>vs</span> {b.theirScore ?? "—"}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: "flex-end", marginBottom: "6px" }}>
                    <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: meta.dot, display: "inline-block" }} />
                    <span style={{ color: meta.color, fontSize: "0.68rem", fontFamily: "Outfit, sans-serif", fontWeight: 700 }}>
                      {meta.label}
                    </span>
                  </div>
                  {(status === "active" || status === "waiting" || b.status === "pending") && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => onOpen(b.id)}
                      style={{
                        background: status === "active" || b.status === "pending" ? C.blue : "rgba(255,255,255,0.08)",
                        border: "none",
                        borderRadius: "7px",
                        padding: "4px 12px",
                        color: "#fff",
                        fontFamily: "Outfit, sans-serif",
                        fontWeight: 700,
                        fontSize: "0.72rem",
                        cursor: "pointer",
                      }}
                    >
                      {b.status === "pending" ? "Accept ▶" : status === "active" ? "Resume ▶" : "Open…"}
                    </button>
                  )}
                  {(status === "won" || status === "lost" || status === "completed") && b.participantId && (
                    <button
                      type="button"
                      onClick={() => onAnalysis(b.participantId!)}
                      style={{
                        background: "none",
                        border: `1px solid ${C.border}`,
                        borderRadius: "7px",
                        padding: "4px 10px",
                        color: C.text3,
                        fontFamily: "Outfit, sans-serif",
                        fontWeight: 700,
                        fontSize: "0.7rem",
                        cursor: "pointer",
                      }}
                    >
                      Analysis
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Leaderboard sidebar ───────────────────────────────────────────────────────

function LeaderboardPanel({ entries, classLabel }: { entries: DesignLbEntry[]; classLabel: string }) {
  const me = entries.find((e) => e.you);
  const above = me && me.rank > 1 ? entries.find((e) => e.rank === me.rank - 1) : null;
  const xpGap = above && me ? Math.max(0, above.xp - me.xp) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <Card>
        <SectionHeader title="Class Leaderboard" subtitle={classLabel} />
        {xpGap != null && xpGap > 0 && (
          <div
            style={{
              background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(249,115,22,0.08))",
              border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: "10px",
              padding: "0.75rem 1rem",
              marginBottom: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "1rem" }}>🎯</span>
            <p style={{ margin: 0, fontFamily: "Inter, sans-serif", fontSize: "0.78rem", color: C.text, lineHeight: 1.4 }}>
              Only <strong style={{ color: C.gold }}>{xpGap} XP</strong> away from{" "}
              <strong style={{ color: C.gold }}>Rank #{(me?.rank ?? 1) - 1}</strong>. One win away!
            </p>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "32px 1fr 80px 60px",
            gap: 0,
            padding: "0 0.25rem 0.5rem",
            borderBottom: `1px solid ${C.border}`,
            marginBottom: "0.4rem",
          }}
        >
          {["#", "Student", "XP", "Acc"].map((h) => (
            <span
              key={h}
              style={{
                color: C.text3,
                fontSize: "0.65rem",
                fontFamily: "Outfit, sans-serif",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {h}
            </span>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {entries.length === 0 && (
            <div style={{ padding: "1.5rem", textAlign: "center", color: C.text3, fontSize: "0.8rem" }}>
              No rankings yet — finish a battle to appear here
            </div>
          )}
          {entries.slice(0, 10).map((s) => {
            const rankColors: Record<number, string> = { 1: C.gold, 2: "#94a3b8", 3: "#cd7f32" };
            const rankColor = rankColors[s.rank] || C.text3;
            return (
              <div
                key={`${s.rank}-${s.name}`}
                className="leaderboard-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px 1fr 80px 60px",
                  alignItems: "center",
                  padding: "0.5rem 0.25rem",
                  borderRadius: "8px",
                  background: s.you ? "rgba(59,130,246,0.1)" : "transparent",
                  border: s.you ? "1px solid rgba(59,130,246,0.22)" : "1px solid transparent",
                }}
              >
                <span
                  style={{
                    fontFamily: "DM Mono, monospace",
                    fontSize: "0.82rem",
                    color: rankColor,
                    fontWeight: s.rank <= 3 ? 600 : 400,
                  }}
                >
                  {s.rank <= 3 ? ["🥇", "🥈", "🥉"][s.rank - 1] : s.rank}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
                  <Avatar initials={s.avatar} size={26} color={s.you ? C.blue : s.color || C.text3} />
                  <span
                    style={{
                      fontFamily: "Outfit, sans-serif",
                      fontWeight: s.you ? 700 : 500,
                      fontSize: "0.8rem",
                      color: s.you ? C.blue : C.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.name}
                    {s.you ? " (you)" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontFamily: "DM Mono, monospace", fontSize: "0.78rem", color: C.text2 }}>
                    {s.xp.toLocaleString()}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontFamily: "DM Mono, monospace", fontSize: "0.72rem", color: C.text2 }}>{s.accuracy}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

function BattleHistoryPanel({
  entries,
  onAnalysis,
}: {
  entries: DesignHistoryEntry[];
  onAnalysis: (participantId: string) => void;
}) {
  return (
    <Card style={{ marginBottom: "1.5rem" }}>
      <SectionHeader title="Battle History" subtitle="Your recent battles" />
      <div style={{ position: "relative", paddingLeft: "1.25rem" }}>
        <div
          style={{
            position: "absolute",
            left: "6px",
            top: "8px",
            bottom: "8px",
            width: "1px",
            background: `linear-gradient(to bottom, ${C.blue}66, transparent)`,
          }}
        />
        {entries.length === 0 && (
          <div style={{ padding: "1.5rem", color: C.text3, fontSize: "0.8rem" }}>No battles finished yet</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          {entries.slice(0, 8).map((h) => {
            const won = h.result === "won";
            const draw = h.result === "draw" || h.result === "finished";
            return (
              <div
                key={h.id}
                className="battle-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.85rem",
                  padding: "0.75rem 1rem",
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${C.border}`,
                  borderRadius: "10px",
                  cursor: "pointer",
                  position: "relative",
                }}
                onClick={() => onAnalysis(h.participantId)}
              >
                <div
                  style={{
                    position: "absolute",
                    left: "-1.1rem",
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: won ? C.green : draw ? C.text3 : C.red,
                    border: "2px solid #0b0f1a",
                    zIndex: 1,
                  }}
                />
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "8px",
                    background: won ? `${C.green}18` : draw ? "rgba(255,255,255,0.06)" : `${C.red}18`,
                    border: `1px solid ${won ? C.green : draw ? C.border : C.red}33`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.1rem",
                    flexShrink: 0,
                  }}
                >
                  {won ? "🏆" : draw ? "🤝" : "💔"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: "0.85rem", color: C.text }}>
                    vs {h.opponent}
                  </div>
                  <div style={{ color: C.text3, fontSize: "0.7rem", fontFamily: "Inter, sans-serif", marginTop: "1px" }}>
                    {displaySubject(h.subject) || "—"} · {h.date}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        fontFamily: "DM Mono, monospace",
                        fontSize: "0.88rem",
                        color: won ? C.green : draw ? C.text2 : C.red,
                      }}
                    >
                      {h.myScore}–{h.theirScore}
                    </div>
                    <div style={{ color: C.text3, fontSize: "0.6rem" }}>Score</div>
                  </div>
                  <div style={{ textAlign: "center" }} className="sm-hide">
                    <div style={{ fontFamily: "DM Mono, monospace", fontSize: "0.88rem", color: C.blue }}>{h.accuracy}%</div>
                    <div style={{ color: C.text3, fontSize: "0.6rem" }}>Accuracy</div>
                  </div>
                  {h.xp > 0 && (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: "DM Mono, monospace", fontSize: "0.88rem", color: C.gold }}>+{h.xp}</div>
                      <div style={{ color: C.text3, fontSize: "0.6rem" }}>XP</div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAnalysis(h.participantId);
                    }}
                    style={{
                      background: "none",
                      border: `1px solid ${C.border}`,
                      borderRadius: "6px",
                      padding: "3px 9px",
                      color: C.text3,
                      fontFamily: "Outfit, sans-serif",
                      fontWeight: 700,
                      fontSize: "0.68rem",
                      cursor: "pointer",
                    }}
                  >
                    Analysis
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ── Achievements + stats (derived from live XP) ────────────────────────────────

function AchievementsPanel({ me }: { me: MeInfo }) {
  const items = [
    { id: 1, icon: "🏅", title: "First Victory", desc: "Win your first battle", unlocked: me.wins >= 1, rarity: "common" as const },
    {
      id: 2,
      icon: "🔥",
      title: "4 Win Streak",
      desc: "4 consecutive wins",
      unlocked: me.streak >= 4 || me.bestStreak >= 4,
      rarity: "rare" as const,
    },
    { id: 3, icon: "⚔️", title: "Battle Tested", desc: "Play 50 battles", unlocked: me.totalBattles >= 50, rarity: "common" as const },
    { id: 4, icon: "🎯", title: "Sharp Shooter", desc: "90%+ accuracy", unlocked: me.accuracy >= 90, rarity: "epic" as const },
    { id: 5, icon: "👑", title: "Gold League", desc: "Reach Gold League", unlocked: ["Gold", "Platinum", "Diamond"].includes(me.league), rarity: "epic" as const },
    { id: 6, icon: "💎", title: "Diamond Mind", desc: "Reach Diamond League", unlocked: me.league === "Diamond", rarity: "legendary" as const },
    { id: 7, icon: "🌟", title: "Century Club", desc: "Win 100 battles", unlocked: me.wins >= 100, rarity: "legendary" as const },
    { id: 8, icon: "📚", title: "Rising Star", desc: "Earn 1000 XP", unlocked: me.xp >= 1000, rarity: "rare" as const },
  ];
  const rarityColor = { common: "#94a3b8", rare: C.blue, epic: C.purple, legendary: C.gold };
  const rarityLabel = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };

  return (
    <Card>
      <SectionHeader
        title="Achievements"
        subtitle={`${items.filter((a) => a.unlocked).length} / ${items.length} unlocked`}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.7rem" }} className="sm-one-col">
        {items.map((a) => {
          const rc = rarityColor[a.rarity];
          return (
            <div
              key={a.id}
              className="badge-card"
              style={{
                background: a.unlocked ? `${rc}12` : "rgba(255,255,255,0.03)",
                border: `1px solid ${a.unlocked ? `${rc}33` : C.border}`,
                borderRadius: "12px",
                padding: "0.9rem",
                textAlign: "center",
                position: "relative",
                filter: a.unlocked ? "none" : "grayscale(1)",
                opacity: a.unlocked ? 1 : 0.45,
                animation: a.unlocked ? `bg-badge-pop 0.4s ease-out ${a.id * 0.05}s both` : "none",
              }}
            >
              {a.unlocked && (
                <div
                  style={{
                    position: "absolute",
                    top: "6px",
                    right: "8px",
                    fontFamily: "Outfit, sans-serif",
                    fontSize: "0.58rem",
                    fontWeight: 700,
                    color: rc,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {rarityLabel[a.rarity]}
                </div>
              )}
              <div style={{ fontSize: "1.8rem", marginBottom: "0.35rem", display: "block", lineHeight: 1 }}>{a.icon}</div>
              <div
                style={{
                  fontFamily: "Outfit, sans-serif",
                  fontWeight: 700,
                  fontSize: "0.78rem",
                  color: a.unlocked ? C.text : C.text3,
                  marginBottom: "2px",
                }}
              >
                {a.title}
              </div>
              <div style={{ color: C.text3, fontSize: "0.64rem", fontFamily: "Inter, sans-serif", lineHeight: 1.3 }}>{a.desc}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function StatisticsPanel({ me }: { me: MeInfo }) {
  const winRate = me.totalBattles > 0 ? Math.round((me.wins / me.totalBattles) * 100) : 0;
  const stats = [
    { label: "Battles Played", value: String(me.totalBattles), icon: "⚔️", color: C.blue, sub: "Lifetime" },
    { label: "Battles Won", value: String(me.wins), icon: "🏆", color: C.green, sub: `${winRate}% win rate` },
    { label: "Current Streak", value: String(me.streak), icon: "🔥", color: C.orange, sub: `Personal best: ${me.bestStreak}` },
    { label: "Battle XP", value: me.xp.toLocaleString(), icon: "⚡", color: C.purple, sub: me.league },
    { label: "Avg. Accuracy", value: `${me.accuracy}%`, icon: "🎯", color: C.gold, sub: "From finished battles" },
    {
      label: "Battles Lost",
      value: String(me.losses),
      icon: "📉",
      color: C.pink,
      sub: me.draws > 0 ? `${me.draws} draw${me.draws === 1 ? "" : "s"}` : "Keep climbing",
    },
    { label: "Battle Rating", value: me.rating.toLocaleString(), icon: "📊", color: "#22d3ee", sub: "Derived from XP + wins" },
    {
      label: "Class Rank",
      value: me.classRank ? `#${me.classRank}` : "—",
      icon: "🏫",
      color: C.gold,
      sub: me.schoolRank ? `School #${me.schoolRank}` : "Class board",
    },
  ];

  return (
    <Card>
      <SectionHeader title="My Statistics" subtitle="Performance overview" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.7rem" }} className="sm-one-col">
        {stats.map(({ label, value, icon, color, sub }) => (
          <div
            key={label}
            className="battle-card"
            style={{
              background: `${color}0d`,
              border: `1px solid ${color}22`,
              borderRadius: "12px",
              padding: "0.9rem 1rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "1.1rem" }}>{icon}</span>
            </div>
            <div style={{ fontFamily: "DM Mono, monospace", fontSize: "1.4rem", fontWeight: 500, color, letterSpacing: "-0.01em", lineHeight: 1 }}>
              {value}
            </div>
            <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: "0.75rem", color: C.text, marginTop: "4px" }}>
              {label}
            </div>
            <div style={{ color: C.text3, fontSize: "0.65rem", marginTop: "2px", fontFamily: "Inter, sans-serif" }}>{sub}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Create wizard (design-styled, live RPCs) ──────────────────────────────────

interface BattleConfig {
  type: BattleType;
  subject: string;
  chapter: string;
  difficulty: string;
  questions: number;
  timeLimitMin: number;
  visibility: "public" | "private";
  inviteCode: string;
}

function CreateBattleWizard({
  onBack,
  onCreate,
  onEnter,
  classmates,
  creating,
  classLabel,
}: {
  onBack: () => void;
  onCreate: (cfg: BattleConfig & { opponentUserId?: string }) => Promise<{ id: string; battleCode: string | null }>;
  onEnter: (battleId: string) => void;
  classmates: ClassmateOption[];
  creating?: boolean;
  classLabel?: string;
}) {
  const { ctx, ready: academicReady } = useAcademicContext();
  const gradeFromLabel = useMemo(() => parseClassGrade(classLabel), [classLabel]);
  const [stream, setStream] = useState<AcademicStream | null>(null);
  const [scopeClassLevel, setScopeClassLevel] = useState<number | null>(null);
  const grade = scopeClassLevel ?? gradeFromLabel;

  useEffect(() => {
    if (!ctx || !academicReady) return;
    let cancelled = false;
    (async () => {
      try {
        const scope = await PracticeService.resolveCurriculumScope(ctx);
        if (!cancelled) {
          setStream(scope.stream);
          setScopeClassLevel(scope.classLevel);
        }
      } catch {
        if (!cancelled) {
          setStream(null);
          setScopeClassLevel(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ctx, academicReady]);

  const subjectOptions = useMemo(() => {
    const scoped = subjectsForStreamPicker(stream, grade, getNcertSubjects(grade));
    return scoped.length ? scoped : SUBJECT_OPTIONS;
  }, [grade, stream]);

  const [step, setStep] = useState<CreateStep>(1);
  const [type, setType] = useState<BattleType>("1v1");
  const [subject, setSubject] = useState(subjectOptions[0] ?? "Mathematics");
  const [chapter, setChapter] = useState("All");
  const [difficulty, setDifficulty] = useState("medium");
  const [questions, setQuestions] = useState(10);
  const [timeLimit, setTimeLimit] = useState(15);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [opponentQ, setOpponentQ] = useState("");
  const [opponentUserId, setOpponentUserId] = useState<string | undefined>();
  const [realCode, setRealCode] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (subjectOptions.length && !subjectOptions.includes(subject)) {
      setSubject(subjectOptions[0]);
      setChapter("All");
    }
  }, [subjectOptions, subject]);

  const chapters = useMemo(() => {
    // Commerce / bank-driven subjects: free-form "All" until bank chapters load in battle RPC.
    const list = getNcertChapters(grade, subject);
    return ["All", ...list];
  }, [grade, subject]);

  const filteredMates = classmates
    .filter((m) => !opponentQ || m.full_name.toLowerCase().includes(opponentQ.toLowerCase()))
    .slice(0, 8);

  function copyCode(code: string) {
    if (!code) return;
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleStart() {
    if (createdId) {
      onEnter(createdId);
      return;
    }
    try {
      const result = await onCreate({
        type,
        subject: subject || "Mathematics",
        chapter: chapter || "All",
        difficulty,
        questions,
        timeLimitMin: timeLimit,
        visibility,
        inviteCode: "",
        opponentUserId,
      });
      setCreatedId(result.id);
      if (result.battleCode) {
        setRealCode(result.battleCode);
        copyCode(result.battleCode);
      }
      if (opponentUserId || !result.battleCode) {
        onEnter(result.id);
      }
    } catch {
      /* parent toasts */
    }
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${C.border}`,
    borderRadius: "10px",
    padding: "0.65rem 0.85rem",
    color: C.text,
    fontFamily: "Inter, sans-serif",
    fontSize: "0.85rem",
    outline: "none",
  };

  return (
    <div style={{ maxWidth: "520px", margin: "0 auto" }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          background: "none",
          border: "none",
          color: C.text2,
          fontFamily: "Outfit, sans-serif",
          fontWeight: 700,
          fontSize: "0.85rem",
          cursor: "pointer",
          marginBottom: "1rem",
          padding: 0,
        }}
      >
        ← Back to Arena
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
        {[1, 2, 3].map((s) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontWeight: 800,
                fontFamily: "Outfit, sans-serif",
                background: step === s ? C.blue : step > s ? C.green : "rgba(255,255,255,0.08)",
                color: "#fff",
              }}
            >
              {step > s ? "✓" : s}
            </div>
            {s < 3 && (
              <div
                style={{
                  flex: 1,
                  height: "2px",
                  borderRadius: "2px",
                  background: step > s ? C.green : "rgba(255,255,255,0.1)",
                }}
              />
            )}
          </div>
        ))}
      </div>
      <p style={{ color: C.text3, fontSize: "0.75rem", marginBottom: "1rem" }}>
        {step === 1 ? "Choose battle format" : step === 2 ? "Configure your battle" : "Invite challengers"}
      </p>

      <Card>
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            <h2 style={{ fontFamily: "Outfit, sans-serif", fontWeight: 800, fontSize: "1.1rem", color: C.text, margin: "0 0 0.5rem" }}>
              Battle Format
            </h2>
            {(
              [
                { key: "1v1" as BattleType, icon: "⚔️", label: "1 vs 1 Challenge", desc: "Go head-to-head against one opponent", color: C.blue },
                { key: "team" as BattleType, icon: "👥", label: "Open Battle", desc: "Share a code — friends join your arena", color: C.purple },
                { key: "class" as BattleType, icon: "🏫", label: "Class Battle", desc: "Open challenge for the entire class", color: C.gold },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setType(t.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.85rem",
                  padding: "0.9rem 1rem",
                  borderRadius: "12px",
                  border: `1px solid ${type === t.key ? `${t.color}55` : C.border}`,
                  background: type === t.key ? `${t.color}14` : "rgba(255,255,255,0.03)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: "1.4rem" }}>{t.icon}</span>
                <div>
                  <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, color: C.text, fontSize: "0.9rem" }}>{t.label}</div>
                  <div style={{ color: C.text3, fontSize: "0.72rem" }}>{t.desc}</div>
                </div>
              </button>
            ))}
            <button
              type="button"
              className="btn-primary"
              onClick={() => setStep(2)}
              style={{
                marginTop: "0.5rem",
                background: C.blue,
                border: "none",
                borderRadius: "10px",
                padding: "0.75rem",
                color: "#fff",
                fontFamily: "Outfit, sans-serif",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Continue →
            </button>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <h2 style={{ fontFamily: "Outfit, sans-serif", fontWeight: 800, fontSize: "1.1rem", color: C.text, margin: 0 }}>
              Configure Battle
            </h2>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "0.7rem", color: C.text3, fontWeight: 700 }}>SUBJECT</span>
              <select value={subject} onChange={(e) => { setSubject(e.target.value); setChapter("All"); }} style={inputStyle}>
                {subjectOptions.map((s) => (
                  <option key={s} value={s}>
                    {displaySubject(s)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "0.7rem", color: C.text3, fontWeight: 700 }}>CHAPTER</span>
              <select value={chapter} onChange={(e) => setChapter(e.target.value)} style={inputStyle}>
                {chapters.map((c) => (
                  <option key={c} value={c}>
                    {c === "All" ? "All" : displayChapter(c)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "0.7rem", color: C.text3, fontWeight: 700 }}>DIFFICULTY</span>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {(["easy", "medium", "hard"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficulty(d)}
                    style={{
                      flex: 1,
                      padding: "0.5rem",
                      borderRadius: "8px",
                      border: `1px solid ${difficulty === d ? C.blue : C.border}`,
                      background: difficulty === d ? `${C.blue}22` : "transparent",
                      color: difficulty === d ? C.blue : C.text2,
                      fontFamily: "Outfit, sans-serif",
                      fontWeight: 700,
                      fontSize: "0.78rem",
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "0.7rem", color: C.text3, fontWeight: 700 }}>QUESTIONS</span>
                <input
                  type="number"
                  min={5}
                  max={30}
                  value={questions}
                  onChange={(e) => setQuestions(Math.max(5, Math.min(30, Number(e.target.value) || 10)))}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "0.7rem", color: C.text3, fontWeight: 700 }}>TIME (MIN)</span>
                <input
                  type="number"
                  min={5}
                  max={60}
                  value={timeLimit}
                  onChange={(e) => setTimeLimit(Math.max(5, Math.min(60, Number(e.target.value) || 15)))}
                  style={inputStyle}
                />
              </label>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "0.7rem", color: C.text3, fontWeight: 700 }}>VISIBILITY</span>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {(["public", "private"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v)}
                    style={{
                      flex: 1,
                      padding: "0.5rem",
                      borderRadius: "8px",
                      border: `1px solid ${visibility === v ? C.purple : C.border}`,
                      background: visibility === v ? `${C.purple}22` : "transparent",
                      color: visibility === v ? C.purple : C.text2,
                      fontFamily: "Outfit, sans-serif",
                      fontWeight: 700,
                      fontSize: "0.78rem",
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </label>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  flex: 1,
                  background: "none",
                  border: `1px solid ${C.border}`,
                  borderRadius: "10px",
                  padding: "0.7rem",
                  color: C.text2,
                  fontFamily: "Outfit, sans-serif",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setStep(3)}
                style={{
                  flex: 2,
                  background: C.blue,
                  border: "none",
                  borderRadius: "10px",
                  padding: "0.7rem",
                  color: "#fff",
                  fontFamily: "Outfit, sans-serif",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <h2 style={{ fontFamily: "Outfit, sans-serif", fontWeight: 800, fontSize: "1.1rem", color: C.text, margin: 0 }}>
              Invite Challengers
            </h2>
            {type === "1v1" && (
              <>
                <input
                  value={opponentQ}
                  onChange={(e) => setOpponentQ(e.target.value)}
                  placeholder="Search classmate…"
                  style={inputStyle}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: "200px", overflowY: "auto" }}>
                  {filteredMates.length === 0 && (
                    <div style={{ color: C.text3, fontSize: "0.8rem", padding: "0.5rem" }}>
                      No classmates found — create an open battle with a code instead.
                    </div>
                  )}
                  {filteredMates.map((m) => (
                    <button
                      key={m.user_id}
                      type="button"
                      onClick={() => setOpponentUserId(m.user_id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.65rem",
                        padding: "0.55rem 0.7rem",
                        borderRadius: "10px",
                        border: `1px solid ${opponentUserId === m.user_id ? C.blue : C.border}`,
                        background: opponentUserId === m.user_id ? `${C.blue}18` : "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <Avatar initials={m.avatar} size={32} color={m.color} />
                      <span style={{ fontFamily: "Outfit, sans-serif", fontWeight: 600, fontSize: "0.85rem", color: C.text }}>
                        {m.full_name}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {realCode && (
              <div
                style={{
                  background: `${C.gold}12`,
                  border: `1px solid ${C.gold}33`,
                  borderRadius: "12px",
                  padding: "1rem",
                  textAlign: "center",
                }}
              >
                <div style={{ color: C.text3, fontSize: "0.7rem", marginBottom: "0.35rem" }}>Battle code (Player 1 — you)</div>
                <div style={{ fontFamily: "DM Mono, monospace", fontSize: "1.6rem", color: C.gold, letterSpacing: "0.15em" }}>
                  {realCode}
                </div>
                <button
                  type="button"
                  onClick={() => copyCode(realCode)}
                  style={{
                    marginTop: "0.5rem",
                    background: "none",
                    border: `1px solid ${C.border}`,
                    borderRadius: "8px",
                    padding: "4px 12px",
                    color: C.text2,
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  {copied ? "Copied!" : "Copy code"}
                </button>
                <p style={{ color: C.text3, fontSize: "0.72rem", marginTop: "0.5rem" }}>
                  Waiting for challengers — share this code, then enter the arena.
                </p>
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!!createdId}
                style={{
                  flex: 1,
                  background: "none",
                  border: `1px solid ${C.border}`,
                  borderRadius: "10px",
                  padding: "0.7rem",
                  color: C.text2,
                  fontFamily: "Outfit, sans-serif",
                  fontWeight: 700,
                  cursor: "pointer",
                  opacity: createdId ? 0.5 : 1,
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={creating}
                onClick={() => void handleStart()}
                style={{
                  flex: 2,
                  background: C.blue,
                  border: "none",
                  borderRadius: "10px",
                  padding: "0.7rem",
                  color: "#fff",
                  fontFamily: "Outfit, sans-serif",
                  fontWeight: 700,
                  cursor: creating ? "wait" : "pointer",
                  opacity: creating ? 0.7 : 1,
                }}
              >
                {createdId ? "Enter Arena ▶" : creating ? "Creating…" : "Create Battle"}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function Battleground({ setPage }: { setPage?: (p: PageKey) => void }) {
  void setPage;
  const navigate = useNavigate();
  const { user } = useAuth();
  const profile = useGurukulStudent();
  const data = useBattlegroundData();
  const [phase, setPhase] = useState<Phase>("home");
  const [busy, setBusy] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [lbEntries, setLbEntries] = useState<DesignLbEntry[]>([]);

  const displayName =
    profile?.name && profile.name !== "Student"
      ? profile.name
      : profile?.firstName && profile.firstName !== "Student"
        ? profile.firstName
        : "Student";
  const ini = initials(displayName);

  const featuredLive = useMemo(() => data.battles.filter((b) => b.featured), [data.battles]);
  const dailyLive = useMemo(
    () =>
      featuredLive.find((b) => guessFeaturedKind(b) === "daily") ||
      data.battles.find((b) => (b.title || "").toLowerCase().includes("daily")),
    [featuredLive, data.battles],
  );

  const me: MeInfo = useMemo(() => {
    const xp = data.stats.xp;
    const wins = data.stats.wins;
    const total = data.stats.totalBattles;
    const league = toLeagueName(leagueFromCodeOrXp(data.stats.leagueCode, xp));
    const engineNext =
      data.stats.nextLeagueRemaining != null && data.stats.nextLeagueLabel
        ? {
            remaining: data.stats.nextLeagueRemaining,
            nextName: data.stats.nextLeagueLabel,
            nextMin: data.stats.nextLeagueMinXp ?? xp + data.stats.nextLeagueRemaining,
          }
        : null;
    const next =
      engineNext ??
      (() => {
        const n = xpToNextLeague(xp);
        return n
          ? { remaining: n.remaining, nextName: n.next.name, nextMin: n.next.minXp }
          : null;
      })();
    const xpNext = next ? next.nextMin : xp;
    return {
      name: displayName,
      initials: ini,
      league,
      xp,
      xpNext: Math.max(xpNext, xp || 1),
      rating: data.stats.rating,
      schoolRank: data.schoolRank,
      classRank: data.classRank,
      streak: data.stats.streak,
      bestStreak: data.stats.bestStreak,
      totalBattles: total,
      wins,
      losses: data.stats.losses,
      draws: data.stats.draws,
      accuracy: data.stats.accuracy,
      motivationTitle: data.motivation.title,
      motivationMessage: data.motivation.message,
      xpRemaining: next?.remaining ?? 0,
      nextLeague: next?.nextName || "Champion",
      dailyXpLabel: dailyLive?.xpReward ? `+${dailyLive.xpReward} XP` : "Earn XP",
    };
  }, [data, displayName, ini, dailyLive]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const classRows = await loadLeaderboardEntries("class", undefined, user?.id, "overall");
        if (cancelled) return;
        setLbEntries(classRows);
      } catch (err) {
        if (!cancelled) {
          setLbEntries([]);
          toast({
            title: "Could not load leaderboard",
            description:
              err && typeof err === "object" && "message" in err
                ? String((err as { message: string }).message)
                : "Try again in a moment",
            variant: "destructive",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, data.xp?.xp]);

  const myBattles = useMemo(
    () =>
      data.battles.filter(
        (b) =>
          !!b.participantId ||
          b.status === "pending" ||
          !!b.inviteId ||
          (b.type === "1v1" && !!b.opponent),
      ),
    [data.battles],
  );

  function goBattle(id: string) {
    navigate(`/student/battleground/battle/${id}`);
  }

  function goReport(participantId: string) {
    navigate(`/student/battleground/report/${participantId}`);
  }

  async function handleJoinCode(code: string) {
    setBusy(true);
    try {
      const id = await joinBattleByCode(code);
      toast({ title: "Joined battle" });
      setShowJoin(false);
      goBattle(id);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "Could not join";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(cfg: BattleConfig & { opponentUserId?: string }) {
    setBusy(true);
    try {
      const { id, battleCode } = await createBattleFromDesign({
        type: cfg.type,
        subject: cfg.subject,
        chapter: cfg.chapter,
        difficulty: cfg.difficulty,
        questions: cfg.questions,
        timeLimitMin: cfg.timeLimitMin,
        opponentUserId: cfg.opponentUserId,
        classId: data.classId,
        isPublic: cfg.visibility !== "private",
      });
      if (cfg.type === "team") {
        toast({
          title: "Open battle with join code",
          description: "Shareable open battle created — full team matchmaking comes later.",
        });
      }
      if (battleCode) {
        navigator.clipboard.writeText(battleCode).catch(() => {});
        toast({
          title: cfg.opponentUserId ? "Challenge sent" : "Battle created",
          description: `Invite code ${battleCode} copied — share it so friends can join.`,
        });
      } else {
        toast({ title: cfg.opponentUserId ? "Challenge sent" : "Battle created" });
      }
      void data.reload();
      return { id, battleCode };
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: string }).message)
          : "Could not create battle";
      toast({ title: msg, variant: "destructive" });
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenBattle(id: string) {
    const card = data.battles.find((b) => b.id === id);
    if (card?.status === "pending" && card.inviteId) {
      setBusy(true);
      try {
        await acceptBattleInvite(card.inviteId, id);
        toast({ title: "Challenge accepted", description: "Entering the arena…" });
        void data.reload();
        goBattle(id);
      } catch (e: unknown) {
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as { message: string }).message)
            : "Could not accept";
        toast({ title: msg, variant: "destructive" });
      } finally {
        setBusy(false);
      }
      return;
    }
    goBattle(id);
  }

  async function handleFeatured(kind: FeaturedKind, battleId?: string) {
    setBusy(true);
    try {
      if (battleId && data.battles.find((b) => b.id === battleId)?.participantId) {
        goBattle(battleId);
        return;
      }
      const id = await ensureFeatured(kind);
      void data.reload();
      goBattle(id);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: string }).message)
          : "Featured battle unavailable";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const classLabel =
    profile?.class?.includes("-") || profile?.class?.includes("—")
      ? profile.class
      : [profile?.class, profile?.section].filter(Boolean).join("-") || "Your class";

  return (
    <div className="bg-design" style={{ minHeight: "100%", borderRadius: "16px", margin: "-0.25rem", overflow: "hidden" }}>
      {/* Compact arena header (Layout already provides Gurukul chrome) */}
      <div
        style={{
          borderBottom: `1px solid ${C.border}`,
          padding: "0.75rem 1.25rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(11,15,26,0.85)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "1.1rem" }}>⚔️</span>
          <span style={{ fontFamily: "Outfit, sans-serif", fontWeight: 800, fontSize: "1rem", color: C.blue }}>
            Battleground
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div
            style={{
              background: `${C.orange}18`,
              border: `1px solid ${C.orange}33`,
              borderRadius: "100px",
              padding: "4px 12px",
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span className="streak-icon" style={{ fontSize: "0.85rem" }}>
              🔥
            </span>
            <span style={{ fontFamily: "DM Mono, monospace", fontSize: "0.82rem", fontWeight: 500, color: C.orange }}>
              {me.streak} streak
            </span>
          </div>
          <div
            className="sm-hide"
            style={{
              background: `${C.purple}18`,
              border: `1px solid ${C.purple}33`,
              borderRadius: "100px",
              padding: "4px 12px",
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span style={{ fontSize: "0.82rem" }}>⚡</span>
            <span style={{ fontFamily: "DM Mono, monospace", fontSize: "0.82rem", fontWeight: 500, color: C.purple }}>
              {me.xp.toLocaleString()} XP
            </span>
          </div>
          <Avatar initials={me.initials} size={32} color={C.blue} />
        </div>
      </div>

      <div aria-hidden style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            overflow: "hidden",
            zIndex: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "8%",
              left: "6%",
              width: "320px",
              height: "320px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "40%",
              right: "4%",
              width: "260px",
              height: "260px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(139,92,246,0.05) 0%, transparent 70%)",
            }}
          />
        </div>

        <main style={{ maxWidth: "1280px", margin: "0 auto", padding: "1.25rem 1.1rem 2.5rem", position: "relative", zIndex: 1 }}>
          {phase === "create" ? (
            <CreateBattleWizard
              onBack={() => setPhase("home")}
              onCreate={handleCreate}
              onEnter={goBattle}
              classmates={data.classmates}
              creating={busy}
              classLabel={classLabel}
            />
          ) : (
            <>
              <HeroSection me={me} onPlayDaily={() => void handleFeatured("daily")} busy={busy} />
              <QuickActions
                onCreate={() => setPhase("create")}
                onJoin={() => setShowJoin(true)}
                onDaily={() => void handleFeatured("daily")}
                onWeekly={() => void handleFeatured("weekly")}
                busy={busy}
                dailyXpLabel={me.dailyXpLabel}
              />
              <FeaturedBattles liveFeatured={featuredLive} onLaunch={(k, id) => void handleFeatured(k, id)} busy={busy} />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 320px",
                  gap: "1.25rem",
                  marginBottom: "1.5rem",
                  alignItems: "start",
                }}
                className="lg-two-col"
              >
                <MyBattlesPanel
                  battles={myBattles}
                  onNew={() => setPhase("create")}
                  onOpen={(id) => void handleOpenBattle(id)}
                  onAnalysis={goReport}
                  loading={data.loading}
                />
                <LeaderboardPanel entries={lbEntries} classLabel={classLabel} />
              </div>

              <BattleHistoryPanel entries={data.history} onAnalysis={goReport} />

              <div
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", alignItems: "start" }}
                className="lg-two-col"
              >
                <AchievementsPanel me={me} />
                <StatisticsPanel me={me} />
              </div>
            </>
          )}
        </main>
      </div>

      <JoinCodeModal open={showJoin} onClose={() => setShowJoin(false)} onJoin={handleJoinCode} joining={busy} />
    </div>
  );
}
