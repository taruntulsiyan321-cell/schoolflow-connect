













/**
 * Calendar days between an instant and now, on the viewer's clock: yesterday
 * at 11 pm is one day ago, not zero. Counting 24-hour periods called last
 * night "Today" and the day before yesterday "Yesterday". Null for no date.
 */
export function calendarDaysAgo(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // round, not floor: a day across a DST change is 23 or 25 hours.
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

export function formatLastSeen(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "Recently";
  const days = calendarDaysAgo(iso, now);
  if (days == null) return "Recently";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

















