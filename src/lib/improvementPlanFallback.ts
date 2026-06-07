export type ImprovementPlanPayload = {
  headline: string;
  steps: string[];
  resources: string[];
  timeframe: string;
  source?: "ai" | "rule";
};

export function buildRuleImprovementPlan(opts: {
  subject: string;
  chapter?: string | null;
  topic?: string | null;
  accuracy: number;
  attempts: number;
  mistake_count: number;
}): ImprovementPlanPayload {
  const { subject, chapter, topic, accuracy, attempts, mistake_count } = opts;
  const label = [subject, chapter, topic].filter(Boolean).join(" · ") || subject;

  const steps: string[] = [];
  if (accuracy < 45) {
    steps.push(`Re-read NCERT ${chapter ?? subject} basics — definitions and worked examples only.`);
    steps.push(`Solve 5 easy questions on "${topic ?? chapter ?? subject}" without a timer.`);
    steps.push(`Add every wrong answer to your Mistake Bank and re-attempt after 24 hours.`);
  } else if (accuracy < 60) {
    steps.push(`Review Mistake Bank entries for ${label} — note the recurring error pattern.`);
    steps.push(`Complete one DPP or solo battle on the same chapter (untimed first).`);
    steps.push(`Re-attempt missed questions; aim for 70%+ before adding speed.`);
  } else {
    steps.push(`Consolidate ${label} with a timed solo battle (class-appropriate duration).`);
    steps.push(`Explain one solved problem aloud — teaching locks in understanding.`);
    steps.push(`Challenge a peer or join an open lobby to test under competition.`);
  }

  if (mistake_count >= 3) {
    steps.push(`You have ${mistake_count} mistakes logged — run Revision Queue for this topic today.`);
  }

  const resources = [
    `NCERT ${chapter ?? subject}${topic ? ` — ${topic}` : ""}`,
    "School DPP / worksheet for this chapter",
    attempts < 5 ? "Khan Academy or DIKSHA topic video (same chapter)" : "Previous year CBSE exemplar questions",
  ];

  const timeframe = accuracy < 45 ? "5–7 days" : accuracy < 60 ? "3–5 days" : "2–3 days";

  return {
    headline:
      accuracy < 45
        ? `Rebuild fundamentals in ${topic ?? chapter ?? subject}`
        : accuracy < 60
          ? `Close the gap in ${topic ?? chapter ?? subject} — you're close`
          : `Polish ${topic ?? chapter ?? subject} for exam-ready accuracy`,
    steps: steps.slice(0, 6),
    resources: resources.slice(0, 4),
    timeframe,
    source: "rule",
  };
}
