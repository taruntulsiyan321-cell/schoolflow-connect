import { useNavigate } from "react-router-dom";
import {
  Bell, Award, Swords, Trophy, Wallet, NotebookPen,
  CheckCheck, Trash2, MessageSquare, AlertTriangle, BookOpen,
  CalendarDays, CalendarCheck, CheckCircle2, ClipboardCheck, Inbox, Megaphone,
} from "lucide-react";
import { EmptyState, GlassCard, PageHeader, PageSkeleton, SkeletonList, cn } from "@/gurukul/components/shared";
import { useNotifications, type AppNotification } from "@/hooks/useNotifications";

/**
 * THIS MAP WAS KEYED ON NAMES NOTHING WRITES.
 *
 * Measured against the live table, 2026-09-12: of 2,866 notifications, the old
 * map matched 35. Everything else — all 1,222 homework, 462 results, 435 exams,
 * 327 announcements, 318 attendance rows — fell through to the generic sparkle,
 * so the icon column was decoration that decorated nothing and every row in the
 * list looked identical.
 *
 * The cause is that it mixed two vocabularies in one object. `notifications.icon`
 * stores LUCIDE names in kebab-case ("book-open", "clipboard-check",
 * "calendar-check"); `notifications.type` stores DOMAIN names ("homework",
 * "result", "announcement"). The lookup was `ICONS[n.icon ?? n.type]`, so the
 * icon column was tried first against a map that mostly held domain keys —
 * "award" and "swords" happened to be in both vocabularies, which is precisely
 * the 35 that worked.
 *
 * Two maps now, tried in that order, each keyed on what its column actually
 * contains. The values below are the distinct values in the live table plus the
 * ones the notification writers can emit.
 */
const ICON_BY_STORED_NAME: Record<string, React.ComponentType<{ className?: string }>> = {
  "alert-triangle": AlertTriangle,
  award: Award,
  bell: Bell,
  book: BookOpen,
  "book-open": BookOpen,
  calendar: CalendarDays,
  "calendar-check": CalendarCheck,
  "check-circle": CheckCircle2,
  "clipboard-check": ClipboardCheck,
  inbox: Inbox,
  megaphone: Megaphone,
  "message-square": MessageSquare,
  swords: Swords,
  trophy: Trophy,
  wallet: Wallet,
};

const ICON_BY_TYPE: Record<string, React.ComponentType<{ className?: string }>> = {
  announcement: Megaphone,
  attendance: CalendarCheck,
  badge: Award,
  chat: MessageSquare,
  exam: CalendarDays,
  fee: Wallet,
  general: Bell,
  homework: NotebookPen,
  inquiry: Inbox,
  invite: Swords,
  leaderboard: Trophy,
  leave: CalendarDays,
  message: MessageSquare,
  notice: Megaphone,
  result: ClipboardCheck,
  trophy: Trophy,
};

/**
 * Types are dotted for sub-events ("homework.risk_alert", "attendance.risk_alert"),
 * and an exact-match lookup can never resolve one. A risk alert keeps its own
 * warning icon; anything else dotted falls back to its domain prefix.
 */
function iconFor(icon: string | null | undefined, type: string) {
  const stored = icon ? ICON_BY_STORED_NAME[icon] : undefined;
  if (stored) return stored;
  if (type.endsWith(".risk_alert")) return AlertTriangle;
  return ICON_BY_TYPE[type] ?? ICON_BY_TYPE[type.split(".")[0]] ?? Bell;
}

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

  // The title needs no network, so it no longer waits for one. "You're all
  // caught up" is not claimed while loading — that would be a statement about
  // data nobody has yet.
  const header = (
    <PageHeader
      title="Notifications"
      subtitle={loading ? undefined : unread > 0 ? `${unread} unread` : "You're all caught up"}
      action={
        !loading && unread > 0 ? (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/5 border border-black/10 text-xs font-bold text-muted-foreground hover:bg-black/10 transition-all"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </button>
        ) : undefined
      }
    />
  );

  if (loading) {
    return (
      <div className="space-y-5">
        {header}
        <PageSkeleton label="Loading notifications">
          <SkeletonList rows={5} />
        </PageSkeleton>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      {error && <p className="text-[10px] text-destructive -mt-2">{error}</p>}

      {items.length === 0 ? (
        <GlassCard className="p-4">
          <EmptyState
            icon={<Bell className="w-6 h-6" />}
            title="No notifications yet"
            sub="Homework, battles, and badges will show up here."
          />
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const Icon = iconFor(n.icon, n.type);
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