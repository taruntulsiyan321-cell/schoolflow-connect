/** Lightweight XP refresh bus (compat with AcademicLiveProvider broadcast). */
export function notifyStudentXpUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("student-xp-updated"));
}
