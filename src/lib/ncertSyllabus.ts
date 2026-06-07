/** NCERT chapter/topic allowlists by class grade (6–12). Used to limit battleground pickers. */

export type NcertChapter = { chapter: string; topics: string[] };

const MATH: Record<number, NcertChapter[]> = {
  6: [
    { chapter: "Knowing Our Numbers", topics: ["Comparing numbers", "Estimation", "Roman numerals"] },
    { chapter: "Whole Numbers", topics: ["Number line", "Properties", "Patterns"] },
    { chapter: "Playing with Numbers", topics: ["Factors and multiples", "HCF and LCM", "Divisibility"] },
    { chapter: "Basic Geometrical Ideas", topics: ["Points and lines", "Angles", "Polygons"] },
    { chapter: "Understanding Elementary Shapes", topics: ["Types of angles", "Triangles", "Quadrilaterals"] },
    { chapter: "Integers", topics: ["Addition", "Subtraction", "Number line"] },
    { chapter: "Fractions", topics: ["Proper and improper", "Equivalent fractions", "Operations"] },
    { chapter: "Decimals", topics: ["Place value", "Operations", "Word problems"] },
    { chapter: "Data Handling", topics: ["Pictographs", "Bar graphs", "Mean"] },
    { chapter: "Mensuration", topics: ["Perimeter", "Area"] },
    { chapter: "Algebra", topics: ["Variables", "Expressions", "Equations"] },
    { chapter: "Ratio and Proportion", topics: ["Unitary method", "Proportion"] },
    { chapter: "Symmetry", topics: ["Line symmetry", "Rotational symmetry"] },
    { chapter: "Practical Geometry", topics: ["Construction of angles", "Circles"] },
  ],
  7: [
    { chapter: "Integers", topics: ["Properties", "Operations"] },
    { chapter: "Fractions and Decimals", topics: ["Multiplication", "Division"] },
    { chapter: "Data Handling", topics: ["Mean, median, mode", "Probability intro"] },
    { chapter: "Simple Equations", topics: ["Solving equations", "Applications"] },
    { chapter: "Lines and Angles", topics: ["Parallel lines", "Angle pairs"] },
    { chapter: "The Triangle and its Properties", topics: ["Medians", "Pythagoras"] },
    { chapter: "Congruence of Triangles", topics: ["SSS", "SAS", "ASA"] },
    { chapter: "Comparing Quantities", topics: ["Percentages", "Profit and loss", "Simple interest"] },
    { chapter: "Rational Numbers", topics: ["Standard form", "Operations"] },
    { chapter: "Perimeter and Area", topics: ["Circles", "Parallelograms"] },
    { chapter: "Algebraic Expressions", topics: ["Like terms", "Factorisation intro"] },
    { chapter: "Exponents and Powers", topics: ["Laws of exponents"] },
    { chapter: "Symmetry", topics: ["Rotational symmetry"] },
    { chapter: "Visualising Solid Shapes", topics: ["Nets", "Views"] },
  ],
  8: [
    { chapter: "Rational Numbers", topics: ["Properties", "Representation"] },
    { chapter: "Linear Equations in One Variable", topics: ["Solving", "Word problems"] },
    { chapter: "Understanding Quadrilaterals", topics: ["Types", "Angle sum"] },
    { chapter: "Practical Geometry", topics: ["Quadrilateral construction"] },
    { chapter: "Data Handling", topics: ["Histogram", "Probability"] },
    { chapter: "Squares and Square Roots", topics: ["Methods", "Patterns"] },
    { chapter: "Cubes and Cube Roots", topics: ["Prime factorisation"] },
    { chapter: "Comparing Quantities", topics: ["Compound interest", "Discount"] },
    { chapter: "Algebraic Expressions and Identities", topics: ["Identities", "Factorisation"] },
    { chapter: "Visualising Solid Shapes", topics: ["Euler's formula"] },
    { chapter: "Mensuration", topics: ["Surface area", "Volume"] },
    { chapter: "Exponents and Powers", topics: ["Negative exponents"] },
    { chapter: "Direct and Inverse Proportions", topics: ["Applications"] },
    { chapter: "Factorisation", topics: ["Common factors", "Grouping"] },
    { chapter: "Introduction to Graphs", topics: ["Linear graphs"] },
  ],
  9: [
    { chapter: "Number Systems", topics: ["Rational and irrational", "Laws of exponents"] },
    { chapter: "Polynomials", topics: ["Remainder theorem", "Factor theorem"] },
    { chapter: "Coordinate Geometry", topics: ["Cartesian plane", "Plotting"] },
    { chapter: "Linear Equations in Two Variables", topics: ["Graphical method", "Applications"] },
    { chapter: "Introduction to Euclid's Geometry", topics: ["Axioms and postulates"] },
    { chapter: "Lines and Angles", topics: ["Parallel lines", "Angle sum"] },
    { chapter: "Triangles", topics: ["Congruence", "Inequalities"] },
    { chapter: "Quadrilaterals", topics: ["Properties", "Mid-point theorem"] },
    { chapter: "Circles", topics: ["Chords", "Angles in segment"] },
    { chapter: "Heron's Formula", topics: ["Area of triangle"] },
    { chapter: "Surface Areas and Volumes", topics: ["Cuboid", "Cylinder", "Cone", "Sphere"] },
    { chapter: "Statistics", topics: ["Mean, median, mode", "Histogram"] },
  ],
  10: [
    { chapter: "Real Numbers", topics: ["Euclid's division", "HCF and LCM", "Irrational numbers"] },
    { chapter: "Polynomials", topics: ["Zeros", "Division algorithm"] },
    { chapter: "Pair of Linear Equations in Two Variables", topics: ["Graphical", "Algebraic methods"] },
    { chapter: "Quadratic Equations", topics: ["Factorisation", "Formula", "Nature of roots"] },
    { chapter: "Arithmetic Progressions", topics: ["nth term", "Sum of n terms"] },
    { chapter: "Triangles", topics: ["Similarity", "BPT", "Pythagoras"] },
    { chapter: "Coordinate Geometry", topics: ["Distance", "Section formula", "Area"] },
    { chapter: "Introduction to Trigonometry", topics: ["Ratios", "Identities"] },
    { chapter: "Some Applications of Trigonometry", topics: ["Heights and distances"] },
    { chapter: "Circles", topics: ["Tangents", "Number of tangents"] },
    { chapter: "Constructions", topics: ["Division of line", "Tangents"] },
    { chapter: "Areas Related to Circles", topics: ["Sector", "Segment"] },
    { chapter: "Surface Areas and Volumes", topics: ["Combination of solids"] },
    { chapter: "Statistics", topics: ["Mean of grouped data", "Ogives"] },
    { chapter: "Probability", topics: ["Classical probability"] },
  ],
  11: [
    { chapter: "Sets", topics: ["Operations", "Venn diagrams"] },
    { chapter: "Relations and Functions", topics: ["Domain and range", "Types of functions"] },
    { chapter: "Trigonometric Functions", topics: ["Identities", "Graphs"] },
    { chapter: "Complex Numbers and Quadratic Equations", topics: ["Argand plane", "Modulus"] },
    { chapter: "Linear Inequalities", topics: ["Graphical solution"] },
    { chapter: "Permutations and Combinations", topics: ["Fundamental principle", "Formulae"] },
    { chapter: "Binomial Theorem", topics: ["General term", "Middle term"] },
    { chapter: "Sequences and Series", topics: ["AP", "GP", "Sum"] },
    { chapter: "Straight Lines", topics: ["Slope", "Forms of equation"] },
    { chapter: "Conic Sections", topics: ["Parabola", "Ellipse", "Hyperbola"] },
    { chapter: "Introduction to Three Dimensional Geometry", topics: ["Coordinates in space"] },
    { chapter: "Limits and Derivatives", topics: ["First principles", "Rules"] },
    { chapter: "Statistics", topics: ["Mean deviation", "Variance"] },
    { chapter: "Probability", topics: ["Axiomatic approach"] },
  ],
  12: [
    { chapter: "Relations and Functions", topics: ["Types", "Composition", "Inverse"] },
    { chapter: "Inverse Trigonometric Functions", topics: ["Properties", "Graphs"] },
    { chapter: "Matrices", topics: ["Operations", "Determinants"] },
    { chapter: "Determinants", topics: ["Properties", "Adjoint", "Inverse"] },
    { chapter: "Continuity and Differentiability", topics: ["Chain rule", "Implicit"] },
    { chapter: "Application of Derivatives", topics: ["Rate of change", "Maxima minima"] },
    { chapter: "Integrals", topics: ["Substitution", "By parts", "Definite integrals"] },
    { chapter: "Application of Integrals", topics: ["Area under curve"] },
    { chapter: "Differential Equations", topics: ["Order and degree", "Formation"] },
    { chapter: "Vector Algebra", topics: ["Dot and cross product"] },
    { chapter: "Three Dimensional Geometry", topics: ["Lines", "Planes"] },
    { chapter: "Linear Programming", topics: ["Graphical method"] },
    { chapter: "Probability", topics: ["Conditional probability", "Bayes"] },
  ],
};

