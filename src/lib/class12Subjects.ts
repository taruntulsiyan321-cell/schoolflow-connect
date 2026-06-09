// CBSE NCERT Class 12 subjects and chapters used by the AI-expandable question bank.

export const CLASS12_PHYSICS_CHAPTERS = [
  "Electric Charges and Fields",
  "Electrostatic Potential and Capacitance",
  "Current Electricity",
  "Moving Charges and Magnetism",
  "Magnetism and Matter",
  "Electromagnetic Induction",
  "Alternating Current",
  "Electromagnetic Waves",
  "Ray Optics and Optical Instruments",
  "Wave Optics",
  "Dual Nature of Radiation and Matter",
  "Atoms",
  "Nuclei",
  "Semiconductor Electronics",
] as const;

export type Class12Subject = "Mathematics" | "Physics";

export const CLASS12_SUBJECTS: { value: Class12Subject; label: string; chapters: readonly string[] }[] = [
  {
    value: "Mathematics",
    label: "Mathematics",
    // Re-exported lazily from the math engine when needed by the picker.
    chapters: [],
  },
  {
    value: "Physics",
    label: "Physics",
    chapters: CLASS12_PHYSICS_CHAPTERS,
  },
];
