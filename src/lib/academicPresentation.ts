/**
 * Academic presentation layer — UI-facing labels for taxonomy terms.
 * Prefer this module (or @/academic/taxonomy) over ad-hoc Title Case.
 *
 * Internal IDs / slugs stay in DB & AI context packs; user-visible strings go through here.
 */

export {
  academicLabelEquals,
  academicLabelMatches,
  academicMatchKey,
  displayChapter,
  displayConcept,
  displaySubject,
  displayTopic,
  fixMojibake,
  humanizeAcademicLabel,
  isPlaceholderAcademicLabel,
  looksLikeAcademicSlug,
  presentAcademicLabel,
  toPresentedTerm,
} from "@/academic/taxonomy";

import { presentAcademicLabel as _present } from "@/academic/taxonomy";


export type { TaxonomyTermRef } from "@/academic/taxonomy";
