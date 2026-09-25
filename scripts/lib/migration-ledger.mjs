/**
 * How a migration file and a ledger row name each other — the one rule both
 * db:check-migrations and the preflight (check-foreign-migrations) apply.
 *
 * A migration is its FULL NAME: the file name without ".sql", which is what
 * scripts/apply-one-migration.mjs records in public.schema_migrations.version.
 *
 * Both gates used to match on the 14-digit timestamp alone, from when the
 * ledger held bare timestamps. It holds none now (565 rows, 2026-09-25), and
 * 14 timestamps are shared by two files each. Matching on the stamp called a
 * file applied because ITS NEIGHBOUR was: five migrations written 2026-09-23
 * (20261054000000..20261058000000, among them the variant-mistake merge) and
 * three from 2026-09-03 were never applied, and db:check-migrations passed.
 */

export const migrationName = (file) => file.replace(/\.sql$/, "");

const stampOf = (s) => (s.match(/^(\d{14})/) ?? [])[1] ?? null;

/** Files whose full name is not in the ledger, sorted. */
export function unappliedFiles(files, ledgerVersions) {
  const applied = new Set(ledgerVersions);
  return files.filter((f) => !applied.has(migrationName(f))).sort();
}

/** Ledger rows with no file of that full name, sorted. */
export function ledgerRowsWithoutFile(files, ledgerVersions) {
  const names = new Set(files.map(migrationName));
  return ledgerVersions.filter((v) => !names.has(v)).sort();
}

/**
 * Whether a rollback script covers a migration. A rollback names what it
 * reverses — `<name>.rollback.sql`, or the name in its text. Older rollbacks
 * name only timestamps (20260828110000_chunk67_batch1_down.sql reverses three
 * migrations by stamp); a bare stamp covers a migration only when no other
 * migration shares it, because otherwise it cannot say which one it reverses.
 *
 * @param {string} name        the migration's full name
 * @param {Array<{file: string, text: string}>} rollbacks
 * @param {Set<string>} sharedStamps  timestamps two or more migrations carry
 */
export function rollbackCovers(name, rollbacks, sharedStamps) {
  const stamp = stampOf(name);
  const byStamp = stamp !== null && !sharedStamps.has(stamp);
  return rollbacks.some(({ file, text }) =>
    file.startsWith(`${name}.`) || text.includes(name) ||
    (byStamp && (stampOf(file) === stamp || new RegExp(`(?<!\\d)${stamp}(?!\\d)`).test(text))));
}

/** Timestamps carried by more than one migration file. */
export function sharedStamps(files) {
  const seen = new Map();
  for (const f of files) {
    const s = stampOf(f);
    if (s) seen.set(s, (seen.get(s) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([s]) => s));
}
