import type { PresentedTaxonomyPath, TaxonomyPath } from "./types";
import { lookupDisplayName } from "./registry";
import { presentAcademicLabel } from "./humanize";

/**
 * Resolve display labels along Board → Class → Subject → Chapter → Topic → Concept.
 * Missing segments are omitted (not invented).
 */
export function resolveTaxonomyDisplayPath(path: TaxonomyPath): PresentedTaxonomyPath {
  const out: PresentedTaxonomyPath = {};

  if (path.board) {
    out.board = lookupDisplayName(path.board, "board") ?? presentAcademicLabel(path.board, "board");
  }
  if (path.classLevel != null && String(path.classLevel) !== "") {
    const n = String(path.classLevel);
    out.classLevel = lookupDisplayName(n, "class_level") ?? `Class ${n}`;
  }
  if (path.subject) {
    out.subject =
      lookupDisplayName(path.subject, "subject") ?? presentAcademicLabel(path.subject, "subject");
  }
  if (path.chapter) {
    out.chapter =
      lookupDisplayName(path.chapter, "chapter") ?? presentAcademicLabel(path.chapter, "chapter");
  }
  if (path.topic) {
    out.topic =
      lookupDisplayName(path.topic, "topic") ?? presentAcademicLabel(path.topic, "topic");
  }
  if (path.concept) {
    out.concept =
      lookupDisplayName(path.concept, "concept") ?? presentAcademicLabel(path.concept, "concept");
  }

  return out;
}

/** Breadcrumb string for UI (skips empty). */
export function formatTaxonomyBreadcrumb(path: TaxonomyPath, sep = " · "): string {
  const d = resolveTaxonomyDisplayPath(path);
  return [d.subject, d.chapter, d.topic ?? d.concept].filter(Boolean).join(sep);
}
