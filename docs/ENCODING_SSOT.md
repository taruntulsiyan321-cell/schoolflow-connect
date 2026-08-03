# Encoding APPLY invariant (UTF-8)

**Canonical repair (multi-subject):** paste [`APPLY_UTF8_MOJIBAKE_REPAIR.sql`](./APPLY_UTF8_MOJIBAKE_REPAIR.sql) in the Supabase SQL Editor as **UTF-8**.

**Hindi Practice CHAPTER chips (mixed C1+CP1252 gap):** paste [`APPLY_HINDI_CHAPTER_MOJIBAKE_REPAIR.sql`](./APPLY_HINDI_CHAPTER_MOJIBAKE_REPAIR.sql) — supersedes the UTF8 APPLY function with a path that normalizes CP1252 glyphs before LATIN1→UTF8 so `व्याकरण` / `आलो आँधारि` mojibake actually repairs. Also aligns Hindi chapters to taxonomy and collapses dash duplicates.

**Auth tenant (AUTH-C2):** paste [APPLY_AUTH_SIGNUP_NO_DEFAULT_SCHOOL.sql](./APPLY_AUTH_SIGNUP_NO_DEFAULT_SCHOOL.sql) so self-signup profiles are not auto-bound to default_school_id().

## Rules

1. One strategy: reverse UTF-8-as-CP1252/Latin-1 on signature-matched mojibake (`à¤` / `à¥` / `â€` / `Ï€` …).
2. Screenshot OCR of `à¤µ…` often looks like `äèµ` / `äèµ¾¥` — **same class**, not a new encoding.
3. Do NOT delete seed batches to fix encoding.
4. Do NOT run superseded `APPLY_DEVANAGARI_MOJIBAKE_REPAIR.sql`.
5. Client SSOT: `src/lib/utf8MojibakeRepair.ts` → `fixUtf8Content` / taxonomy `fixMojibake`.
6. Apply new seeds/migrations with UTF-8 clients only.

Verify:

```sql
SELECT count(*) FROM question_bank WHERE chapter ~ 'à¤|à¥';  -- expect 0
SELECT DISTINCT chapter FROM question_bank
  WHERE subject ILIKE 'Hindi' ORDER BY 1;
```
