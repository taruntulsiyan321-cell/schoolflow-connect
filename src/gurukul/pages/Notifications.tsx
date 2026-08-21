import { useNavigate } from "react-router-dom";
import {
  Bell, Award, Swords, Trophy, Wallet, NotebookPen, Sparkles,
  CheckCheck, Trash2, Loader2, MessageSquare,
} from "lucide-react";
import { GlassCard, cn } from "@/gurukul/components/shared";
import { useNotifications, type AppNotification } from "@/hooks/useNotifications";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  award: Award,
  badge: Award,
  swords: Swords,
  invite: Swords,
  trophy: Trophy,
  leaderboard: Trophy,
  fee: Wallet,
  homework: NotebookPen,
  general: Sparkles,
  message: MessageSquare,
  "message-square": MessageSquare,
  chat: MessageSquare,
};

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Student Notifications — live notifications table (not school Notices). */
export default function Notifications() {
  const { items, unread, loading, error, markRead, markAllRead, remove } = useNotifications();
  const navigate = useNavigate();

  const open = (n: AppNotification) => {
    if (!n.read) void markRead(n.id);
    if (n.link) navigate(n.link);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading notifications…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            Notifications
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {unread > 0 ? `${unread} unread` : "You're all caught up"}
          </p>
          {error && <p className="text-[10px] text-[#cc5069] mt-1">{error}</p>}
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/5 border border-black/10 text-xs font-bold text-muted-foreground hover:bg-black/10 transition-all"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <Bell className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No notifications yet. Homework, battles, and badges will show up here.
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const Icon = ICONS[n.icon ?? n.type] ?? Sparkles;
            return (
              <GlassCard
                key={n.id}
                className={cn(
                  "p-3.5 flex items-center gap-3",
                  !n.read && "border-[#3b5bdb]/30 bg-[#3b5bdb]/5",
                )}
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                    n.read ? "bg-black/5 text-muted-foreground" : "bg-[#3b5bdb]/15 text-muted-foreground",
                  )}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <button type="button" onClick={() => open(n)} className="flex-1 min-w-0 text-left">
                  <div className="font-semibold text-sm text-foreground truncate">{n.title}</div>
                  {n.body && <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>}
                  <div className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</div>
                </button>
                {!n.read && <span className="w-2 h-2 rounded-full bg-[#3b5bdb] shrink-0" />}
                <button
                  type="button"
                  onClick={() => void remove(n.id)}
                  className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-[#cc5069] hover:bg-black/5 transition-all"
                  aria-label="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}