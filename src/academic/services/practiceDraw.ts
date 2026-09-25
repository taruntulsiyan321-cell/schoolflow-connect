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
