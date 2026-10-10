/**
 * Which questions a practice session asks, out of the pool its filters admit.
 *
 * A session used to be a uniform random draw from the whole pool, so nothing
 * kept a student from being asked yesterday's ten questions again today. The
 * rule now: questions the student has never answered come first, in random
 * order. Only when fewer unseen questions remain than the session needs is it
 * topped up from ones already answered — the longest-ago first — so a repeat
 * happens only once the unseen pool runs short, and the least recent repeats
 * before the most recent. The drawn questions are then shuffled, so a top-up
 * is not always the last few questions.
 *
 * Draws by id (Incorrect, Skipped, Bookmarked) are repeats on purpose and do
 * not come through here.
 */

/** When the student last answered each bank question, as ISO timestamps. */
export type LastSeen = ReadonlyMap<string, string>;

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function drawFreshFirst<T extends { id: string }>(
  pool: readonly T[],
  lastSeen: LastSeen,
  limit: number,
  random: () => number = Math.random,
): T[] {
  const unseen = shuffle(pool.filter((q) => !lastSeen.has(q.id)), random);
  if (unseen.length >= limit) return unseen.slice(0, limit);

  // Shuffled before the stable sort, so questions last seen at the same
  // moment (one session's worth) are topped up in random order.
  const seen = shuffle(pool.filter((q) => lastSeen.has(q.id)), random)
    .sort((a, b) => lastSeen.get(a.id)!.localeCompare(lastSeen.get(b.id)!));
  return shuffle([...unseen, ...seen.slice(0, limit - unseen.length)], random);
}

/**
 * A session in the real paper's mix of forms (docs/TODO.md C7). Each form
 * besides direct questions gets its share of the session — the paper's share,
 * rounded — from questions of that form the student has NEVER answered: the
 * bank holds few of them, and meeting the same three match questions every
 * session is repetition, not the paper's mix. The rest of the session is what
 * the paper's rest is — direct questions — never met ones first; then other
 * forms never met; then, as drawFreshFirst does, the longest-ago answered. So
 * following the mix never makes a session shorter, and the fill does not bend
 * the shape with forms past their share while direct questions remain. No mix
 * (a school account, a drill, an unreadable mix): the plain draw.
 *
 * `mix` is the paper's question count per form (rpc_exam_form_mix), e.g.
 * { mcq: 24, statements: 5, match: 5, sequence: 6, case_based: 10 }.
 */
export function drawInMix<T extends { id: string }>(
  pool: readonly T[],
  lastSeen: LastSeen,
  limit: number,
  mix: Readonly<Record<string, number>> | null,
  formOf: (q: T) => string | null,
  random: () => number = Math.random,
): T[] {
  const total = mix ? Object.values(mix).reduce((n, v) => n + v, 0) : 0;
  if (!mix || total <= 0) return drawFreshFirst(pool, lastSeen, limit, random);
  const chosen: T[] = [];
  for (const [form, n] of Object.entries(mix)) {
    if (form === "mcq") continue; // direct questions are what fills the rest
    const want = Math.min(Math.round((limit * n) / total), limit - chosen.length);
    if (want <= 0) continue;
    chosen.push(...shuffle(pool.filter((q) => formOf(q) === form && !lastSeen.has(q.id)), random).slice(0, want));
  }
  const taken = new Set(chosen.map((q) => q.id));
  const remaining = pool.filter((q) => !taken.has(q.id));
  const direct = (q: T) => (formOf(q) ?? "mcq") === "mcq";
  const need = limit - chosen.length;
  let rest = [
    ...shuffle(remaining.filter((q) => direct(q) && !lastSeen.has(q.id)), random),
    ...shuffle(remaining.filter((q) => !direct(q) && !lastSeen.has(q.id)), random),
  ].slice(0, need);
  if (rest.length < need) {
    rest = [...rest, ...drawFreshFirst(remaining.filter((q) => lastSeen.has(q.id)), lastSeen, need - rest.length, random)];
  }
  return shuffle([...chosen, ...rest], random);
}

/** The latest answer per question, from the student's attempt rows. */
export function lastSeenFromAttempts(
  attempts: ReadonlyArray<{ bank_question_id: string | null; created_at: string }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of attempts) {
    if (!a.bank_question_id) continue;
    const prev = out.get(a.bank_question_id);
    if (!prev || a.created_at > prev) out.set(a.bank_question_id, a.created_at);
  }
  return out;
}
