import { useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { PageKey } from "@/gurukul/data/mock";
import { student as mockStudent } from "@/gurukul/data/mock";
import { useAuth } from "@/hooks/useAuth";
import { cn, XPBar } from "./shared";
import {
  Home, BookOpen, Brain, Swords, Library,
  BarChart2, RefreshCw, RotateCcw, AlertCircle,
  Trophy, Medal, MessageCircle, ClipboardList, CalendarDays,
  ChevronLeft, ChevronRight, ChevronDown, Flame, Zap, Bell, Menu, X,
  FlaskConical, Calendar, Clock, GraduationCap, Settings, LogOut,
  User, BarChart, HelpCircle,
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

  {
    type:"group", hubKey:"learninghub", label:"Learning", color:"#6366f1",
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
  { key:"learninghub", label:"Learning", icon:<GraduationCap className="w-5 h-5"/> },
  { key:"classhub",    label:"Class",    icon:<FlaskConical className="w-5 h-5"/> },
];

const LEARNING_KEYS: PageKey[] = ["learninghub","analysis","recovery","revision","mistakebook"];
const CLASS_KEYS:    PageKey[] = ["classhub","timetable","calendar","attendance","assignments","tests","doubtportal","leaderboard","achievements","resources"];

const pageTitle: Record<PageKey, string> = {
  dashboard:"Home",         practice:"Practice",       aicoach:"AI Coach",
  analysis:"Analysis",      recovery:"Recovery",       revision:"Revision",
  mistakebook:"Mistake Book",
  battleground:"Battleground", leaderboard:"Rankings",
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

export type GurukulStudentProfile = Partial<typeof mockStudent>;

export default function Layout({
  page,
  setPage,
  children,
  onOpenAdmin,
  profile,
}: {
  page: PageKey;
  setPage: (p: PageKey) => void;
  children: ReactNode;
  onOpenAdmin?: () => void;
  profile?: GurukulStudentProfile;
}) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const student = { ...mockStudent, ...profile };
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const defaultOpen = {
    learninghub: LEARNING_KEYS.includes(page),
    classhub: CLASS_KEYS.includes(page),
  };
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(defaultOpen);

  // Close profile dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

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
    return (
      <button
        onClick={() => { setPage(entry.key); setMobileOpen(false); }}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all duration-150",
          active ? "bg-[#6366f1] text-white shadow-lg shadow-[#6366f1]/15" : "text-[#78788c] hover:text-white hover:bg-white/5",
          collapsed && "justify-center px-2"
        )}
        title={collapsed ? entry.label : undefined}>
        <span className="shrink-0">{entry.icon}</span>
        {!collapsed && <span className="truncate">{entry.label}</span>}
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
          isHubActive && "bg-[#6366f1] shadow-lg shadow-[#6366f1]/15",
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
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6366f1] to-[#8f7dd6] flex items-center justify-center shrink-0">
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
              style={{background:"linear-gradient(135deg,#6366f1,#8f7dd6)"}}>
              {student.avatar}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{student.name}</div>
              <div className="text-[10px] text-[#78788c]">{student.class}</div>
            </div>
          </div>
          <XPBar xp={student.xp} level={student.level}/>
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
        <div className="fixed inset-0 z-50 md:hidden">
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

        {/* Top header */}
        <header className="shrink-0 border-b border-white/5 bg-[#0d0d0f]/80 backdrop-blur-xl">
          <div className="h-14 px-4 sm:px-6 flex items-center gap-3">
            {/* Mobile hamburger */}
            <button className="md:hidden text-[#78788c] hover:text-white" onClick={() => setMobileOpen(true)}>
              <Menu className="w-5 h-5"/>
            </button>

            {/* Page title */}
            <h1 className="text-sm font-bold text-white flex-1 tracking-tight" style={{fontFamily:"var(--font-display)"}}>
              {pageTitle[page]}
            </h1>

            {/* Right badges */}
            <div className="flex items-center gap-2">
              {/* Streak */}
              <div className="hidden sm:flex items-center gap-1.5 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-1">
                <Flame className="w-3 h-3 text-amber-400"/>
                <span className="text-xs font-bold text-amber-400">{student.streak}d</span>
              </div>
              {/* XP */}
              <div className="hidden sm:flex items-center gap-1.5 bg-[#6366f1]/10 border border-[#6366f1]/20 rounded-full px-2.5 py-1">
                <Zap className="w-3 h-3 text-blue-400"/>
                <span className="text-xs font-bold text-blue-400">{student.xp.toLocaleString()}</span>
              </div>
              {/* Bell */}
              <button className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-colors">
                <Bell className="w-4 h-4"/>
              </button>

              {/* Admin Panel shortcut */}
              {onOpenAdmin && (
                <button
                  onClick={onOpenAdmin}
                  className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold text-[#78788c] hover:text-[#a5b4fc] border border-white/10 hover:border-[#6366f1]/40 hover:bg-[#6366f1]/8 rounded-full px-2.5 py-1 transition-all"
                  title="Switch to Admin Panel"
                >
                  <Settings className="w-3 h-3" />
                  Admin
                </button>
              )}

              {/* Profile avatar — opens dropdown */}
              <div className="relative" ref={profileRef}>
                <button
                  onClick={() => setProfileOpen(o => !o)}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white transition-all ring-2 ring-offset-2 ring-offset-[#0d0d0f]",
                    profileOpen ? "ring-[#6366f1]" : "ring-transparent hover:ring-white/20",
                    page === "profile" && "ring-[#6366f1]"
                  )}
                  style={{background:"linear-gradient(135deg,#6366f1,#8f7dd6)"}}>
                  {student.avatar}
                </button>

                {/* Dropdown */}
                {profileOpen && (
                  <div className="fixed right-4 top-14 mt-0 w-64 z-[100] rounded-2xl border border-white/10 bg-[#131316]/95 backdrop-blur-xl shadow-2xl shadow-black/50 overflow-hidden">
                    {/* User info */}
                    <div className="px-4 py-4 border-b border-white/5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black text-white shrink-0"
                          style={{background:"linear-gradient(135deg,#6366f1,#8f7dd6)"}}>
                          {student.avatar}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-white truncate">{student.name}</div>
                          <div className="text-[11px] text-[#78788c]">{student.class} · Rank #{student.rank}</div>
                        </div>
                      </div>
                      <div className="mt-3">
                        <XPBar xp={student.xp} level={student.level}/>
                      </div>
                    </div>

                    {/* Quick links */}
                    <div className="px-2 py-2">
                      {profileMenuItems.map(item => (
                        <button key={item.key} onClick={() => { setPage(item.key); setProfileOpen(false); }}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all",
                            page === item.key ? "bg-[#6366f1]/15 text-[#6366f1]" : "text-[#a0a0b0] hover:text-white hover:bg-white/5"
                          )}>
                          <span className={page === item.key ? "text-[#6366f1]" : "text-[#78788c]"}>{item.icon}</span>
                          {item.label}
                          {page === item.key && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#6366f1]"/>}
                        </button>
                      ))}
                    </div>

                    {/* Footer */}
                    <div className="px-2 py-2 border-t border-white/5">
                      <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-[#78788c] hover:text-white hover:bg-white/5 transition-all">
                        <Settings className="w-3.5 h-3.5"/>
                        Settings
                      </button>
                      <button
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-[#78788c] hover:text-rose-400 hover:bg-rose-400/5 transition-all"
                      >
                        <LogOut className="w-3.5 h-3.5"/>
                        Sign out
                      </button>
                    </div>
                  </div>
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
              return (
                <button key={item.key} onClick={() => setPage(item.key)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-semibold transition-all",
                    active ? "text-[#6366f1]" : "text-[#78788c]"
                  )}>
                  <span className={cn("transition-transform duration-150", active && "scale-110")}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
            {/* Profile avatar button in bottom nav */}
            <button
              onClick={() => setPage("profile")}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-semibold transition-all",
                page === "profile" ? "text-[#6366f1]" : "text-[#78788c]"
              )}>
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white transition-transform",
                page === "profile" ? "scale-110 ring-2 ring-[#6366f1] ring-offset-1 ring-offset-[#0d0d0f]" : ""
              )}
                style={{background:"linear-gradient(135deg,#6366f1,#8f7dd6)"}}>
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
