import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { NavGroup, NavGroupKey, PageKey } from "@/gurukul/nav";
import { FILLS_SCREEN, NAV_GROUPS, PAGE_TITLE, groupOf } from "@/gurukul/nav";
import { EMPTY_STUDENT, type GurukulStudentProfile } from "@/gurukul/emptyStudent";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { useProfilePhoto } from "@/hooks/useProfilePhoto";
import { StudentAvatar } from "@/components/student/StudentAvatar";
import { cn, XPBar, EASE_OUT, springSnappy } from "./shared";
import {
  Home, BookOpen, Brain,
  ChevronLeft, ChevronRight, Bell,
  LogOut,
  User, BarChart2, RefreshCw, RotateCcw,
  AlertCircle, Trophy, Crown, Timer,
} from "lucide-react";

/** Icon and label of every page the menu shows — one catalogue. */
const NAV_CATALOGUE: Record<PageKey, { label: string; icon: ReactNode }> = {
  dashboard:     { label: "Home",          icon: <Home className="w-4 h-4"/> },
  practice:      { label: "Practice",      icon: <BookOpen className="w-4 h-4"/> },
  aicoach:       { label: "AI Coach",      icon: <Brain className="w-4 h-4"/> },
  analysis:      { label: "Analysis",      icon: <BarChart2 className="w-4 h-4"/> },
  recovery:      { label: "Recovery",      icon: <RefreshCw className="w-4 h-4"/> },
  revision:      { label: "Revision",      icon: <RotateCcw className="w-4 h-4"/> },
  mistakebook:   { label: "Mistake Book",  icon: <AlertCircle className="w-4 h-4"/> },
  achievements:  { label: "Achievements",  icon: <Trophy className="w-4 h-4"/> },
  profile:       { label: "Profile",       icon: <User className="w-4 h-4"/> },
  premium:       { label: "Plans",         icon: <Crown className="w-4 h-4"/> },
  mocktests:     { label: "Mock Tests",    icon: <Timer className="w-4 h-4"/> },
  notifications: { label: "Notifications", icon: <Bell className="w-4 h-4"/> },
};

/** The icon of each head on a phone's bottom bar. Account wears the student's initials instead. */
const HEAD_ICON: Record<Exclude<NavGroupKey, "account">, ReactNode> = {
  home:     <Home className="w-5 h-5"/>,
  study:    <BookOpen className="w-5 h-5"/>,
  improve:  <RefreshCw className="w-5 h-5"/>,
  progress: <BarChart2 className="w-5 h-5"/>,
};

/** The unread count, wherever Notifications is offered. */
function UnreadCount({ unread, className }: { unread: number; className?: string }) {
  if (unread <= 0) return null;
  return (
    <span
      aria-label={`${unread} unread`}
      className={cn(
        "min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center",
        className,
      )}
    >
      {unread > 9 ? "9+" : unread}
    </span>
  );
}

