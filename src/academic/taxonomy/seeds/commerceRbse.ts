import type { BoardId, Chapter, ClassLevel, Concept, Subject, TaxonomyTerm } from "../types";
import { chapterTermId, slugifyAcademicId } from "../canonicalize";
import { CONCEPT_DISPLAY_DICTIONARY } from "../dictionary";
import { BANK_CONCEPT_DISPLAY } from "./bankConcepts";

const BOARD: BoardId = "rbse";

function subject(id: string, displayName: string, aliases: string[] = []): Subject {
  return { id, displayName, aliases, kind: "subject", board: BOARD };
}

function chapter(
  displayName: string,
  subjectId: string,
  classLevel: ClassLevel,
  aliases: string[] = [],
): Chapter {
  const base = slugifyAcademicId(displayName);
  const id = chapterTermId(displayName, subjectId, classLevel);
  return {
    id,
    displayName,
    // Bare title slug stays resolvable via alias (id is subject+class-qualified)
    aliases: [...new Set([base, ...aliases].filter(Boolean))],
    kind: "chapter",
    board: BOARD,
    classLevel,
    subjectId,
    parentId: subjectId,
  };
}

export const COMMERCE_SUBJECTS: Subject[] = [
  subject("accountancy", "Accountancy", ["accounts", "accounting"]),
  subject("business_studies", "Business Studies", ["bst", "business studies (bst)"]),
  subject("economics", "Economics", ["eco"]),
  subject("mathematics", "Mathematics", ["maths", "math"]),
  subject("english", "English", ["english core"]),
  subject("hindi", "Hindi", ["hindi core"]),
];

