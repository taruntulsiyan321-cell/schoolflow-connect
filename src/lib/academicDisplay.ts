/**
 * Global academic label formatting for UI.
 * SSOT lives in `@/academic/taxonomy` (dictionary + intelligent humanize).
 * Keep raw slugs / DB values for filters and IDs; format only for display.
 */
import {
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
};

/** Stable UI alias — same as presentAcademicLabel. */
export const formatAcademicLabel = presentAcademicLabel;

export type { AcademicLabelKind } from "@/academic/taxonomy";
