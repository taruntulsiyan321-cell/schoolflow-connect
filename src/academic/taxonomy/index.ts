/**
 * Academic taxonomy SSOT — Board → Class → Subject → Chapter → Topic → Concept.
 * Presentation: use presentAcademicLabel / display* from humanize (also via @/lib/academicPresentation).
 */

export type {
  TaxonomyTermRef,
} from "./types";

export {
  canonicalizeConceptId,
  looksLikeAcademicSlug,
  mergeDuplicateLabels,
  normalizeIncomingAcademicTerm,
} from "./canonicalize";

export {
  searchTaxonomyByAlias,
} from "./registry";

export { formatTaxonomyBreadcrumb, resolveTaxonomyDisplayPath } from "./resolve";

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
  presentAcademicLabel,
  toPresentedTerm,
} from "./humanize";

export { COMMERCE_SUBJECTS } from "./seeds/commerceRbse";
export {
  SCIENCE_SUBJECTS,
} from "./seeds/sciencePlaceholders";