/** NCERT-aligned RBSE commerce chapters (11–12) from live question_bank seeds. */
export const COMMERCE_CHAPTERS: Chapter[] = [
  chapter("Accounting for Partnership - Basic Concepts", "accountancy", 12, ["Accounting for Partnership — Basic Concepts", "Accounting for Partnership – Basic Concepts"]),
  chapter("Accounting for Share Capital", "accountancy", 12),
  chapter("Accounting Ratios", "accountancy", 12),
  chapter("Analysis of Financial Statements", "accountancy", 12),
  chapter("Bank Reconciliation Statement", "accountancy", 11),
  chapter("Cash Flow Statement", "accountancy", 12),
  chapter("Depreciation, Provisions and Reserves", "accountancy", 11),
  chapter("Dissolution of Partnership Firm", "accountancy", 12),
  chapter("Financial Statements - I", "accountancy", 11, ["Financial Statements – I", "Financial Statements — I"]),
  chapter("Financial Statements - II", "accountancy", 11, ["Financial Statements – II", "Financial Statements — II"]),
  chapter("Financial Statements of a Company", "accountancy", 12),
  chapter("Introduction to Accounting", "accountancy", 11),
  chapter("Issue and Redemption of Debentures", "accountancy", 12),
  chapter("Reconstitution - Admission", "accountancy", 12, ["Reconstitution — Admission", "Reconstitution – Admission"]),
  chapter("Reconstitution - Retirement/Death", "accountancy", 12, ["Reconstitution — Retirement/Death", "Reconstitution – Retirement/Death"]),
  chapter("Recording of Transactions-I", "accountancy", 11),
  chapter("Recording of Transactions-II", "accountancy", 11),
  chapter("Theory Base of Accounting", "accountancy", 11),
  chapter("Trial Balance and Rectification of Errors", "accountancy", 11),
  chapter("Business Environment", "business_studies", 12),
  chapter("Business Services", "business_studies", 11),
  chapter("Consumer Protection", "business_studies", 12),
  chapter("Controlling", "business_studies", 12),
  chapter("Directing", "business_studies", 12),
  chapter("Emerging Modes of Business", "business_studies", 11),
  chapter("Financial Management", "business_studies", 12),
  chapter("Formation of a Company", "business_studies", 11),
  chapter("Forms of Business Organisation", "business_studies", 11),
  chapter("Internal Trade", "business_studies", 11),
  chapter("International Business", "business_studies", 11),
  chapter("Marketing Management", "business_studies", 12),
  chapter("MSME and Business Entrepreneurship", "business_studies", 11),
  chapter("Nature and Purpose of Business", "business_studies", 11),
  chapter("Nature and Significance of Management", "business_studies", 12),
  chapter("Organising", "business_studies", 12),
  chapter("Planning", "business_studies", 12),
  chapter("Principles of Management", "business_studies", 12),
  chapter("Private, Public and Global Enterprises", "business_studies", 11),
  chapter("Social Responsibilities of Business and Business Ethics", "business_studies", 11),
  chapter("Sources of Business Finance", "business_studies", 11),
  chapter("Staffing", "business_studies", 12),
  chapter("Collection of Data", "economics", 11),
  chapter("Comparative Development Experiences", "economics", 11),
  chapter("Correlation", "economics", 11),
  chapter("Determination of Income and Employment", "economics", 12),
  chapter("Employment", "economics", 11),
  chapter("Environment and Sustainable Development", "economics", 11),
  chapter("Government Budget and the Economy", "economics", 12),
  chapter("Human Capital Formation", "economics", 11),
  chapter("Index Numbers", "economics", 11),
  chapter("Indian Economy 1950-1990", "economics", 11, ["Indian Economy 1950–1990"]),
  chapter("Indian Economy on the Eve of Independence", "economics", 11),
  chapter("Introduction", "economics", 11),
  chapter("Introduction", "economics", 12),
  chapter("Introduction to Macroeconomics", "economics", 12),
  chapter("LPG - An Appraisal", "economics", 11, ["LPG — An Appraisal", "LPG – An Appraisal"]),
  chapter("Market Equilibrium", "economics", 12),
  chapter("Measures of Central Tendency", "economics", 11),
  chapter("Money and Banking", "economics", 12),
  chapter("National Income Accounting", "economics", 12),
  chapter("Non-competitive Markets", "economics", 12),
  chapter("Open Economy Macroeconomics", "economics", 12),
  chapter("Organisation of Data", "economics", 11),
  chapter("Presentation of Data", "economics", 11),
  chapter("Production and Costs", "economics", 12),
  chapter("Rural Development", "economics", 11),
  chapter("The Theory of the Firm under Perfect Competition", "economics", 12),
  chapter("Theory of Consumer Behaviour", "economics", 12),
  chapter("Use of Statistical Tools", "economics", 11),
  chapter("A Roadside Stand", "english", 12),
  chapter("A Thing of Beauty", "english", 12),
  chapter("Aunt Jennifer’s Tigers", "english", 12),
  chapter("Birth", "english", 11),
  chapter("Business English", "english", 11),
  chapter("Business English", "english", 12),
  chapter("Comprehension Skills", "english", 11),
  chapter("Comprehension Skills", "english", 12),
  chapter("Deep Water", "english", 12),
  chapter("Discovering Tut", "english", 11),
  chapter("Going Places", "english", 12),
  chapter("Grammar - Articles", "english", 11, ["Grammar — Articles", "Grammar – Articles"]),
  chapter("Grammar - Modals", "english", 12, ["Grammar — Modals", "Grammar – Modals"]),
  chapter("Grammar - Prepositions", "english", 11, ["Grammar — Prepositions", "Grammar – Prepositions"]),
  chapter("Grammar - Reported Speech", "english", 12, ["Grammar — Reported Speech", "Grammar – Reported Speech"]),
  chapter("Grammar - Subject-Verb Agreement", "english", 11, ["Grammar — Subject-Verb Agreement", "Grammar – Subject-Verb Agreement"]),
  chapter("Grammar - Tenses", "english", 11, ["Grammar — Tenses", "Grammar – Tenses"]),
  chapter("Indigo", "english", 12),
  chapter("Journey to the End of the Earth", "english", 12),
  chapter("Keeping Quiet", "english", 12),
  chapter("Lost Spring", "english", 12),
  chapter("Mother’s Day", "english", 11),
  chapter("My Mother at Sixty-Six", "english", 12),
  chapter("On the Face of It", "english", 12),
  chapter("Poets and Pancakes", "english", 12),
  chapter("Silk Road", "english", 11),
  chapter("The Address", "english", 11),
  chapter("The Adventure", "english", 11),
  chapter("The Ailing Planet", "english", 11),
  chapter("The Enemy", "english", 12),
  chapter("The Interview", "english", 12),
  chapter("The Last Lesson", "english", 12),
  chapter("The Portrait of a Lady", "english", 11),
  chapter("The Rattrap", "english", 12),
  chapter("The Summer of the Beautiful White Horse", "english", 11),
  chapter("The Tale of Melon City", "english", 11),
  chapter("The Third Level", "english", 12),
  chapter("The Tiger King", "english", 12),
  chapter("Vocabulary", "english", 11),
  chapter("Vocabulary", "english", 12),
  chapter("We’re Not Afraid to Die…", "english", 11),
  chapter("अतीत में दबे पाँव", "hindi", 12),
  chapter("आओ मिलकर बचाएँ", "hindi", 11),
  chapter("आत्मपरिचय", "hindi", 12),
  chapter("आलो आँधारि", "hindi", 11),
  chapter("उषा", "hindi", 12),
  chapter("कबीर के पद", "hindi", 11),
  chapter("कविता के बहाने", "hindi", 12),
  chapter("काले मेघा पानी दे", "hindi", 12),
  chapter("काव्य - पद", "hindi", 12, ["काव्य — पद", "काव्य – पद"]),
  chapter("काव्य सौंदर्य", "hindi", 12),
  chapter("कैमरे में बंद अपाहिज", "hindi", 12),
  chapter("ग़ज़ल", "hindi", 11),
  chapter("गद्यांश बोध", "hindi", 12),
  chapter("गलता लोहा", "hindi", 11),
  chapter("घर की याद", "hindi", 11),
  chapter("जामुन का पेड़", "hindi", 11),
  chapter("जूझ", "hindi", 12),
  chapter("डायरी के पन्ने", "hindi", 12),
  chapter("नमक का दारोगा", "hindi", 11),
  chapter("नाना साहब की पुत्री देवी मैना को भस्म कर दिया गया", "hindi", 12),
  chapter("पतंग", "hindi", 12),
  chapter("पत्र लेखन", "hindi", 12),
  chapter("पहलवान की ढोलक", "hindi", 12),
  chapter("बाजार दर्शन", "hindi", 12),
  chapter("बादल राग", "hindi", 12),
  chapter("भक्तिन", "hindi", 12),
  chapter("भारत माता", "hindi", 11),
  chapter("भारतीय गायिकाओं में बेजोड़ - लता मंगेशकर", "hindi", 11, ["भारतीय गायिकाओं में बेजोड़ – लता मंगेशकर", "भारतीय गायिकाओं में बेजोड़ — लता मंगेशकर"]),
  chapter("मियाँ नसीरुद्दीन", "hindi", 11),
  chapter("मीरा के पद", "hindi", 11),
  chapter("राजस्थान की रजत बूँदें", "hindi", 11),
  chapter("वह आँखें", "hindi", 11),
  chapter("व्याकरण - अलंकार", "hindi", 12, ["व्याकरण — अलंकार", "व्याकरण – अलंकार"]),
  chapter("व्याकरण - अव्यय", "hindi", 12, ["व्याकरण — अव्यय", "व्याकरण – अव्यय"]),
  chapter("व्याकरण - उपसर्ग", "hindi", 11, ["व्याकरण — उपसर्ग", "व्याकरण – उपसर्ग"]),
  chapter("व्याकरण - काल", "hindi", 11, ["व्याकरण — काल", "व्याकरण – काल"]),
  chapter("व्याकरण - काल", "hindi", 12, ["व्याकरण — काल", "व्याकरण – काल"]),
  chapter("व्याकरण - पर्यायवाची", "hindi", 11, ["व्याकरण — पर्यायवाची", "व्याकरण – पर्यायवाची"]),
  chapter("व्याकरण - पर्यायवाची", "hindi", 12, ["व्याकरण — पर्यायवाची", "व्याकरण – पर्यायवाची"]),
  chapter("व्याकरण - प्रत्यय", "hindi", 11, ["व्याकरण — प्रत्यय", "व्याकरण – प्रत्यय"]),
  chapter("व्याकरण - मुहावरा", "hindi", 11, ["व्याकरण — मुहावरा", "व्याकरण – मुहावरा"]),
  chapter("व्याकरण - मुहावरा", "hindi", 12, ["व्याकरण — मुहावरा", "व्याकरण – मुहावरा"]),
  chapter("व्याकरण - रस", "hindi", 12, ["व्याकरण — रस", "व्याकरण – रस"]),
  chapter("व्याकरण - वर्तनी", "hindi", 11, ["व्याकरण — वर्तनी", "व्याकरण – वर्तनी"]),
  chapter("व्याकरण - वर्तनी", "hindi", 12, ["व्याकरण — वर्तनी", "व्याकरण – वर्तनी"]),
  chapter("व्याकरण - वाक्य", "hindi", 11, ["व्याकरण — वाक्य", "व्याकरण – वाक्य"]),
  chapter("व्याकरण - वाक्य शुद्धि", "hindi", 12, ["व्याकरण — वाक्य शुद्धि", "व्याकरण – वाक्य शुद्धि"]),
  chapter("व्याकरण - वाच्य", "hindi", 12, ["व्याकरण — वाच्य", "व्याकरण – वाच्य"]),
  chapter("व्याकरण - विलोम", "hindi", 11, ["व्याकरण — विलोम", "व्याकरण – विलोम"]),
  chapter("व्याकरण - विलोम", "hindi", 12, ["व्याकरण — विलोम", "व्याकरण – विलोम"]),
  chapter("व्याकरण - संधि", "hindi", 11, ["व्याकरण — संधि", "व्याकरण – संधि"]),
  chapter("व्याकरण - संधि", "hindi", 12, ["व्याकरण — संधि", "व्याकरण – संधि"]),
  chapter("व्याकरण - समास", "hindi", 11, ["व्याकरण — समास", "व्याकरण – समास"]),
  chapter("व्याकरण - समास", "hindi", 12, ["व्याकरण — समास", "व्याकरण – समास"]),
  chapter("शुक्रतारे के समान", "hindi", 12),
  chapter("श्रम विभाजन और जाति प्रथा", "hindi", 12),
  chapter("सहर्ष स्वीकारा है", "hindi", 12),
  chapter("सिल्वर वैडिंग", "hindi", 12),
  chapter("स्पिति में बारिश", "hindi", 11),
  chapter("हे भूख!", "hindi", 11),
  chapter("Application of Derivatives", "mathematics", 12),
  chapter("Application of Integrals", "mathematics", 12),
  chapter("Binomial Theorem", "mathematics", 11),
  chapter("Complex Numbers and Quadratic Equations", "mathematics", 11),
  chapter("Conic Sections", "mathematics", 11),
  chapter("Continuity and Differentiability", "mathematics", 12),
  chapter("Determinants", "mathematics", 12),
  chapter("Differential Equations", "mathematics", 12),
  chapter("Integrals", "mathematics", 12),
  chapter("Introduction to Three Dimensional Geometry", "mathematics", 11),
  chapter("Inverse Trigonometric Functions", "mathematics", 12),
  chapter("Limits and Derivatives", "mathematics", 11),
  chapter("Linear Inequalities", "mathematics", 11),
  chapter("Linear Programming", "mathematics", 12),
  chapter("Matrices", "mathematics", 12),
  chapter("Permutations and Combinations", "mathematics", 11),
  chapter("Probability", "mathematics", 11),
  chapter("Probability", "mathematics", 12),
  chapter("Relations and Functions", "mathematics", 11),
  chapter("Relations and Functions", "mathematics", 12),
  chapter("Sequences and Series", "mathematics", 11),
  chapter("Sets", "mathematics", 11),
  chapter("Statistics", "mathematics", 11),
  chapter("Straight Lines", "mathematics", 11),
  chapter("Three Dimensional Geometry", "mathematics", 12),
  chapter("Trigonometric Functions", "mathematics", 11),
  chapter("Vector Algebra", "mathematics", 12),
];

