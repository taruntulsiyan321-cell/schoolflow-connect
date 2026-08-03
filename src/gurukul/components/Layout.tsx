import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { PageKey } from "@/gurukul/nav";
import { EMPTY_STUDENT, type GurukulStudentProfile } from "@/gurukul/emptyStudent";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { MessageService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { cn, XPBar } from "./shared";
import {
  Home, BookOpen, Brain, Swords, Library,
  BarChart2, RefreshCw, RotateCcw, AlertCircle,
  Trophy, Medal, MessageCircle, ClipboardList, CalendarDays,
  ChevronLeft, ChevronRight, ChevronDown, Flame, Zap, Bell, Menu, X,
  FlaskConical, Calendar, Clock, GraduationCap, Settings, LogOut,
  User, BarChart, Wallet, Megaphone,
} from "lucide-react";

type NavItem  = { key: PageKey; label: string; icon: ReactNode };
type NavEntry =
  | { type: "link";  key: PageKey; label: string; icon: ReactNode }
  | { type: "group"; hubKey: PageKey; label: string; icon: ReactNode; color: string; items: NavItem[] };

// ── Sidebar nav — no Profile, no Resources as standalone ─────────────────────
const sidebarNav: NavEntry[] = [
  { type:"link", key:"dashboard",    label:"Home",         icon:<Home className="w-4 h-4"/> },
  { type:"link", key:"practice",     label:"Practice",     icon:<BookOpen className="w-4 h-4"/> },
  { type:"link", key:"aicoach",      label:"AI Coach",     icon:<Brain className="w-4 h-4"/> },
  { type:"link", key:"battleground", label:"Battleground", icon:<Swords className="w-4 h-4"/> },
  { type:"link", key:"chat",         label:"Chat",         icon:<MessageCircle className="w-4 h-4"/> },

  {
    type:"group", hubKey:"learninghub", label:"Learning", color:"#3b5bdb",
    icon:<GraduationCap className="w-4 h-4"/>,
    items:[
      { key:"analysis",       label:"Analysis",     icon:<BarChart2 className="w-3.5 h-3.5"/> },
      { key:"recovery",       label:"Recovery",     icon:<RefreshCw className="w-3.5 h-3.5"/> },
      { key:"revision",       label:"Revision",     icon:<RotateCcw className="w-3.5 h-3.5"/> },
      { key:"mistakebook",    label:"Mistake Book", icon:<AlertCircle className="w-3.5 h-3.5"/> },
    ],
  },

  {
    type:"group", hubKey:"classhub", label:"Class", color:"#4aa87a",
    icon:<FlaskConical className="w-4 h-4"/>,
    items:[
      { key:"timetable",   label:"Timetable",   icon:<Clock className="w-3.5 h-3.5"/> },
      { key:"calendar",    label:"Calendar",    icon:<Calendar className="w-3.5 h-3.5"/> },
      { key:"attendance",  label:"Attendance",  icon:<CalendarDays className="w-3.5 h-3.5"/> },
      { key:"assignments", label:"Homework",    icon:<ClipboardList className="w-3.5 h-3.5"/> },
      { key:"tests",       label:"Tests",       icon:<FlaskConical className="w-3.5 h-3.5"/> },
      { key:"doubtportal", label:"Doubts",      icon:<MessageCircle className="w-3.5 h-3.5"/> },
      { key:"leaderboard", label:"Rankings",    icon:<Trophy className="w-3.5 h-3.5"/> },
      { key:"achievements",label:"Achievements",icon:<Medal className="w-3.5 h-3.5"/> },
      { key:"resources",   label:"Resources",   icon:<Library className="w-3.5 h-3.5"/> },
    ],
  },
];

// ── Mobile bottom nav — 4 tabs, no Profile ────────────────────────────────────
const bottomNav: NavItem[] = [
  { key:"dashboard",   label:"Home",     icon:<Home className="w-5 h-5"/> },
  { key:"practice",    label:"Practice", icon:<BookOpen className="w-5 h-5"/> },
  { key:"chat",        label:"Chat",     icon:<MessageCircle className="w-5 h-5"/> },
  { key:"learninghub", label:"Learning", icon:<GraduationCap className="w-5 h-5"/> },
  { key:"classhub",    label:"Class",    icon:<FlaskConical className="w-5 h-5"/> },
];

const LEARNING_KEYS: PageKey[] = ["learninghub","analysis","recovery","revision","mistakebook"];
const CLASS_KEYS:    PageKey[] = ["classhub","timetable","calendar","attendance","assignments","tests","doubtportal","leaderboard","achievements","resources"];

const pageTitle: Record<PageKey, string> = {
  dashboard:"Home",         practice:"Practice",       aicoach:"AI Coach",
  analysis:"Analysis",      recovery:"Recovery",       revision:"Revision",
  mistakebook:"Mistake Book",
  battleground:"Battleground", chat:"Chat",            leaderboard:"Rankings",
  achievements:"Achievements", resources:"Resources",
  doubtportal:"Doubts",     assignments:"Homework",    attendance:"Attendance",
  profile:"Profile",        timetable:"Timetable",     calendar:"Calendar",
  tests:"Tests",            learninghub:"Learning",    classhub:"Class",
};

// ── Profile dropdown menu items ───────────────────────────────────────────────
const profileMenuItems = [
  { label:"My Profile",    icon:<User className="w-3.5 h-3.5"/>,     key:"profile"      as PageKey },
  { label:"Achievements",  icon:<Medal className="w-3.5 h-3.5"/>,    key:"achievements" as PageKey },
  { label:"Leaderboard",   icon:<Trophy className="w-3.5 h-3.5"/>,   key:"leaderboard"  as PageKey },
  { label:"Analysis",      icon:<BarChart className="w-3.5 h-3.5"/>, key:"analysis"     as PageKey },
];

const profileExtraLinks = [
  { label: "Notifications", path: "/student/notifications", icon: <Bell className="w-3.5 h-3.5" /> },
  { label: "Notices", path: "/student/notices", icon: <Megaphone className="w-3.5 h-3.5" /> },
  { label: "Fees", path: "/student/fees", icon: <Wallet className="w-3.5 h-3.5" /> },
];

export type { GurukulStudentProfile };

export default function Layout({
  page,
  setPage,
  children,
  onOpenAdmin,
  profile,
  progressionReady = true,
}: {
  page: PageKey;
  setPage: (p: PageKey) => void;
  children: ReactNode;
  onOpenAdmin?: () => void;
  profile?: Partial<GurukulStudentProfile>;
  /** When false, XP/level chrome shows a neutral placeholder (not Level 1 as truth). */
  progressionReady?: boolean;
}) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { unread } = useNotifications();
  const { ctx, ready } = useAcademicContext();
  const messageLive = useAcademicLive("message");
  const [unreadMsg, setUnreadMsg] = useState(0);
  const student = { ...EMPTY_STUDENT, ...profile };
  const showXpChrome = progressionReady;

  useEffect(() => {
    if (!ready || !ctx) {
      setUnreadMsg(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const n = await MessageService.countUnread(ctx);
        if (!cancelled) setUnreadMsg(n);
      } catch {
        if (!cancelled) setUnreadMsg(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, messageLive]);

  const headerTitle =
    location.pathname.startsWith("/student/notifications") ? "Notifications"
    : location.pathname.startsWith("/student/notices") ? "Notices"
    : location.pathname.startsWith("/student/fees") ? "Fees"
    : location.pathname.startsWith("/student/chat") ? "Chat"
    : pageTitle[page];
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    learninghub: LEARNING_KEYS.includes(page),
    classhub: CLASS_KEYS.includes(page),
  });

  // Keep hub groups expanded when deep-linking into a child page.
  useEffect(() => {
    setOpenGroups((g) => ({
      ...g,
      ...(LEARNING_KEYS.includes(page) ? { learninghub: true } : {}),
      ...(CLASS_KEYS.includes(page) ? { classhub: true } : {}),
    }));
  }, [page]);

  // Close profile dropdown on outside click (menu is portaled to body)
  useEffect(() => {
    if (!profileOpen) return;
    function handle(e: MouseEvent) {
      const t = e.target as Node;
      if (profileRef.current?.contains(t) || profileMenuRef.current?.contains(t)) return;
      setProfileOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setProfileOpen(false);
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleKey);
    };
  }, [profileOpen]);

  function toggleGroup(key: string) {
    setOpenGroups(g => ({ ...g, [key]: !g[key] }));
  }

  function isBottomActive(key: PageKey) {
    if (key === "learninghub") return LEARNING_KEYS.includes(page);
    if (key === "classhub")    return CLASS_KEYS.includes(page);
    return page === key;
  }

  // ── Sub-item ────────────────────────────────────────────────────────────────
  const SubLink = ({ item, color }: { item: NavItem; color: string }) => {
    const active = page === item.key;
    return (
      <button
        onClick={() => { setPage(item.key); setMobileOpen(false); }}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium transition-all duration-150 border border-transparent",
          !active && "text-[#78788c] hover:text-white hover:bg-white/5"
        )}
        style={active ? { background:`${color}18`, borderColor:`${color}30`, color } : undefined}
        title={collapsed ? item.label : undefined}>
        <span className="shrink-0" style={active ? {color} : undefined}>{item.icon}</span>
        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        {active && !collapsed && <span className="w-1.5 h-1.5 rounded-full ml-auto shrink-0" style={{background:color}}/>}
      </button>
    );
  };

  // ── Top-level link ──────────────────────────────────────────────────────────
  const TopLink = ({ entry }: { entry: Extract<NavEntry, {type:"link"}> }) => {
    const active = page === entry.key;
    const showChatBadge = entry.key === "chat" && unreadMsg > 0;
    return (
      <button
        onClick={() => { setPage(entry.key); setMobileOpen(false); }}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all duration-150",
          active ? "bg-[#3b5bdb] text-white shadow-lg shadow-[#3b5bdb]/15" : "text-[#78788c] hover:text-white hover:bg-white/5",
          collapsed && "justify-center px-2"
        )}
        title={collapsed ? entry.label : undefined}>
        <span className="shrink-0 relative">
          {entry.icon}
          {showChatBadge && collapsed && (
            <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-[#f43f5e] text-white text-[8px] font-black flex items-center justify-center">
              {unreadMsg > 9 ? "9+" : unreadMsg}
            </span>
          )}
        </span>
        {!collapsed && <span className="truncate flex-1">{entry.label}</span>}
        {showChatBadge && !collapsed && (
          <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#f43f5e] text-white text-[8px] font-black flex items-center justify-center shrink-0">
            {unreadMsg > 9 ? "9+" : unreadMsg}
          </span>
        )}
      </button>
    );
  };

  // ── Group entry ─────────────────────────────────────────────────────────────
  const GroupEntry = ({ entry }: { entry: Extract<NavEntry, {type:"group"}> }) => {
    const isOpen      = !!openGroups[entry.hubKey];
    const isActive    = entry.items.some(i => i.key === page) || page === entry.hubKey;
    const isHubActive = page === entry.hubKey;

    return (
      <div>
        <div className={cn(
          "flex items-center rounded-xl transition-all duration-150",
          isHubActive && "bg-[#3b5bdb] shadow-lg shadow-[#3b5bdb]/15",
          collapsed && "justify-center"
        )}>
          <button
            onClick={() => { setPage(entry.hubKey); setMobileOpen(false); }}
            className={cn(
              "flex-1 flex items-center gap-3 px-3 py-2.5 text-left text-sm font-medium transition-all",
              isHubActive ? "text-white" : isActive ? "text-white" : "text-[#78788c] hover:text-white",
              collapsed && "justify-center"
            )}
            style={isActive && !isHubActive ? { color: entry.color } : undefined}
            title={collapsed ? entry.label : undefined}>
            <span className="shrink-0" style={isActive && !isHubActive ? {color:entry.color} : undefined}>
              {entry.icon}
            </span>
            {!collapsed && <span className="truncate">{entry.label}</span>}
          </button>
          {!collapsed && (
            <button
              onClick={() => toggleGroup(entry.hubKey)}
              className={cn("px-2 py-2.5 shrink-0 transition-colors",
                isHubActive ? "text-white/70 hover:text-white" : "text-[#78788c] hover:text-white"
              )}>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isOpen && "rotate-180")}/>
            </button>
          )}
        </div>

        {!collapsed && isOpen && (
          <div className="ml-3 pl-3 border-l mt-0.5 mb-1 space-y-0.5" style={{borderColor:`${entry.color}25`}}>
            {entry.items.map(item => <SubLink key={item.key} item={item} color={entry.color}/>)}
          </div>
        )}
        {collapsed && isOpen && (
          <div className="space-y-0.5 mt-0.5">
            {entry.items.map(item => <SubLink key={item.key} item={item} color={entry.color}/>)}
          </div>
        )}
      </div>
    );
  };

  // ── Sidebar shell ───────────────────────────────────────────────────────────
  const SidebarContent = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Logo */}
      <div className={cn("flex items-center gap-3 px-4 py-4 border-b border-white/5 shrink-0", collapsed && "justify-center px-2")}>
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
          <Brain className="w-4 h-4 text-white"/>
        </div>
        {!collapsed && (
          <div>
            <div className="text-sm font-black text-white leading-none" style={{fontFamily:"var(--font-display)"}}>Wisdom</div>
            <div className="text-[10px] text-[#78788c] leading-none mt-0.5">Campus</div>
          </div>
        )}
      </div>

      {/* XP card */}
      {!collapsed && (
        <div className="px-3 py-3 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white shrink-0"
              style={{background:"linear-gradient(135deg,#3b5bdb,#6882e8)"}}>
              {student.avatar}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{student.name}</div>
              <div className="text-[10px] text-[#78788c]">{student.class}</div>
            </div>
          </div>
          {showXpChrome ? (
            <XPBar
              xp={student.xp}
              level={student.level}
              xpIntoLevel={student.xpIntoLevel}
              xpToNext={student.xpToNext}
              progressPct={student.levelProgressPct}
            />
          ) : (
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-white/10 animate-pulse" />
            </div>
          )}
        </div>
      )}

      {/* Nav items */}
      <nav className="px-2 py-3 space-y-0.5 overflow-y-auto flex-1 min-h-0 scrollbar-none">
        {sidebarNav.map(entry =>
          entry.type === "link"
            ? <TopLink key={entry.key} entry={entry}/>
            : <GroupEntry key={entry.hubKey} entry={entry}/>
        )}
      </nav>

      {/* Collapse */}
      <div className="px-2 py-3 border-t border-white/5 shrink-0">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[#78788c] hover:text-white hover:bg-white/5 transition-all text-xs">
          {collapsed ? <ChevronRight className="w-4 h-4"/> : <><ChevronLeft className="w-4 h-4"/><span>Collapse</span></>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden"
      style={{background:"radial-gradient(ellipse 80% 50% at 50% -5%,rgba(99,102,241,0.05) 0%,transparent 55%),#0d0d0f"}}>

      {/* Desktop sidebar */}
      <aside className={cn(
        "hidden md:flex flex-col border-r border-white/5 bg-[#0d0d0f]/80 backdrop-blur-xl transition-all duration-300 shrink-0",
        collapsed ? "w-16" : "w-56"
      )}>
        <SidebarContent/>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-modal md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)}/>
          <aside className="absolute left-0 top-0 h-full w-64 bg-[#0d0d0f] border-r border-white/5 flex flex-col">
            <div className="flex justify-end p-3 shrink-0">
              <button onClick={() => setMobileOpen(false)} className="text-[#78788c] hover:text-white">
                <X className="w-5 h-5"/>
              </button>
            </div>
            <div className="flex-1 overflow-hidden"><SidebarContent/></div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top header — z-40 so backdrop-blur stacking context sits above <main> */}
        <header className="relative z-40 shrink-0 border-b border-white/5 bg-[#0d0d0f]/80 backdrop-blur-xl">
          <div className="h-14 px-4 sm:px-6 flex items-center gap-3">
            {/* Mobile hamburger */}
            <button className="md:hidden text-[#78788c] hover:text-white" onClick={() => setMobileOpen(true)}>
              <Menu className="w-5 h-5"/>
            </button>

            {/* Page title */}
            <h1 className="text-sm font-bold text-white flex-1 tracking-tight" style={{fontFamily:"var(--font-display)"}}>
              {headerTitle}
            </h1>

            {/* Right badges */}
            <div className="flex items-center gap-2">
              {/* Streak */}
              <div className="hidden sm:flex items-center gap-1.5 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-1">
                <Flame className="w-3 h-3 text-amber-400"/>
                <span className="text-xs font-bold text-amber-400">
                  {showXpChrome ? `${student.streak}d` : "—"}
                </span>
              </div>
              {/* XP */}
              <div className="hidden sm:flex items-center gap-1.5 bg-[#3b5bdb]/10 border border-[#3b5bdb]/20 rounded-full px-2.5 py-1">
                <Zap className="w-3 h-3 text-blue-400"/>
                <span className="text-xs font-bold text-blue-400">
                  {showXpChrome ? student.xp.toLocaleString() : "—"}
                </span>
              </div>
              {/* Bell -> Notifications (live inbox) */}
              <button
                onClick={() => navigate("/student/notifications")}
                className="relative w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-colors"
                title="Notifications"
              >
                <Bell className="w-4 h-4"/>
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#cc5069] text-white text-[9px] font-bold flex items-center justify-center">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>

              {/* Admin Panel shortcut */}
              {onOpenAdmin && (
                <button
                  onClick={onOpenAdmin}
                  className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold text-[#78788c] hover:text-[#a5b4fc] border border-white/10 hover:border-[#3b5bdb]/40 hover:bg-[#3b5bdb]/8 rounded-full px-2.5 py-1 transition-all"
                  title="Switch to Admin Panel"
                >
                  <Settings className="w-3 h-3" />
                  Admin
                </button>
              )}

              {/* Profile avatar — opens dropdown (portaled to body) */}
              <div className="relative" ref={profileRef}>
                <button
                  onClick={() => setProfileOpen(o => !o)}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white transition-all ring-2 ring-offset-2 ring-offset-[#0d0d0f]",
                    profileOpen ? "ring-[#3b5bdb]" : "ring-transparent hover:ring-white/20",
                    page === "profile" && "ring-[#3b5bdb]"
                  )}
                  style={{background:"linear-gradient(135deg,#3b5bdb,#6882e8)"}}
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                >
                  {student.avatar}
                </button>

                {profileOpen && createPortal(
                  <div
                    ref={profileMenuRef}
                    role="menu"
                    className="fixed right-4 top-14 mt-0 w-64 z-overlay rounded-2xl border border-white/10 bg-[#131316]/95 backdrop-blur-xl shadow-2xl shadow-black/50 overflow-hidden"
                  >
                    {/* User info */}
                    <div className="px-4 py-4 border-b border-white/5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black text-white shrink-0"
                          style={{background:"linear-gradient(135deg,#3b5bdb,#6882e8)"}}>
                          {student.avatar}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-white truncate">{student.name}</div>
                          <div className="text-[11px] text-[#78788c]">
                            {[student.class, student.rank > 0 ? `Rank #${student.rank}` : null].filter(Boolean).join(" · ") || "Your class"}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3">
                        {showXpChrome ? (
                          <XPBar
                            xp={student.xp}
                            level={student.level}
                            xpIntoLevel={student.xpIntoLevel}
                            xpToNext={student.xpToNext}
                            progressPct={student.levelProgressPct}
                          />
                        ) : (
                          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full w-1/3 rounded-full bg-white/10 animate-pulse" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quick links */}
                    <div className="px-2 py-2">
                      {profileMenuItems.map(item => (
                        <button key={item.key} onClick={() => { setPage(item.key); setProfileOpen(false); }}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all",
                            page === item.key ? "bg-[#3b5bdb]/15 text-[#3b5bdb]" : "text-[#a0a0b0] hover:text-white hover:bg-white/5"
                          )}>
                          <span className={page === item.key ? "text-[#3b5bdb]" : "text-[#78788c]"}>{item.icon}</span>
                          {item.label}
                          {page === item.key && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#3b5bdb]"/>}
                        </button>
                      ))}
                      {profileExtraLinks.map(item => (
                        <button
                          key={item.path}
                          onClick={() => { navigate(item.path); setProfileOpen(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-[#a0a0b0] hover:text-white hover:bg-white/5 transition-all"
                        >
                          <span className="text-[#78788c]">{item.icon}</span>
                          {item.label}
                        </button>
                      ))}
                    </div>

                    {/* Footer */}
                    <div className="px-2 py-2 border-t border-white/5">
                      <button
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-[#78788c] hover:text-rose-400 hover:bg-rose-400/5 transition-all"
                      >
                        <LogOut className="w-3.5 h-3.5"/>
                        Sign out
                      </button>
                    </div>
                  </div>,
                  document.body,
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-[#0d0d0f]">
          <div className="p-4 sm:p-6 max-w-5xl mx-auto pb-24 md:pb-6">{children}</div>
        </main>

        {/* Mobile bottom nav — 4 tabs */}
        <nav className="md:hidden shrink-0 fixed bottom-0 inset-x-0 border-t border-white/7 bg-[#0d0d0f]/95 backdrop-blur-xl z-40">
          <div className="flex">
            {bottomNav.map(item => {
              const active = isBottomActive(item.key);
              const showChatBadge = item.key === "chat" && unreadMsg > 0;
              return (
                <button key={item.key} onClick={() => setPage(item.key)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-semibold transition-all relative",
                    active ? "text-[#3b5bdb]" : "text-[#78788c]"
                  )}>
                  <span className={cn("relative transition-transform duration-150", active && "scale-110")}>
                    {item.icon}
                    {showChatBadge && (
                      <span className="absolute -top-1.5 -right-2.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-[#f43f5e] text-white text-[8px] font-black flex items-center justify-center">
                        {unreadMsg > 9 ? "9+" : unreadMsg}
                      </span>
                    )}
                  </span>
                  {item.label}
                </button>
              );
            })}
            {/* Profile avatar button in bottom nav */}
            <button
              onClick={() => setPage("profile")}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-semibold transition-all",
                page === "profile" ? "text-[#3b5bdb]" : "text-[#78788c]"
              )}>
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white transition-transform",
                page === "profile" ? "scale-110 ring-2 ring-[#3b5bdb] ring-offset-1 ring-offset-[#0d0d0f]" : ""
              )}
                style={{background:"linear-gradient(135deg,#3b5bdb,#6882e8)"}}>
                {student.avatar}
              </div>
              Profile
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
