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

/** The notification types an individual student is sent: reminders, badges, XP. */
const ACADEMIC_NOTIF_TYPES = new Set(["general", "badge", "xp"]);
/**
 * Mount once under AuthProvider. Subscribes to the signed-in student's own
 * tables + bus, and bumps a shared version so every screen refetches.
 *
 * The live app is the individual student panel (2026-10-01). It subscribed to
 * the school's tables too — attendance, homework, marks, exams, tests, notices,
 * the calendar, battles, doubts, leave and, for staff, the activity feed — so
 * every change anywhere in a school reloaded every screen of every student in
 * it. Those subscriptions are kept with the school side on the `organisation`
 * branch.
 *
 * It no longer drains the academic event queue. That drain ran from every
 * signed-in browser, for every school, and was the only thing that ran it —
 * the pg_cron job `process-pending-academic-events` (20260925120000) does it
 * now, whoever is signed in. A recount it applies reaches this provider through
 * the `student_academic_profiles` subscription below.
 */
export function AcademicLiveProvider({ children }: { children: ReactNode }) {
  const { user, schoolId, isAuthenticated } = useAuth();
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

    const own = (table: string, domains: AcademicDomain[]) => [
      "postgres_changes" as const,
      { event: "*" as const, schema: "public", table, filter: `user_id=eq.${user.id}` },
      onTable(domains),
    ] as const;

    const channel = supabase
      .channel(`academic-live-${schoolId}-${user.id.slice(0, 8)}`)
      .on(...own("student_xp", ["xp", "achievements", "profile"]))
      .on(...own("student_badges", ["achievements", "xp"]))
      .on(...own("practice_sessions", ["xp", "profile"]))
      .on(...own("question_attempts", ["xp", "profile"]))
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
      );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [bump, isAuthenticated, schoolId, user?.id]);

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


/** Convenience: notify bus from service layer after a successful write. */
export function broadcastAcademicWrite(
  schoolId: string | null | undefined,
  domains: AcademicDomain[],
  meta?: Omit<AcademicChangeDetail, "schoolId" | "domains">,
): void {
  notifyAcademicChange({ schoolId, domains, ...meta });
}