const SCIENCE: Record<number, NcertChapter[]> = {
  10: [
    { chapter: "Chemical Reactions and Equations", topics: ["Balancing", "Types of reactions"] },
    { chapter: "Acids, Bases and Salts", topics: ["pH", "Neutralisation"] },
    { chapter: "Metals and Non-metals", topics: ["Reactivity series", "Corrosion"] },
    { chapter: "Carbon and its Compounds", topics: ["Hydrocarbons", "Functional groups"] },
    { chapter: "Life Processes", topics: ["Nutrition", "Respiration", "Excretion"] },
    { chapter: "Control and Coordination", topics: ["Nervous system", "Hormones"] },
    { chapter: "How do Organisms Reproduce", topics: ["Asexual", "Sexual reproduction"] },
    { chapter: "Heredity and Evolution", topics: ["Mendel", "Speciation"] },
    { chapter: "Light – Reflection and Refraction", topics: ["Mirrors", "Lenses"] },
    { chapter: "Human Eye and Colourful World", topics: ["Defects of vision", "Dispersion"] },
    { chapter: "Electricity", topics: ["Ohm's law", "Series and parallel"] },
    { chapter: "Magnetic Effects of Electric Current", topics: ["Fleming's rules", "Motor"] },
    { chapter: "Sources of Energy", topics: ["Renewable", "Non-renewable"] },
    { chapter: "Our Environment", topics: ["Ecosystem", "Ozone"] },
  ],
};

