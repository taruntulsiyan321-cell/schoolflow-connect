/**
 * Map free-text student intents to registered capabilities.
 * Unmapped text stays as unsupported for generative paths (not in this sprint).
 */

export type MappedIntent = {
  feature_id: string;
  confidence: number;
} | null;

const RULES: { feature_id: string; patterns: RegExp[] }[] = [
  {
    feature_id: "student.attendance.query",
    patterns: [
      /\battendance\b/i,
      /\bpresent\b.+\b(month|week|today|class)\b/i,
      /\bhow many days\b.+\b(absent|present)\b/i,
    ],
  },
  {
    feature_id: "student.homework.due",
    patterns: [
      /\bhomework\b/i,
      /\bassignment(s)?\b.+\b(due|pending)\b/i,
      /\bdue\b.+\b(tomorrow|today|homework|assignment)\b/i,
      /\bpending\b.+\bhomework\b/i,
    ],
  },
  {
    feature_id: "student.marks.summary",
    patterns: [
      /\bmarks?\b/i,
      /\bscore(s)?\b/i,
      /\bexam\b.+\bresult/i,
      /\bhow did I (do|score)\b/i,
    ],
  },
  {
    feature_id: "student.timetable.today",
    patterns: [
      /\btimetable\b/i,
      /\bschedule\b/i,
      /\bwhat('s| is) (my )?(next|today).+(class|period|lesson)\b/i,
      /\bperiods?\b.+\btoday\b/i,
    ],
  },
  {
    feature_id: "student.eie.mastery_summary",
    patterns: [
      /\bmastery\b/i,
      /\bweak\b.+\b(topic|concept|chapter)\b/i,
      /\bstrong\b.+\b(topic|concept)\b/i,
      /\brevision\b.+\b(priority|queue|plan)\b/i,
      /\bwhat should I revise\b/i,
    ],
  },
  {
    feature_id: "student.performance.explain",
    patterns: [
      /\bexplain\b.+\b(performance|progress|marks|attendance)\b/i,
      /\bhow am I doing\b/i,
      /\bsummar(y|ise|ize)\b.+\b(progress|performance)\b/i,
    ],
  },
  {
    feature_id: "student.concept.explain",
    patterns: [
      /\bexplain\b.+\b(concept|topic|chapter|fractions|algebra|photosynthesis)\b/i,
      /\bwhat (is|are|does)\b.+\b(mean|concept|topic)\b/i,
      /\bhelp me (understand|learn)\b/i,
      /\bteach me\b/i,
    ],
  },
  {
    feature_id: "student.recommendation.next",
    patterns: [
      /\bwhat should I (practi[sc]e|study|do next)\b/i,
      /\bnext (concept|topic|step)\b/i,
      /\brecommend(ation)?\b/i,
      /\bwhat to revise\b/i,
    ],
  },
  {
    feature_id: "parent.child.summary",
    patterns: [
      /\bmy child\b/i,
      /\bchild('s)?\b.+\b(progress|summary|attendance|homework)\b/i,
    ],
  },
  {
    feature_id: "parent.child.narrative",
    patterns: [
      /\bweekly\b.+\b(progress|summary|update)\b/i,
      /\bnarrative\b.+\b(progress|child)\b/i,
      /\bprogress (letter|narrative|brief)\b/i,
    ],
  },
];

export function mapIntentToCapability(text: string): MappedIntent {
  const t = (text ?? "").trim();
  if (!t) return null;
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(t))) {
      return { feature_id: rule.feature_id, confidence: 0.85 };
    }
  }
  return null;
}
