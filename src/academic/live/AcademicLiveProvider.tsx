import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth";
import {
  domainsFromNotificationType,
  notifyAcademicChange,
  subscribeAcademicChange,
  type AcademicChangeDetail,
  type AcademicDomain,
} from "./bus";
import { invalidateAcademicQueries } from "./queryKeys";

type LiveState = {
  version: number;
  lastDomains: AcademicDomain[];
  bump: (domains?: AcademicDomain[], meta?: Partial<AcademicChangeDetail>) => void;
};

const AcademicLiveContext = createContext<LiveState>({
  version: 0,
  lastDomains: ["all"],
  bump: () => undefined,
});

const ACADEMIC_NOTIF_TYPES = new Set([
  "attendance",
  "homework",
  "result",
  "exam",
  "test",
  "general",
  "battle",
  "badge",
  "xp",
  "doubt",
  "leave",
  "message",
]);
/**
 * Mount once under AuthProvider. Subscribes to school academic tables + bus,
 * drains pending sync events, and bumps a shared version so every portal refetches.
 */
export function AcademicLiveProvider({ children }: { children: ReactNode }) {
  const { user, schoolId, isAuthenticated, role } = useAuth();
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(0);
  const [lastDomains, setLastDomains] = useState<AcademicDomain[]>(["all"]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDomains = useRef<Set<AcademicDomain>>(new Set());

  const flush = useCallback(() => {
    const domains = [...pendingDomains.current];
    pendingDomains.current.clear();
    if (!domains.length) domains.push("all");
    setLastDomains(domains);
    setVersion((v) => v + 1);
    void invalidateAcademicQueries(queryClient, domains);
  }, [queryClient]);

  const bump = useCallback(
    (domains: AcademicDomain[] = ["all"], _meta?: Partial<AcademicChangeDetail>) => {
      for (const d of domains) pendingDomains.current.add(d);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, 250);
    },
    [flush],
  );

  useEffect(() => {
    return subscribeAcademicChange((detail) => {
      if (schoolId && detail.schoolId && detail.schoolId !== schoolId) return;
      bump(detail.domains, detail);
    });
  }, [bump, schoolId]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id || !schoolId) return;

    const onTable =
      (domains: AcademicDomain[]) =>
      () => {
        bump(domains);
      };

    const channel = supabase
      .channel(`academic-live-${schoolId}-${user.id.slice(0, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance", filter: `school_id=eq.${schoolId}` },
        onTable(["attendance", "profile"]),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "homework", filter: `school_id=eq.${schoolId}` },
        onTable(["homework", "profile"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "homework_submissions",
          filter: `school_id=eq.${schoolId}`,
        },
        onTable(["homework", "profile"]),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "marks", filter: `school_id=eq.${schoolId}` },
        onTable(["marks", "examination", "profile"]),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exams", filter: `school_id=eq.${schoolId}` },
        onTable(["examination", "marks", "profile"]),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tests", filter: `school_id=eq.${schoolId}` },
        onTable(["test", "profile"]),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notices", filter: `school_id=eq.${schoolId}` },
        onTable(["profile"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "school_calendar_events",
          filter: `school_id=eq.${schoolId}`,
        },
        onTable(["calendar"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "student_academic_profiles",
          filter: `school_id=eq.${schoolId}`,
        },
        onTable(["profile"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "school_activity_feed",
          filter: `school_id=eq.${schoolId}`,
        },
        onTable(["all"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "student_xp",
          filter:
            role === "student" ? `user_id=eq.${user.id}` : `school_id=eq.${schoolId}`,
        },
        onTable(["xp", "achievements", "profile"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "student_badges",
          filter: `user_id=eq.${user.id}`,
        },
        onTable(["achievements", "xp"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "battle_participants",
          filter: `user_id=eq.${user.id}`,
        },
        onTable(["battle", "xp", "profile"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "battles",
          filter: `creator_user_id=eq.${user.id}`,
        },
        onTable(["battle"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "community_doubts",
          filter: `school_id=eq.${schoolId}`,
        },
        onTable(["doubt", "profile"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "community_doubt_answers",
        },
        onTable(["doubt", "profile"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leave_requests",
          filter: `applicant_user_id=eq.${user.id}`,
        },
        onTable(["profile"]),
      )
      // BATCH 1c. A verdict used to touch leave_requests too — the dual write —
      // so this subscription alone was enough to refresh the applicant. With the
      // column dropped, a decision changes leave_decisions and nothing else, and
      // without this the applicant's leave would sit on screen as Pending until
      // they reloaded by hand. No applicant_user_id filter is possible here:
      // leave_decisions has no such column, so RLS is what scopes it.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leave_decisions",
        },
        onTable(["profile"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "practice_sessions",
          filter: `user_id=eq.${user.id}`,
        },
        onTable(["xp", "profile"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "question_attempts",
          filter: `user_id=eq.${user.id}`,
        },
        onTable(["xp", "profile"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "battle_invites",
          filter: `invited_user_id=eq.${user.id}`,
        },
        onTable(["battle"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `receiver_id=eq.${user.id}`,
        },
        onTable(["message", "profile"]),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `sender_id=eq.${user.id}`,
        },
        onTable(["message"]),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { type?: string } | null;
          if (!row?.type || !ACADEMIC_NOTIF_TYPES.has(row.type)) return;
          bump(domainsFromNotificationType(row.type));
        },
      )
      .subscribe();

    // THE CLIENT NO LONGER DRAINS THE EVENT QUEUE.
    //
    // This used to call SyncEngine.processPendingEvents on mount, on every tab
    // focus, and every 90 seconds. All three returned 403 — every time, for
    // every student — because process_pending_academic_events is not granted
    // to `authenticated`, and correctly so: it is a cron job that processes
    // the whole SCHOOL's queue, and a student's browser has no business
    // draining other students' events.
    //
    // `.catch(() => undefined)` is what kept that invisible for however long
    // it has been there. Found by watching the network tab on a real session.
    //
    // Nothing is lost by removing it: the pg_cron job
    // `process-pending-academic-events` runs the same function every minute,
    // and the realtime handlers above are what actually refresh this screen.

    return () => {
      supabase.removeChannel(channel);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [bump, isAuthenticated, schoolId, user?.id, role]);

  const value = useMemo(
    () => ({ version, lastDomains, bump }),
    [version, lastDomains, bump],
  );

  return (
    <AcademicLiveContext.Provider value={value}>{children}</AcademicLiveContext.Provider>
  );
}

/**
 * Shared live version. Put this in useEffect deps on academic panels so they
 * reload when teachers change attendance / homework / marks.
 */
export function useAcademicLive(filter?: AcademicDomain | AcademicDomain[]): number {
  const { version, lastDomains } = useContext(AcademicLiveContext);
  const filterKey = !filter
    ? ""
    : (Array.isArray(filter) ? filter : [filter]).slice().sort().join(",");
  const [matchedVersion, setMatchedVersion] = useState(0);
  const lastSeen = useRef(0);

  useEffect(() => {
    if (!filterKey) return;
    if (version === lastSeen.current) return;
    lastSeen.current = version;
    const wanted = new Set(filterKey.split(",").filter(Boolean) as AcademicDomain[]);
    if (lastDomains.includes("all") || lastDomains.some((d) => wanted.has(d))) {
      setMatchedVersion((v) => v + 1);
    }
  }, [version, lastDomains, filterKey]);

  return filterKey ? matchedVersion : version;
}

export function useAcademicLiveBump() {
  return useContext(AcademicLiveContext).bump;
}

/** Convenience: notify bus from service layer after a successful write. */
export function broadcastAcademicWrite(
  schoolId: string | null | undefined,
  domains: AcademicDomain[],
  meta?: Omit<AcademicChangeDetail, "schoolId" | "domains">,
): void {
  notifyAcademicChange({ schoolId, domains, ...meta });
}
