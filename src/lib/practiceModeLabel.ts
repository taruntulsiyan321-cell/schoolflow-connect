import { presentAcademicLabel } from "@/lib/academicPresentation";

/**
 * What each practice_mode is called, everywhere it is shown — the Practice hub's
 * tiles and history, and the result page's heading.
 *
 * One home, because the result page needs it too: a Weak Areas session has no
 * single chapter, and the page used to title it with whatever chapter its first
 * question happened to come from ("Real Numbers" for a session across six).
 */
export const PRACTICE_MODE_LABELS = {
  subject: "Subject Practice",
  chapter: "Chapter Practice",
  topic: "Topic Practice",
  custom: "Custom Practice",
  pyq: "Previous Year Questions",
  weak: "Weak Areas Practice",
  incorrect: "Incorrect Questions",
  skipped: "Skipped Questions",
  bookmarked: "Bookmarked Questions",
  // Handed over by Recovery and the revision schedule; no hub tile.
  recovery: "Recovery",
  revision: "Revision check",
} as const;

export type PracticeModeKey = keyof typeof PRACTICE_MODE_LABELS;

/** A session's type, from its practice_mode. */
export function practiceModeLabel(mode: string | null | undefined): string {
  if (!mode) return "Practice";
  const known = (PRACTICE_MODE_LABELS as Record<string, string>)[mode];
  return known ?? (presentAcademicLabel(mode) || mode);
}
