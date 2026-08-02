import type { BoardId, Chapter, ClassLevel, Subject, TaxonomyTerm } from "../types";
import { chapterTermId, slugifyAcademicId } from "../canonicalize";

const BOARD: BoardId = "rbse";

function subject(id: string, displayName: string, aliases: string[] = []): Subject {
  return { id, displayName, aliases, kind: "subject", board: BOARD };
}

function chapter(displayName: string, subjectId: string, classLevel: ClassLevel, aliases: string[] = []): Chapter {
  const base = slugifyAcademicId(displayName);
  return {
    id: chapterTermId(displayName, subjectId, classLevel),
    displayName,
    aliases: [...new Set([base, ...aliases].filter(Boolean))],
    kind: "chapter",
    board: BOARD,
    classLevel,
    subjectId,
    parentId: subjectId,
  };
}

/** Science stream subjects — taxonomy ready; QB seeds land later. */
export const SCIENCE_SUBJECTS: Subject[] = [
  subject("physics", "Physics"),
  subject("chemistry", "Chemistry"),
  subject("biology", "Biology"),
  subject("mathematics", "Mathematics", ["maths", "math"]),
  subject("english", "English"),
  subject("hindi", "Hindi"),
  subject("computer_science", "Computer Science", ["cs", "computer science"]),
  subject("informatics_practices", "Informatics Practices", ["ip"]),
];

/** NCERT-aligned chapter titles (rationalised) for science stream taxonomy. */
export const SCIENCE_CHAPTER_PLACEHOLDERS: Chapter[] = [
  // Physics 11
  chapter("Units and Measurement", "physics", 11),
  chapter("Motion in a Straight Line", "physics", 11),
  chapter("Motion in a Plane", "physics", 11),
  chapter("Laws of Motion", "physics", 11),
  chapter("Work, Energy and Power", "physics", 11),
  chapter("System of Particles and Rotational Motion", "physics", 11),
  chapter("Gravitation", "physics", 11),
  chapter("Mechanical Properties of Solids", "physics", 11),
  chapter("Mechanical Properties of Fluids", "physics", 11),
  chapter("Thermal Properties of Matter", "physics", 11),
  chapter("Thermodynamics", "physics", 11),
  chapter("Kinetic Theory", "physics", 11),
  chapter("Oscillations", "physics", 11),
  chapter("Waves", "physics", 11),
  // Physics 12
  chapter("Electric Charges and Fields", "physics", 12),
  chapter("Electrostatic Potential and Capacitance", "physics", 12),
  chapter("Current Electricity", "physics", 12),
  chapter("Moving Charges and Magnetism", "physics", 12),
  chapter("Magnetism and Matter", "physics", 12),
  chapter("Electromagnetic Induction", "physics", 12),
  chapter("Alternating Current", "physics", 12),
  chapter("Electromagnetic Waves", "physics", 12),
  chapter("Ray Optics and Optical Instruments", "physics", 12),
  chapter("Wave Optics", "physics", 12),
  chapter("Dual Nature of Radiation and Matter", "physics", 12),
  chapter("Atoms", "physics", 12),
  chapter("Nuclei", "physics", 12),
  chapter("Semiconductor Electronics", "physics", 12),
  // Chemistry 11
  chapter("Some Basic Concepts of Chemistry", "chemistry", 11),
  chapter("Structure of Atom", "chemistry", 11),
  chapter("Classification of Elements and Periodicity", "chemistry", 11),
  chapter("Chemical Bonding and Molecular Structure", "chemistry", 11),
  chapter("Thermodynamics", "chemistry", 11),
  chapter("Equilibrium", "chemistry", 11),
  chapter("Redox Reactions", "chemistry", 11),
  chapter("Organic Chemistry - Some Basic Principles and Techniques", "chemistry", 11, [
    "Organic Chemistry – Some Basic Principles and Techniques",
  ]),
  chapter("Hydrocarbons", "chemistry", 11),
  // Chemistry 12
  chapter("Solutions", "chemistry", 12),
  chapter("Electrochemistry", "chemistry", 12),
  chapter("Chemical Kinetics", "chemistry", 12),
  chapter("The d- and f-Block Elements", "chemistry", 12),
  chapter("Coordination Compounds", "chemistry", 12),
  chapter("Haloalkanes and Haloarenes", "chemistry", 12),
  chapter("Alcohols, Phenols and Ethers", "chemistry", 12),
  chapter("Aldehydes, Ketones and Carboxylic Acids", "chemistry", 12),
  chapter("Amines", "chemistry", 12),
  chapter("Biomolecules", "chemistry", 12),
  // Biology 11
  chapter("The Living World", "biology", 11),
  chapter("Biological Classification", "biology", 11),
  chapter("Plant Kingdom", "biology", 11),
  chapter("Animal Kingdom", "biology", 11),
  chapter("Morphology of Flowering Plants", "biology", 11),
  chapter("Anatomy of Flowering Plants", "biology", 11),
  chapter("Structural Organisation in Animals", "biology", 11),
  chapter("Cell: The Unit of Life", "biology", 11),
  chapter("Biomolecules", "biology", 11),
  chapter("Cell Cycle and Cell Division", "biology", 11),
  chapter("Photosynthesis in Higher Plants", "biology", 11),
  chapter("Respiration in Plants", "biology", 11),
  chapter("Plant Growth and Development", "biology", 11),
  chapter("Breathing and Exchange of Gases", "biology", 11),
  chapter("Body Fluids and Circulation", "biology", 11),
  chapter("Excretory Products and Their Elimination", "biology", 11),
  chapter("Locomotion and Movement", "biology", 11),
  chapter("Neural Control and Coordination", "biology", 11),
  chapter("Chemical Coordination and Integration", "biology", 11),
  // Biology 12 (rationalised 13)
  chapter("Sexual Reproduction in Flowering Plants", "biology", 12),
  chapter("Human Reproduction", "biology", 12),
  chapter("Reproductive Health", "biology", 12),
  chapter("Principles of Inheritance and Variation", "biology", 12),
  chapter("Molecular Basis of Inheritance", "biology", 12),
  chapter("Evolution", "biology", 12),
  chapter("Human Health and Disease", "biology", 12),
  chapter("Microbes in Human Welfare", "biology", 12),
  chapter("Biotechnology: Principles and Processes", "biology", 12),
  chapter("Biotechnology and its Applications", "biology", 12),
  chapter("Organisms and Populations", "biology", 12),
  chapter("Ecosystem", "biology", 12),
  chapter("Biodiversity and Conservation", "biology", 12),
];

export function scienceTaxonomyBundle(): TaxonomyTerm[] {
  return [...SCIENCE_SUBJECTS, ...SCIENCE_CHAPTER_PLACEHOLDERS];
}
