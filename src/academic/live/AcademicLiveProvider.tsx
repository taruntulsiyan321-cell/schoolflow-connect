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
import { SyncEngine } from "@/academic/sync/engine";
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

    void SyncEngine.processPendingEvents(schoolId, 80).catch(() => undefined);

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
        { event: "*", schema: "public", table: "dpps", filter: `school_id=eq.${schoolId}` },
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

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void SyncEngine.processPendingEvents(schoolId, 50).catch(() => undefined);
      bump(["all"]);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    const poll = window.setInterval(() => {
      void SyncEngine.processPendingEvents(schoolId, 30).catch(() => undefined);
      bump(["all"]);
    }, 90_000);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(poll);
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
