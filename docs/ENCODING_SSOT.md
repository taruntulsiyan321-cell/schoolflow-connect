# Encoding APPLY invariant (UTF-8)

**Canonical repair:** paste [`APPLY_UTF8_MOJIBAKE_REPAIR.sql`](./APPLY_UTF8_MOJIBAKE_REPAIR.sql) in the Supabase SQL Editor as **UTF-8**.

## Rules

1. One strategy: `convert_from(convert_to(s, 'WIN1252'), 'UTF8')` on signature-matched mojibake.
2. Do NOT delete seed batches to fix encoding.
3. Do NOT run superseded `APPLY_DEVANAGARI_MOJIBAKE_REPAIR.sql`.
4. Client SSOT: `src/lib/utf8MojibakeRepair.ts` → `fixUtf8Content`.
5. Apply new seeds/migrations with UTF-8 clients only.

Verify: `SELECT count(*) FROM question_bank WHERE chapter ~ 'à¤|à¥';` expect 0.