/** Concept terms from seed slugs with curated (or dictionary) display names. */
export function buildCommerceConceptTerms(): Concept[] {
  const merged: Record<string, string> = { ...CONCEPT_DISPLAY_DICTIONARY, ...BANK_CONCEPT_DISPLAY };
  return Object.entries(merged).map(([id, displayName]) => ({
    id,
    displayName,
    aliases: buildConceptAliases(id, displayName),
    kind: "concept" as const,
    board: BOARD,
  }));
}

function buildConceptAliases(id: string, displayName: string): string[] {
  const aliases = new Set<string>();
  aliases.add(displayName);
  aliases.add(displayName.toLowerCase());
  aliases.add(id.replace(/_/g, " "));
  if (id === "bank_reconciliation_statement") {
    aliases.add("BRS");
    aliases.add("brs");
    aliases.add("Bank Reconciliation");
  }
  if (id === "brs_purpose") {
    aliases.add("purpose of brs");
    aliases.add("Purpose of BRS");
  }
  if (id === "journal_proper") aliases.add("Proper Journal");
  if (id === "double_entry") {
    aliases.add("Double Entry");
    aliases.add("Double-Entry System");
  }
  if (id === "cash_book") aliases.add("Cashbook");
  if (id === "4ps") {
    aliases.add("4Ps");
    aliases.add("4 ps");
    aliases.add("marketing mix");
  }
  if (id === "moa") aliases.add("Memorandum of Association");
  if (id === "aoa") aliases.add("Articles of Association");
  return [...aliases];
}

export function commerceTaxonomyBundle(): TaxonomyTerm[] {
  return [...COMMERCE_SUBJECTS, ...COMMERCE_CHAPTERS, ...buildCommerceConceptTerms()];
}
