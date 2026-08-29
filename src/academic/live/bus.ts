/**
 * In-app academic change bus.
 * Teacher/student writes notify listeners so principal/parent/student panels refresh
 * without waiting for a remount. Cross-tab refresh uses Supabase Realtime.
 */

export type AcademicDomain =
  | "attendance"
  | "homework"
  | "marks"
  | "examination"
  | "test"
  | "profile"
  | "xp"
  | "battle"
  | "achievements"
  | "doubt"
  | "message"
  | "calendar"
  | "timetable"
  | "all";

export type AcademicChangeDetail = {
  schoolId?: string | null;
  domains: AcademicDomain[];
  classId?: string | null;
  studentId?: string | null;
  source?: string;
};

const BUS_EVENT = "academic-change";

const target =
  typeof window !== "undefined" && typeof EventTarget !== "undefined"
    ? new EventTarget()
    : null;

export function notifyAcademicChange(detail: AcademicChangeDetail): void {
  if (!target) return;
  target.dispatchEvent(
    new CustomEvent<AcademicChangeDetail>(BUS_EVENT, {
      detail: {
        ...detail,
        domains: detail.domains.length ? detail.domains : ["all"],
      },
    }),
  );
}

export function subscribeAcademicChange(
  handler: (detail: AcademicChangeDetail) => void,
): () => void {
  if (!target) return () => undefined;
  const listener = (event: Event) => {
    const custom = event as CustomEvent<AcademicChangeDetail>;
    if (custom.detail) handler(custom.detail);
  };
  target.addEventListener(BUS_EVENT, listener);
  return () => target.removeEventListener(BUS_EVENT, listener);
}

/** Map notification.type / event prefix → academic domains for live invalidation. */
export function domainsFromNotificationType(type: string | null | undefined): AcademicDomain[] {
  const t = (type ?? "").toLowerCase();
  if (t.includes("attendance")) return ["attendance", "profile"];
  if (t.includes("homework") || t.includes("assignment")) return ["homework", "profile"];
  if (t.includes("result") || t.includes("mark")) return ["marks", "examination", "profile"];
  if (t.includes("exam")) return ["examination", "marks", "profile"];
  if (t.includes("test") || t.includes("test")) return ["test", "profile"];
  if (t.includes("battle") || t.includes("arena")) return ["battle", "xp", "profile"];
  if (t.includes("badge") || t.includes("achievement")) return ["achievements", "xp"];
  if (t.includes("doubt")) return ["doubt", "profile"];
  if (t.includes("message") || t.includes("chat")) return ["message"];
  if (t.includes("calendar") || t.includes("event")) return ["calendar"];
  if (t.includes("leave")) return ["profile"];
  if (t.includes("xp") || t.includes("practice")) return ["xp", "profile"];
  return ["all"];
}
