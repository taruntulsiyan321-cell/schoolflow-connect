import type { BoardId, Chapter, ClassLevel, Subject, TaxonomyTerm } from "../types";
import { slugifyAcademicId } from "../canonicalize";

const BOARD: BoardId = "rbse";

function subject(id: string, displayName: string, aliases: string[] = []): Subject {
  return { id, displayName, aliases, kind: "subject", board: BOARD };
}

function chapter(displayName: string, subjectId: string, classLevel: ClassLevel): Chapter {
  return {
    id: slugifyAcademicId(displayName),
    displayName,
    aliases: [],
    kind: "chapter",
    board: BOARD,
    classLevel,
    subjectId,
    parentId: subjectId,
  };
}

/** Science stream placeholders — taxonomy only until question seeds land. */
export const SCIENCE_SUBJECTS: Subject[] = [
  subject("physics", "Physics"),
  subject("chemistry", "Chemistry"),
  subject("biology", "Biology"),
  subject("mathematics", "Mathematics", ["maths", "math"]),
  subject("english", "English"),
  subject("hindi", "Hindi"),
];

export const SCIENCE_CHAPTER_PLACEHOLDERS: Chapter[] = [
  // Physics 11 (sample)
  chapter("Units and Measurement", "physics", 11),
  chapter("Motion in a Straight Line", "physics", 11),
  chapter("Laws of Motion", "physics", 11),
  chapter("Work, Energy and Power", "physics", 11),
  chapter("Thermodynamics", "physics", 11),
  // Physics 12
  chapter("Electric Charges and Fields", "physics", 12),
  chapter("Current Electricity", "physics", 12),
  chapter("Ray Optics and Optical Instruments", "physics", 12),
  chapter("Semiconductor Electronics", "physics", 12),
  // Chemistry 11
  chapter("Some Basic Concepts of Chemistry", "chemistry", 11),
  chapter("Structure of Atom", "chemistry", 11),
  chapter("Chemical Bonding and Molecular Structure", "chemistry", 11),
  chapter("Thermodynamics", "chemistry", 11),
  chapter("Hydrocarbons", "chemistry", 11),
  // Chemistry 12
  chapter("Solutions", "chemistry", 12),
  chapter("Electrochemistry", "chemistry", 12),
  chapter("Chemical Kinetics", "chemistry", 12),
  chapter("Aldehydes, Ketones and Carboxylic Acids", "chemistry", 12),
  // Biology 11
  chapter("The Living World", "biology", 11),
  chapter("Cell: The Unit of Life", "biology", 11),
  chapter("Photosynthesis in Higher Plants", "biology", 11),
  // Biology 12
  chapter("Principles of Inheritance and Variation", "biology", 12),
  chapter("Molecular Basis of Inheritance", "biology", 12),
  chapter("Biotechnology: Principles and Processes", "biology", 12),
];

export function scienceTaxonomyBundle(): TaxonomyTerm[] {
  return [...SCIENCE_SUBJECTS, ...SCIENCE_CHAPTER_PLACEHOLDERS];
}
