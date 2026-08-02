/**
 * Academic taxonomy SSOT — Board → Class → Subject → Chapter → Topic → Concept.
 * Presentation: use presentAcademicLabel / display* from humanize (also via @/lib/academicPresentation).
 */

export type {
  AcademicLabelKind,
  Board,
  BoardId,
  Chapter,
  ClassLevel,
  Concept,
  PresentedTaxonomyPath,
  QuestionType,
  QuestionTypeId,
  Subject,
  TaxonomyKind,
  TaxonomyPath,
  TaxonomyTerm,
  TaxonomyTermRef,
  Topic,
} from "./types";

export {
  canonicalizeConceptId,
  chapterTermId,
  kindFromColumn,
  mergeDuplicateLabels,
  normalizeIncomingAcademicTerm,
  slugifyAcademicId,
} from "./canonicalize";

export {
  BOARD_DISPLAY,
  CONCEPT_DISPLAY_DICTIONARY,
  QUESTION_TYPE_DISPLAY,
  SUBJECT_DISPLAY,
  TOKEN_DISPLAY,
} from "./dictionary";

export {
  getTaxonomyTerm,
  listTaxonomyTerms,
  lookupDisplayName,
  searchTaxonomyByAlias,
} from "./registry";

export { formatTaxonomyBreadcrumb, resolveTaxonomyDisplayPath } from "./resolve";

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
} from "./humanize";

export { COMMERCE_CHAPTERS, COMMERCE_SUBJECTS, commerceTaxonomyBundle } from "./seeds/commerceRbse";
export { BANK_CONCEPT_DISPLAY } from "./seeds/bankConcepts";
export {
  SCIENCE_CHAPTER_PLACEHOLDERS,
  SCIENCE_SUBJECTS,
  scienceTaxonomyBundle,
} from "./seeds/sciencePlaceholders";
