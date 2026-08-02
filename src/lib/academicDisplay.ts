/**
 * Global academic label formatting for UI.
 * SSOT lives in `@/academic/taxonomy` (dictionary + intelligent humanize).
 * Keep raw slugs / DB values for filters and IDs; format only for display.
 */
export {
  academicLabelMatches,
  academicMatchKey,
  displayChapter,
  displayConcept,
  displaySubject,
  displayTopic,
  fixMojibake,
  humanizeAcademicLabel,
  looksLikeAcademicSlug,
  presentAcademicLabel,
  toPresentedTerm,
} from "@/academic/taxonomy";

export type { AcademicLabelKind } from "@/academic/taxonomy";
