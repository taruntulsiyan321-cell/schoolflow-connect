/** Academic taxonomy entity kinds (presentation + registry). */
export type TaxonomyKind =
  | "board"
  | "class_level"
  | "subject"
  | "chapter"
  | "topic"
  | "concept"
  | "question_type";

export type BoardId = "rbse" | "cbse" | "icse" | "other" | "both";

/**
 * Imported and re-exported, not re-declared. This union used to be written out
 * here as `6 | 7 | … | 12`, which made it one of six homes for the class-level
 * domain and silently excluded Class 5 — a class §10.9 names by hand and the
 * seeded curriculum carries 55 chapters for. `@/lib/curriculumScope` owns the
 * list; `ClassLevel` is derived from it, so the two can never disagree.
 *
 * Imported as well as re-exported because a bare `export type { X } from` does
 * NOT bring the name into this file's scope, and the fields below use it.
 */
import type { ClassLevel } from "@/lib/curriculumScope";
export type { ClassLevel };

export type QuestionTypeId =
  | "mcq"
  | "short"
  | "long"
  | "numerical"
  | "assertion_reason"
  | "case_based"
  | "concept";

/** Shared shape for every taxonomy term. */
export type TaxonomyTerm = {
  id: string;
  displayName: string;
  aliases: string[];
  description?: string;
  keywords?: string[];
  kind: TaxonomyKind;
  board?: BoardId | null;
  classLevel?: ClassLevel | null;
  subjectId?: string | null;
  parentId?: string | null;
};

export type Board = TaxonomyTerm & { kind: "board"; id: BoardId };
export type Subject = TaxonomyTerm & { kind: "subject" };
export type Chapter = TaxonomyTerm & { kind: "chapter"; subjectId: string };
export type Topic = TaxonomyTerm & { kind: "topic" };
export type Concept = TaxonomyTerm & { kind: "concept" };
export type QuestionType = TaxonomyTerm & { kind: "question_type"; id: QuestionTypeId };

export type TaxonomyPath = {
  board?: BoardId | null;
  classLevel?: ClassLevel | number | null;
  subject?: string | null;
  chapter?: string | null;
  topic?: string | null;
  concept?: string | null;
};

export type PresentedTaxonomyPath = {
  board?: string;
  classLevel?: string;
  subject?: string;
  chapter?: string;
  topic?: string;
  concept?: string;
};

export type AcademicLabelKind =
  | "subject"
  | "chapter"
  | "topic"
  | "concept"
  | "question_type"
  | "board"
  | "class_level";

export type TaxonomyTermRef = {
  id: string;
  displayName: string;
};
