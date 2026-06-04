import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-bits";
import { Bell, Award, Swords, Trophy, Wallet, NotebookPen, Sparkles, CheckCheck, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotifications, type AppNotification } from "@/hooks/useNotifications";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  award: Award, badge: Award, swords: Swords, invite: Swords,
  trophy: Trophy, leaderboard: Trophy, fee: Wallet, homework: NotebookPen, general: Sparkles,
};

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationsPage() {
  const { items, unread, loading, markRead, markAllRead, remove } = useNotifications();
  const navigate = useNavigate();

  const open = (n: AppNotification) => {
    if (!n.read) markRead(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : "You're all caught up"}
        action={unread > 0 ? (
          <Button variant="outline" size="sm" onClick={markAllRead}><CheckCheck className="w-4 h-4 mr-1.5" /> Mark all read</Button>
        ) : undefined}
      />

      {loading ? (
        <p className="text-center py-10 text-muted-foreground text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
          No notifications yet. Win battles and unlock badges to see activity here!
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const Icon = ICONS[n.icon ?? n.type] ?? Sparkles;
            return (
              <Card key={n.id} className={cn("p-3.5 flex items-center gap-3 transition-all hover:shadow-card", !n.read && "bg-primary/5 border-primary/20")}>
                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                  n.read ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary")}>
                  <Icon className="w-5 h-5" />
                </div>
                <button onClick={() => open(n)} className="flex-1 min-w-0 text-left">
                  <div className="font-semibold text-sm truncate">{n.title}</div>
                  {n.body && <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>}
                  <div className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</div>
                </button>
                {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => remove(n.id)} aria-label="Delete">
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