export default function Layout({
  page,
  setPage,
  children,
  profile,
  progressionReady = true,
}: {
  page: PageKey;
  setPage: (p: PageKey) => void;
  children: ReactNode;
  profile?: Partial<GurukulStudentProfile>;
  /** When false, XP/level chrome shows a neutral placeholder (not Level 1 as truth). */
  progressionReady?: boolean;
}) {
  const { user, signOut } = useAuth();
  // The student's photo where the initials were (D1); the initials when there is none.
  const { url: photoUrl } = useProfilePhoto(user?.id);
  const navigate = useNavigate();
  const { unread } = useNotifications();
  const student = { ...EMPTY_STUDENT, ...profile };
  const showXpChrome = progressionReady;
  const reduceMotion = useReducedMotion();

  // The open head: its pages run along the top on a phone, and its tab is lit.
  const openGroup = groupOf(page);

  // The exam this account prepares for.
  const scopeLine = student.class || "Exam";

  const headerTitle = PAGE_TITLE[page];
  const [collapsed, setCollapsed] = useState(false);
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

  // ── One page in the sidebar ────────────────────────────────────────────────
  const SidebarLink = ({ pageKey }: { pageKey: PageKey }) => {
    const { label, icon } = NAV_CATALOGUE[pageKey];
    const active = page === pageKey;
    return (
      <motion.button
        onClick={() => setPage(pageKey)}
        whileTap={reduceMotion ? undefined : { scale: 0.98 }}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left text-sm font-medium transition-colors duration-150",
          active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
          collapsed && "justify-center px-2"
        )}
        title={collapsed ? label : undefined}>
        {active && (
          <motion.div
            layoutId="sidebarActivePill"
            transition={reduceMotion ? { duration: 0 } : springSnappy}
            className="absolute inset-0 rounded-xl bg-primary shadow-lg shadow-primary/15"
          />
        )}
        <span className="relative z-10 shrink-0">{icon}</span>
        {!collapsed && <span className="relative z-10 truncate flex-1">{label}</span>}
        {pageKey === "notifications" && (
          <UnreadCount unread={unread} className={cn("relative z-10", collapsed && "absolute -right-0.5 -top-0.5")} />
        )}
      </motion.button>
    );
  };

  // ── One head in the sidebar: a section of its pages ─────────────────────────
  const SidebarSection = ({ group }: { group: NavGroup }) => (
    <div role="group" aria-label={group.label}>
      {group.key !== "home" && (collapsed
        ? <div className="mx-2 my-2 h-px bg-border" aria-hidden />
        : <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group.label}</div>)}
      <div className="space-y-0.5">
        {group.pages.map((p) => <SidebarLink key={p} pageKey={p}/>)}
      </div>
    </div>
  );

  return (
    // dvh: on a phone 100vh reaches under the browser's own bars, and the
    // bottom of the screen with it.
    <div className="flex h-screen supports-[height:100dvh]:h-dvh overflow-hidden"
      style={{background:"hsl(var(--background))"}}>

      {/* Sidebar, from tablet width up */}
      <aside className={cn(
        "hidden md:flex flex-col border-r border-border bg-card/95 backdrop-blur-xl transition-all duration-300 shrink-0",
        collapsed ? "w-16" : "w-56"
      )}>
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
                  Exam prep
                </div>
              </div>
            )}
          </div>

          {/* The menu, under its heads */}
          <nav aria-label="Main" className="px-2 py-2 overflow-y-auto flex-1 min-h-0">
            {NAV_GROUPS.map((g) => <SidebarSection key={g.key} group={g}/>)}
          </nav>

          {/* Collapse */}
          <div className="px-2 py-2 border-t border-border shrink-0">
            <button
              onClick={() => setCollapsed(c => !c)}
              aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-all text-xs">
              {collapsed ? <ChevronRight className="w-4 h-4"/> : <><ChevronLeft className="w-4 h-4"/><span>Collapse</span></>}
            </button>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top header — z-40 so backdrop-blur stacking context sits above <main> */}
        <header className="relative z-40 shrink-0 border-b border-border bg-card/95 backdrop-blur-xl">
          <div className="h-14 px-4 sm:px-6 flex items-center gap-3">
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

            {/* Ruling 4: the header is back + title + at most one screen-specific
                action. The streak, XP and notification bell that stood here on
                every screen are gone: streak and XP live on Home, and
                Notifications — with its unread count — is a page of the menu. */}
            <div className="flex items-center gap-2">
              {/* Profile avatar — opens dropdown (portaled to body) */}
              <div className="relative" ref={profileRef}>
                <motion.button
                  whileHover={reduceMotion ? undefined : { scale: 1.06 }}
                  whileTap={reduceMotion ? undefined : { scale: 0.92 }}
                  onClick={() => setProfileOpen(o => !o)}
                  className={cn(
                    "w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-xs font-black text-primary-foreground transition-all ring-2 ring-offset-2 ring-offset-background",
                    profileOpen ? "ring-primary" : "ring-transparent hover:ring-border",
                  )}
                  style={{background:"hsl(var(--primary))"}}
                  aria-label="Your account"
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                >
                  <StudentAvatar url={photoUrl} initials={student.avatar} iconClassName="w-3.5 h-3.5"/>
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
                    className="fixed right-4 top-14 mt-0 w-64 max-w-[calc(100vw-2rem)] z-overlay rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-elevated overflow-hidden"
                  >
                    {/* Who is signed in, and how far they have come. The pages
                        that were linked here — Profile and Notifications — are in
                        the menu under Account; one door to each. */}
                    <div className="px-4 py-4 border-b border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-sm font-black text-primary-foreground shrink-0"
                          style={{background:"hsl(var(--primary))"}}>
                          <StudentAvatar url={photoUrl} initials={student.avatar} iconClassName="w-4 h-4"/>
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

                    <div className="px-2 py-2">
                      <button
                        role="menuitem"
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

          {/* On a phone: the open head's pages, along the top. From tablet width
              up the sidebar lists them, so this row is not drawn there. */}
          {openGroup.pages.length > 1 && (
            <nav aria-label={openGroup.label} className="md:hidden flex gap-1 overflow-x-auto px-2">
              {openGroup.pages.map((p) => {
                const active = page === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "shrink-0 flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                      active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {NAV_CATALOGUE[p].label}
                    {p === "notifications" && <UnreadCount unread={unread}/>}
                  </button>
                );
              })}
            </nav>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 min-h-0 overflow-y-auto bg-background">
          {/* The page ENTERS; it does not exit. This was an AnimatePresence
              with an exit animation, which keeps the old container mounted
              while it plays — and that container renders {children}, the
              router, which already resolves to the NEW location. So every
              navigation mounted the destination twice: a throwaway copy in
              the leaving container, then the real one. The throwaway copy
              consumed anything meant to be read once — a ?mode= deep link, the
              router-state hand-off that starts a recovery or revision
              session — and the real page came up on its hub. Measured
              2026-09-24: Analysis's "Try the ones you skipped" started the
              session in the throwaway copy and showed the Practice hub. */}
          <motion.div
            key={page}
            initial={reduceMotion ? undefined : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className={FILLS_SCREEN.has(page)
              ? "h-full max-w-5xl mx-auto flex flex-col pt-4 sm:pt-6"
              : "p-4 sm:p-6 max-w-5xl mx-auto"}>
            {children}
          </motion.div>
        </main>

        {/* On a phone: one tab per head. A head opens its first page.
            The bar is the column's last row, not laid over the page: nothing
            can scroll under it, and a page that fills the screen ends where
            it begins. (It was fixed over the page, with 96px of padding to
            clear it, and AI Coach worked its own height out from the bar's.) */}
        <nav aria-label="Main" className="md:hidden shrink-0 border-t border-border/70 bg-card/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
          <div className="flex">
            {NAV_GROUPS.map((g) => {
              const active = g.key === openGroup.key;
              return (
                <motion.button
                  key={g.key}
                  onClick={() => setPage(g.pages[0])}
                  whileTap={reduceMotion ? undefined : { scale: 0.92 }}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex-1 min-w-0 flex flex-col items-center gap-1 py-3 text-[10px] font-semibold transition-colors relative",
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
                    {g.key === "account" ? (
                      <span
                        // Sits on a solid hsl(var(--primary)) circle, so it needs the
                        // on-primary colour; text-foreground gave near-black on teal (2.8:1).
                        className={cn(
                          "w-6 h-6 rounded-full overflow-hidden flex items-center justify-center text-[10px] font-black text-primary-foreground",
                          active && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                        )}
                        style={{background:"hsl(var(--primary))"}}>
                        <StudentAvatar url={photoUrl} initials={student.avatar} iconClassName="w-3 h-3"/>
                      </span>
                    ) : HEAD_ICON[g.key]}
                    {g.key === "account" && <UnreadCount unread={unread} className="absolute -right-2.5 -top-1.5"/>}
                  </motion.span>
                  <span className="truncate max-w-full">{g.label}</span>
                </motion.button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
