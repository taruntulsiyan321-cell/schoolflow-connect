import { generateFromTemplate } from "@/engines/class12Math/generate";
import type { GeneratedQuestion, QuestionTemplateRow } from "@/engines/class12Math/types";

/** High-entropy seed so consecutive sessions produce different numbers. */
export function freshSessionSeed(chapter: string): number {
  const t = Date.now();
  const r = crypto.getRandomValues(new Uint32Array(1))[0];
  let h = chapter.length * 997;
  for (let i = 0; i < chapter.length; i++) h = ((h << 5) - h + chapter.charCodeAt(i)) | 0;
  return (t ^ r ^ h) >>> 0;
}

/** Prefer one template per type so questions don't feel cloned. */
export function diversifyTemplates(
  rows: QuestionTemplateRow[],
  count: number,
): QuestionTemplateRow[] {
  const byType = new Map<string, QuestionTemplateRow[]>();
  for (const row of rows) {
    const key = row.template_type;
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(row);
  }

  const types = [...byType.keys()].sort(() => Math.random() - 0.5);
  const picked: QuestionTemplateRow[] = [];
  const usedTypes = new Set<string>();

  for (const type of types) {
    if (picked.length >= count) break;
    const pool = byType.get(type)!;
    const variant = pool[Math.floor(Math.random() * pool.length)];
    picked.push(variant);
    usedTypes.add(type);
  }

  const remainder = rows
    .filter((r) => !picked.includes(r))
    .sort(() => Math.random() - 0.5);

  for (const row of remainder) {
    if (picked.length >= count) break;
    picked.push(row);
  }

  return picked.slice(0, count);
}

const SEED_STRIDE = 7919;
const RETRY_STRIDE = 131;

/** Generate questions with dedupe + fresh seeds when question text collides. */
export function generateUniqueFromTemplates(
  rows: QuestionTemplateRow[],
  sessionSeed: number,
  seenQuestions = new Set<string>(),
): Array<{ template: QuestionTemplateRow; generated: GeneratedQuestion }> {
  return rows.map((t, i) => {
    let attempt = 0;
    let generated = generateFromTemplate(t, sessionSeed + i * SEED_STRIDE);
    while (seenQuestions.has(generated.question) && attempt < 8) {
      attempt++;
      generated = generateFromTemplate(
        t,
        sessionSeed + i * SEED_STRIDE + attempt * RETRY_STRIDE + attempt * attempt * 17,
      );
    }
    seenQuestions.add(generated.question);
    return { template: t, generated };
  });
}

export { SEED_STRIDE };
