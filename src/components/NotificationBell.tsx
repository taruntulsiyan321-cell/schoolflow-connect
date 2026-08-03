import { useNavigate } from "react-router-dom";
import { Bell, Award, Swords, Trophy, Wallet, NotebookPen, CheckCheck, Sparkles, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useNotifications, type AppNotification } from "@/hooks/useNotifications";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  award: Award, badge: Award, swords: Swords, invite: Swords,
  trophy: Trophy, leaderboard: Trophy, fee: Wallet, homework: NotebookPen, general: Sparkles,
  message: MessageSquare, "message-square": MessageSquare, chat: MessageSquare,
};

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell({ className }: { className?: string }) {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();

  const open = (n: AppNotification) => {
    if (!n.read) markRead(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("relative h-9 w-9", className)} aria-label="Notifications">
          <Bell className="w-[18px] h-[18px]" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center animate-pop">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold text-sm">Notifications</div>
          {unread > 0 && (
            <button onClick={markAllRead} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
          )}
        </div>
        <ScrollArea className="max-h-96">
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
              You're all caught up.
            </div>
          ) : (
            <div className="divide-y">
              {items.slice(0, 20).map((n) => {
                const Icon = ICONS[n.icon ?? n.type] ?? Sparkles;
                return (
                  <button
                    key={n.id}
                    onClick={() => open(n)}
                    className={cn("w-full text-left px-4 py-3 flex gap-3 hover:bg-muted/50 transition-colors", !n.read && "bg-primary/5")}
                  >
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                      n.read ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary")}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{n.title}</div>
                      {n.body && <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>}
                      <div className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</div>
                    </div>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
