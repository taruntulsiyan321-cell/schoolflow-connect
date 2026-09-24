import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { PageKey } from "@/gurukul/nav";
import {
  PAGE_TITLE,
  LEARNING as LEARNING_KEYS,
  CLASS as CLASS_KEYS,
  studentNavEntries,
  isSchoolOnlyPath,
  isOrganisationSchool,
} from "@/gurukul/nav";
import { EMPTY_STUDENT, type GurukulStudentProfile } from "@/gurukul/emptyStudent";
import { useGurukulAcademicIdentity } from "@/gurukul/StudentContext";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { cn, XPBar, EASE_OUT, springSnappy, springSoft } from "./shared";
import {
  Home, BookOpen, Brain, Swords,
  ChevronLeft, ChevronRight, Bell, Menu, X,
  FlaskConical, GraduationCap, Settings, LogOut,
  User, Wallet, Megaphone, BarChart2, RefreshCw, RotateCcw,
  AlertCircle, Trophy,
} from "lucide-react";
import { MembershipSwitcher } from "@/auth/MembershipSwitcher";

type NavItem  = { key: PageKey; label: string; icon: ReactNode };
type NavEntry = { key: PageKey; label: string; icon: ReactNode };

/** Icon + label for every key studentNavEntries may return — one catalogue. */
const NAV_CATALOGUE: Record<PageKey, { label: string; icon: ReactNode }> = {
  dashboard:    { label: "Home",         icon: <Home className="w-4 h-4"/> },
  practice:     { label: "Practice",     icon: <BookOpen className="w-4 h-4"/> },
  aicoach:      { label: "AI Coach",     icon: <Brain className="w-4 h-4"/> },
  battleground: { label: "Battleground", icon: <Swords className="w-4 h-4"/> },
  learninghub:  { label: "Learning",     icon: <GraduationCap className="w-4 h-4"/> },
  classhub:     { label: "Class",        icon: <FlaskConical className="w-4 h-4"/> },
  analysis:     { label: "Analysis",     icon: <BarChart2 className="w-4 h-4"/> },
  recovery:     { label: "Recovery",     icon: <RefreshCw className="w-4 h-4"/> },
  revision:     { label: "Revision",     icon: <RotateCcw className="w-4 h-4"/> },
  mistakebook:  { label: "Mistake Book", icon: <AlertCircle className="w-4 h-4"/> },
  achievements: { label: "Achievements", icon: <Trophy className="w-4 h-4"/> },
  leaderboard:  { label: "Rankings",     icon: <Trophy className="w-4 h-4"/> },
  resources:    { label: "Resources",    icon: <BookOpen className="w-4 h-4"/> },
  doubtportal:  { label: "Doubts",       icon: <Brain className="w-4 h-4"/> },
  assignments:  { label: "Homework",     icon: <BookOpen className="w-4 h-4"/> },
  attendance:   { label: "Attendance",   icon: <GraduationCap className="w-4 h-4"/> },
  profile:      { label: "Profile",      icon: <User className="w-4 h-4"/> },
  timetable:    { label: "Timetable",    icon: <BookOpen className="w-4 h-4"/> },
  calendar:     { label: "Calendar",     icon: <BookOpen className="w-4 h-4"/> },
  tests:        { label: "Tests",        icon: <FlaskConical className="w-4 h-4"/> },
};

function navEntriesFor(keys: PageKey[]): NavEntry[] {
  return keys.map((key) => {
    const cat = NAV_CATALOGUE[key];
    return { key, label: cat.label, icon: cat.icon };
  });
}

function bottomEntriesFor(keys: PageKey[]): NavItem[] {
  return keys.map((key) => {
    const cat = NAV_CATALOGUE[key];
    return {
      key,
      label: cat.label,
      icon: <span className="[&>svg]:w-5 [&>svg]:h-5">{cat.icon}</span>,
    };
  });
}

