/**
 * §5 / §7 — resolve free-text chapter/topic labels to live curriculum ids.
 * Pure: no Deno, no network. Catalog is loaded by the edge and passed in.
 * Unresolved → null (never invent a chapter — spec §5.1).
 */
export type CurriculumChapter = {
  chapter_id: string;
  chapter_name: string;
  subject_name: string;
  topics: Array<{ topic_id: string; topic_name: string }>;
};

export type ResolvedTags = {
  chapter_id: string | null;
  topic_id: string | null;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact / contained match against a catalog name. Prefer exact. */
function bestNameMatch(
  needle: string | null | undefined,
  haystacks: Array<{ id: string; name: string }>,
): string | null {
  if (!needle?.trim() || haystacks.length === 0) return null;
  const n = norm(needle);
  if (!n) return null;

  let exact: string | null = null;
  let contains: string | null = null;
  for (const h of haystacks) {
    const hn = norm(h.name);
    if (!hn) continue;
    if (hn === n) {
      exact = h.id;
      break;
    }
    if (!contains && (hn.includes(n) || n.includes(hn)) && Math.min(hn.length, n.length) >= 4) {
      contains = h.id;
    }
  }
  return exact ?? contains;
}

/**
 * Resolve optional chapter + topic labels against the exam catalog.
 * Topic is only kept when it belongs to the resolved chapter.
 */
export function resolveCurriculumLabels(
  catalog: CurriculumChapter[],
  chapterLabel: string | null | undefined,
  topicLabel: string | null | undefined,
  subjectHint?: string | null,
): ResolvedTags {
  if (!catalog.length) return { chapter_id: null, topic_id: null };

  let pool = catalog;
  if (subjectHint?.trim()) {
    const sn = norm(subjectHint);
    const narrowed = catalog.filter((c) => norm(c.subject_name) === sn || norm(c.subject_name).includes(sn));
    if (narrowed.length) pool = narrowed;
  }

  const chapter_id = bestNameMatch(
    chapterLabel,
    pool.map((c) => ({ id: c.chapter_id, name: c.chapter_name })),
  );
  if (!chapter_id) return { chapter_id: null, topic_id: null };

  const chapter = catalog.find((c) => c.chapter_id === chapter_id);
  if (!chapter) return { chapter_id, topic_id: null };

  const topic_id = bestNameMatch(
    topicLabel,
    chapter.topics.map((t) => ({ id: t.topic_id, name: t.topic_name })),
  );
  return { chapter_id, topic_id };
}

/** Compact catalog lines for the classifier prompt (subject › chapter). */
export function formatCatalogHint(catalog: CurriculumChapter[], limit = 40): string {
  if (!catalog.length) return "";
  const lines = catalog.slice(0, limit).map((c) => `${c.subject_name} › ${c.chapter_name}`);
  return [
    "Prefer chapter/topic names from this exam catalog when tagging questions and notes.",
    "If nothing fits, leave chapter and topic null — do not invent a chapter.",
    ...lines,
  ].join("\n");
}
