/**
 * Counted nouns, so the app never says "1 mistakes".
 *
 * The bug this exists to kill appeared on two screens with the same shape —
 * Recovery topic cards and Mistake Book cards — because each interpolated a
 * count next to a hardcoded plural. Both now call this.
 *
 * English only, and deliberately so: the app ships one language today, and a
 * fake i18n layer that nothing translates is worse than an honest helper.
 * When a second language lands this is the single place that has to change.
 */

/** "1 mistake" · "2 mistakes" · "0 mistakes". */
export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}

/** The noun alone, uncounted — for when the number is rendered separately. */
export function pluraliseWord(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? `${singular}s`;
}