// ── Profile dropdown menu items ───────────────────────────────────────────────
// Leaderboard and Analysis came off because each already has a home — Rankings
// on the Class page, Analysis under Learning — and a second door to the same
// screen is a second thing to keep in step. Achievements came off because it
// now lives in exactly one place, the profile (v2 redesign, Screen 13).
const profileMenuItems = [
  { label:"My Profile",    icon:<User className="w-3.5 h-3.5"/>,     key:"profile"      as PageKey },
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
  const { schoolKind } = useGurukulAcademicIdentity();
  const student = { ...EMPTY_STUDENT, ...profile };
  const showXpChrome = progressionReady;
  const reduceMotion = useReducedMotion();

  // ONE place: nav.ts studentNavEntries — Layout only renders the keys it returns.
  const { sidebar: sidebarKeys, bottom: bottomKeys } = studentNavEntries(schoolKind ?? null);
  const sidebarNav = navEntriesFor(sidebarKeys);
  const bottomNav = bottomEntriesFor(bottomKeys);
  const visibleProfileExtras = profileExtraLinks.filter(
    (item) => isOrganisationSchool(schoolKind) || !isSchoolOnlyPath(item.path),
  );

  // Class rank is school-only; individuals (and unknown kind) show exam / scope label.
  const scopeLine = isOrganisationSchool(schoolKind)
    ? ([student.class, student.rank > 0 ? `Rank #${student.rank}` : null].filter(Boolean).join(" · ") || "Your class")
    : (student.class || "Exam");

  const headerTitle =
    location.pathname.startsWith("/student/notifications") ? "Notifications"
    : location.pathname.startsWith("/student/notices") ? "Notices"
    : location.pathname.startsWith("/student/fees") ? "Fees"
    : PAGE_TITLE[page];
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

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

  function isBottomActive(key: PageKey) {
    if (key === "learninghub") return LEARNING_KEYS.includes(page);
    if (key === "classhub")    return CLASS_KEYS.includes(page);
    return page === key;
  }

  // ── Top-level link ──────────────────────────────────────────────────────────
  const TopLink = ({ entry }: { entry: NavEntry }) => {
    // A hub stays lit while the student is on one of the pages it leads to,
    // which is what the expanded submenu used to signal.
    const active = isBottomActive(entry.key);
    return (
      <motion.button
        onClick={() => { setPage(entry.key); setMobileOpen(false); }}
        whileTap={reduceMotion ? undefined : { scale: 0.98 }}
        className={cn(
          "relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-colors duration-150",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
          collapsed && "justify-center px-2"
        )}
        title={collapsed ? entry.label : undefined}>
        {active && (
          <motion.div
            layoutId="sidebarActivePill"
            transition={reduceMotion ? { duration: 0 } : springSnappy}
            className="absolute inset-0 rounded-xl bg-primary shadow-lg shadow-primary/15"
          />
        )}
        <span className="relative z-10 shrink-0">{entry.icon}</span>
        {!collapsed && <span className="relative z-10 truncate flex-1">{entry.label}</span>}
      </motion.button>
    );
  };

  // ── Sidebar shell ───────────────────────────────────────────────────────────
  const SidebarContent = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Logo */}
      <div className={cn("flex items-center gap-3 px-4 py-4 border-b border-border shrink-0", collapsed && "justify-center px-2")}>
        <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
          <Brain className="w-4 h-4 text-primary-foreground"/>
        </div>
        {!collapsed && (
          <div>
            <div className="text-sm font-black text-foreground leading-none" style={{fontFamily:"var(--font-display)"}}>Gurukul</div>
            <div className="text-[10px] text-muted-foreground leading-none mt-0.5">
              {schoolKind === "individual" ? "Exam prep" : "Student"}
            </div>
          </div>
        )}
      </div>

      {/* XP card */}
      {!collapsed && (
        <div className="px-3 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-primary-foreground shrink-0"
              style={{background:"hsl(var(--primary))"}}>
              {student.avatar}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-foreground truncate">{student.name}</div>
              <div className="text-[10px] text-muted-foreground">{student.class}</div>
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
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-border animate-pulse" />
            </div>
          )}
        </div>
      )}

      {/* Nav items */}
      <nav className="px-2 py-3 space-y-0.5 overflow-y-auto flex-1 min-h-0 scrollbar-none">
        {sidebarNav.map(entry => <TopLink key={entry.key} entry={entry}/>)}
      </nav>

      {/* Collapse */}
      <div className="px-2 py-3 border-t border-border shrink-0">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-all text-xs">
          {collapsed ? <ChevronRight className="w-4 h-4"/> : <><ChevronLeft className="w-4 h-4"/><span>Collapse</span></>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden"
      style={{background:"hsl(var(--background))"}}>

      {/* Desktop sidebar */}
      <aside className={cn(
        "hidden md:flex flex-col border-r border-border bg-card/95 backdrop-blur-xl transition-all duration-300 shrink-0",
        collapsed ? "w-16" : "w-56"
      )}>
        <SidebarContent/>
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-modal md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={reduceMotion ? undefined : { x: "-100%" }}
              animate={{ x: 0 }}
              exit={reduceMotion ? undefined : { x: "-100%" }}
              transition={reduceMotion ? { duration: 0 } : springSoft}
              className="absolute left-0 top-0 h-full w-64 bg-card border-r border-border flex flex-col">
              <div className="flex justify-end p-3 shrink-0">
                <motion.button
                  whileTap={reduceMotion ? undefined : { scale: 0.9 }}
                  onClick={() => setMobileOpen(false)}
                  className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5"/>
                </motion.button>
              </div>
              <div className="flex-1 overflow-hidden"><SidebarContent/></div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top header — z-40 so backdrop-blur stacking context sits above <main> */}
        <header className="relative z-40 shrink-0 border-b border-border bg-card/95 backdrop-blur-xl">
          <div className="h-14 px-4 sm:px-6 flex items-center gap-3">
            {/* Mobile hamburger */}
            <motion.button
              whileTap={reduceMotion ? undefined : { scale: 0.88 }}
              className="md:hidden text-muted-foreground hover:text-foreground"
              onClick={() => setMobileOpen(true)}>
              <Menu className="w-5 h-5"/>
            </motion.button>

            {/* The top bar's label, NOT the page's heading.
                This was an <h1> at `text-sm`, so every screen shipped two h1
                elements — this one and the real page title below it — and a
                screen reader jumping by heading landed first on a 14px chrome
                label. A page has one h1 and it is the one PageHeader renders.
                `aria-hidden` because it only repeats that title; announcing it
                twice is worse than not announcing it at all. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={headerTitle}
                aria-hidden="true"
                initial={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: 4 }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
                className="text-sm font-bold text-foreground flex-1 tracking-tight" style={{fontFamily:"var(--font-display)"}}>
                {headerTitle}
              </motion.div>
            </AnimatePresence>

            {/* Right badges */}
            <div className="flex items-center gap-2">
              <MembershipSwitcher className="shrink-0" />
              {/* Ruling 4: the header is back + title + at most one screen-specific
                  action. A streak pill, an XP pill and a notification bell stood
                  here on EVERY screen. Streak and XP belong on Home, where the
                  student is looking at their progress on purpose; carried in the
                  chrome they followed them into the middle of a test.

                  The bell went with them. Notifications is reached from the
                  profile menu, and the unread count moved onto that link — the
                  signal survives, the chrome does not. */}

              {/* Admin Panel shortcut */}
              {onOpenAdmin && (
                <motion.button
                  whileHover={reduceMotion ? undefined : { scale: 1.03 }}
                  whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                  onClick={onOpenAdmin}
                  className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground hover:text-primaryGlow border border-border hover:border-primary/40 hover:bg-primary/8 rounded-full px-2.5 py-1 transition-all"
                  title="Switch to Admin Panel"
                >
                  <Settings className="w-3 h-3" />
                  Admin
                </motion.button>
              )}

              {/* Profile avatar — opens dropdown (portaled to body) */}
              <div className="relative" ref={profileRef}>
                <motion.button
                  whileHover={reduceMotion ? undefined : { scale: 1.06 }}
                  whileTap={reduceMotion ? undefined : { scale: 0.92 }}
                  onClick={() => setProfileOpen(o => !o)}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-primary-foreground transition-all ring-2 ring-offset-2 ring-offset-background",
                    profileOpen ? "ring-primary" : "ring-transparent hover:ring-border",
                    page === "profile" && "ring-primary"
                  )}
                  style={{background:"hsl(var(--primary))"}}
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                >
                  {student.avatar}
                </motion.button>

                {createPortal(
                  <AnimatePresence>
                    {profileOpen && (
                  <motion.div
                    ref={profileMenuRef}
                    role="menu"
                    initial={reduceMotion ? undefined : { opacity: 0, scale: 0.96, y: -6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96, y: -6 }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: EASE_OUT }}
                    className="fixed right-4 top-14 mt-0 w-64 z-overlay rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-elevated overflow-hidden"
                  >
                    {/* User info */}
                    <div className="px-4 py-4 border-b border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black text-primary-foreground shrink-0"
                          style={{background:"hsl(var(--primary))"}}>
                          {student.avatar}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-foreground truncate">{student.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {scopeLine}
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
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full w-1/3 rounded-full bg-border animate-pulse" />
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
                            page === item.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}>
                          <span className={page === item.key ? "text-primary" : "text-muted-foreground"}>{item.icon}</span>
                          {item.label}
                          {page === item.key && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary"/>}
                        </button>
                      ))}
                      {visibleProfileExtras.map(item => (
                        <button
                          key={item.path}
                          onClick={() => { navigate(item.path); setProfileOpen(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                        >
                          <span className="text-muted-foreground">{item.icon}</span>
                          <span className="flex-1">{item.label}</span>
                          {/* The unread count the header bell used to carry. It moved
                              here with the link rather than being deleted — ruling 4
                              removes the bell from the chrome, not the student's
                              ability to know something is waiting. */}
                          {item.path === "/student/notifications" && unread > 0 && (
                            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                              {unread > 9 ? "9+" : unread}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Footer */}
                    <div className="px-2 py-2 border-t border-border">
                      <button
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all"
                      >
                        <LogOut className="w-3.5 h-3.5"/>
                        Sign out
                      </button>
                    </div>
                  </motion.div>
                    )}
                  </AnimatePresence>,
                  document.body,
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-background">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={page}
              initial={reduceMotion ? undefined : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              className="p-4 sm:p-6 max-w-5xl mx-auto pb-24 md:pb-6">
              {children}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile bottom nav — tabs from studentNavEntries */}
        <nav className="md:hidden shrink-0 fixed bottom-0 inset-x-0 border-t border-border/70 bg-card/95 backdrop-blur-xl z-40">
          <div className="flex">
            {bottomNav.map(item => {
              const active = isBottomActive(item.key);
              return (
                <motion.button key={item.key} onClick={() => setPage(item.key)}
                  whileTap={reduceMotion ? undefined : { scale: 0.92 }}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-semibold transition-colors relative",
                    active ? "text-primary" : "text-muted-foreground"
                  )}>
                  {active && (
                    <motion.span
                      layoutId="bottomNavDot"
                      transition={reduceMotion ? { duration: 0 } : springSnappy}
                      className="absolute top-0 w-8 h-0.5 rounded-full bg-primary"
                    />
                  )}
                  <motion.span
                    className="relative"
                    animate={{ scale: active ? 1.1 : 1 }}
                    transition={reduceMotion ? { duration: 0 } : springSnappy}>
                    {item.icon}
                  </motion.span>
                  {item.label}
                </motion.button>
              );
            })}
            {/* Profile avatar button in bottom nav */}
            <motion.button
              onClick={() => setPage("profile")}
              whileTap={reduceMotion ? undefined : { scale: 0.92 }}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-semibold transition-colors relative",
                page === "profile" ? "text-primary" : "text-muted-foreground"
              )}>
              {page === "profile" && (
                <motion.span
                  layoutId="bottomNavDot"
                  transition={reduceMotion ? { duration: 0 } : springSnappy}
                  className="absolute top-0 w-8 h-0.5 rounded-full bg-primary"
                />
              )}
              <motion.div
                animate={{ scale: page === "profile" ? 1.1 : 1 }}
                transition={reduceMotion ? { duration: 0 } : springSnappy}
                className={cn(
                  // Sits on a solid hsl(var(--primary)) circle, so it needs the
                  // on-primary colour; text-foreground gave near-black on teal (2.8:1).
                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-primary-foreground",
                  page === "profile" ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
                )}
                style={{background:"hsl(var(--primary))"}}>
                {student.avatar}
              </motion.div>
              Profile
            </motion.button>
          </div>
        </nav>
      </div>
    </div>
  );
}
