/**
 * Academic presentation layer — UI-facing labels for taxonomy terms.
 * Prefer this module (or @/academic/taxonomy) over ad-hoc Title Case.
 *
 * Internal IDs / slugs stay in DB & AI context packs; user-visible strings go through here.
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
  canonicalizeConceptId,
  mergeDuplicateLabels,
  normalizeIncomingAcademicTerm,
  resolveTaxonomyDisplayPath,
  formatTaxonomyBreadcrumb,
  searchTaxonomyByAlias,
  getTaxonomyTerm,
  lookupDisplayName,
} from "@/academic/taxonomy";

export type { AcademicLabelKind, TaxonomyTermRef, TaxonomyPath, PresentedTaxonomyPath } from "@/academic/taxonomy";
