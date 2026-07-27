import { useState } from "react";
import {
  Bell, UserCheck, BookOpen, ClipboardList, Megaphone, MessageSquare,
  Calendar, Check, CheckCheck, Trash2, Filter,
} from "lucide-react";
import { cn } from "./shared";
import { parentNotifications, type Notification } from "./data";

const typeConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  attendance: { icon: <UserCheck className="w-3.5 h-3.5" />, color: "#3b5bdb", label: "Attendance" },
  homework: { icon: <BookOpen className="w-3.5 h-3.5" />, color: "#c08a3a", label: "Homework" },
  test: { icon: <ClipboardList className="w-3.5 h-3.5" />, color: "#6366f1", label: "Test" },
  exam: { icon: <Calendar className="w-3.5 h-3.5" />, color: "#8f7dd6", label: "Examination" },
  announcement: { icon: <Megaphone className="w-3.5 h-3.5" />, color: "#4b9fd4", label: "Announcement" },
  message: { icon: <MessageSquare className="w-3.5 h-3.5" />, color: "#3b5bdb", label: "Message" },
  leave: { icon: <Calendar className="w-3.5 h-3.5" />, color: "#cc5069", label: "Leave" },
};

export default function ParentNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>(parentNotifications);
  const [filterType, setFilterType] = useState("all");
  const [filterChild, setFilterChild] = useState("all");

  const unreadCount = notifications.filter((n) => !n.read).length;
  const children = Array.from(new Set(notifications.map((n) => n.childName)));
  const types = Array.from(new Set(notifications.map((n) => n.type)));

  const filtered = notifications.filter((n) => {
    if (filterType !== "all" && n.type !== filterType) return false;
    if (filterChild !== "all" && n.childName !== filterChild) return false;
    return true;
  });

  function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
  }

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  function deleteNotification(id: string) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-bold text-white">Notifications</div>
          <div className="text-[10px] text-[#78788c] mt-0.5">{unreadCount} unread of {notifications.length} total</div>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#3b5bdb] bg-[#3b5bdb]/10 hover:bg-[#3b5bdb]/15 transition-all">
            <CheckCheck className="w-3.5 h-3.5" /> Mark All Read
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
          <option value="all">All Types</option>
          {types.map((t) => <option key={t} value={t}>{typeConfig[t]?.label ?? t}</option>)}
        </select>
        <select value={filterChild} onChange={(e) => setFilterChild(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none">
          <option value="all">All Children</option>
          {children.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Notification list */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-10 text-xs text-[#78788c]">No notifications</div>
        )}
        {filtered.map((n) => {
          const cfg = typeConfig[n.type] ?? { icon: <Bell className="w-3.5 h-3.5" />, color: "#78788c", label: n.type };
          return (
            <div key={n.id}
              className={cn("flex items-start gap-3 p-4 rounded-2xl border transition-all group",
                n.read ? "bg-[#131316] border-white/7" : "bg-[#3b5bdb]/5 border-[#3b5bdb]/20")}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${cfg.color}18`, color: cfg.color }}>
                {cfg.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ background: `${cfg.color}18`, color: cfg.color }}>{cfg.label}</span>
                      <span className="text-[9px] text-[#46465a] font-semibold">{n.childName}</span>
                      {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-[#3b5bdb]" />}
                    </div>
                    <div className="text-xs font-semibold text-white mt-1">{n.title}</div>
                    <div className="text-[10px] text-[#78788c] mt-0.5">{n.body}</div>
                    <div className="text-[9px] text-[#46465a] mt-1">{n.timestamp}</div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {!n.read && (
                      <button onClick={() => markRead(n.id)} title="Mark as read"
                        className="w-6 h-6 rounded-lg bg-[#3b5bdb]/15 text-[#3b5bdb] flex items-center justify-center hover:bg-[#3b5bdb]/25 transition-all">
                        <Check className="w-3 h-3" />
                      </button>
                    )}
                    <button onClick={() => deleteNotification(n.id)} title="Delete"
                      className="w-6 h-6 rounded-lg bg-[#cc5069]/15 text-[#cc5069] flex items-center justify-center hover:bg-[#cc5069]/25 transition-all">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