const SUBJECT_MAP: Record<string, Record<number, NcertChapter[]>> = {
  Mathematics: MATH,
  Science: SCIENCE,
};

export function parseClassGrade(className?: string | null): number | null {
  if (!className) return null;
  const m = className.match(/\b(6|7|8|9|10|11|12)\b/);
  return m ? Number(m[1]) : null;
}

export function getNcertSubjects(grade: number | null): string[] {
  if (!grade) return ["Mathematics", "Science"];
  const out = new Set<string>();
  for (const [subject, byGrade] of Object.entries(SUBJECT_MAP)) {
    if (byGrade[grade]?.length) out.add(subject);
  }
  if (!out.size) return ["Mathematics", "Science"];
  return Array.from(out);
}

export function getNcertChapters(grade: number | null, subject: string): string[] {
  if (!grade) return [];
  const list = SUBJECT_MAP[subject]?.[grade] ?? [];
  return list.map((c) => c.chapter);
}

export function getNcertTopics(grade: number | null, subject: string, chapter: string): string[] {
  if (!grade) return [];
  const ch = SUBJECT_MAP[subject]?.[grade]?.find(
    (c) => c.chapter.toLowerCase() === chapter.toLowerCase(),
  );
  return ch?.topics ?? [];
}

/** Intersect NCERT allowlist with question-bank rows (bank may have fewer topics). */
export function filterCurriculumByNcert(
  grade: number | null,
  subject: string,
  bankRows: { chapter: string; topic: string | null }[],
): { chapter: string; topic: string | null }[] {
  if (!grade) return bankRows;
  const ncertChapters = getNcertChapters(grade, subject);
  if (!ncertChapters.length) return bankRows;

  const allowedCh = new Set(ncertChapters.map((c) => c.toLowerCase()));
  const out: { chapter: string; topic: string | null }[] = [];

  for (const chName of ncertChapters) {
    const ncertTopics = getNcertTopics(grade, subject, chName);
    const bankForChapter = bankRows.filter(
      (r) => r.chapter?.toLowerCase() === chName.toLowerCase(),
    );
    if (bankForChapter.length === 0) {
      out.push({ chapter: chName, topic: null });
      ncertTopics.forEach((t) => out.push({ chapter: chName, topic: t }));
      continue;
    }
    for (const row of bankForChapter) {
      if (!row.chapter || !allowedCh.has(row.chapter.toLowerCase())) continue;
      if (!row.topic) {
        out.push({ chapter: row.chapter, topic: null });
        continue;
      }
      const topicOk =
        !ncertTopics.length ||
        ncertTopics.some((t) => t.toLowerCase() === row.topic!.toLowerCase());
      if (topicOk) out.push({ chapter: row.chapter, topic: row.topic });
    }
    ncertTopics.forEach((t) => {
      if (!out.some((x) => x.chapter === chName && x.topic === t)) {
        out.push({ chapter: chName, topic: t });
      }
    });
  }
  return out;
}
