-- ═══════════════════════════════════════════════════════════════════════════
-- `attendance_locks` goes — the submission has been the lock since Chunk 4.7
--
-- Two verification files have been asserting this table is gone, and it was
-- still here. CHUNK47_VERIFY item 10 said "attendance_locks does not exist
-- anywhere: no table, no view, no policy, no code reference"; CHUNK2_VERIFY
-- section 7 expects `0` and measured `1`. Chunk 4.7 replaced the lock with
-- `attendance_submissions` — a day is locked because it was SUBMITTED, which
-- is one fact instead of two that can disagree (G9) — and the table it
-- replaced was never dropped.
--
-- ── MEASURED BEFORE DROPPING ──────────────────────────────────────────────
--
--     rows ................................. 0
--     inbound foreign keys ................. 0
--     functions mentioning it .............. 0
--     policies on other tables citing it ... 0
--     references in src/ ................... 0   (only the generated types.ts)
--
-- Nothing reads it, nothing writes it, and it has never held a row. The only
-- non-generated mentions in the repo are two comments about the migration
-- history and one stale entry in `lint-tenant-scope.mjs`'s table list.
--
-- ── IT IS ALSO AN UNFENCED SURFACE ────────────────────────────────────────
--
-- Its ACL is `anon=arwdDxtm` — the anon role holds INSERT, UPDATE and DELETE
-- on it — and its only SELECT policy is `USING (true)` for `authenticated`,
-- with no `same_school` predicate of any kind. RLS keeps anon out today only
-- because no policy names anon, and the read policy would show every
-- institution's locks to every signed-in user of any other institution if the
-- table ever held a row. A dead table is a fair place to leave a fence out; it
-- is not a fair place to leave one open.
--
-- ── WHY A DROP AND NOT A FENCE ────────────────────────────────────────────
--
-- Fencing it would keep a second home for "is this day closed?" alive, which is
-- the thing Chunk 4.7 removed on purpose. The lock is the submission.
--
-- The rollback recreates the table, its primary key, RLS, all three policies
-- and the grants exactly as measured, so this is reversible. There is no data
-- to lose: the table is empty.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $premise$
DECLARE _n int; _sites text;
BEGIN
  SELECT count(*) INTO _n FROM public.attendance_locks;
  IF _n > 0 THEN
    RAISE EXCEPTION
      'ABORT: attendance_locks holds % row(s). It was measured empty; something now uses it. Do not drop it.', _n;
  END IF;

  SELECT count(*) INTO _n
    FROM pg_constraint con JOIN pg_class t ON t.oid = con.confrelid
   WHERE t.relname = 'attendance_locks';
  IF _n > 0 THEN
    RAISE EXCEPTION 'ABORT: % foreign key(s) point at attendance_locks', _n;
  END IF;

  SELECT string_agg(site, ', ') INTO _sites FROM (
    SELECT 'function ' || p.proname AS site
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) ILIKE '%attendance_locks%'
    UNION ALL
    SELECT 'policy ' || c.relname || '.' || pol.polname
      FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
     WHERE c.relname <> 'attendance_locks'
       AND coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
        || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ILIKE '%attendance_locks%'
  ) s;
  IF _sites IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: attendance_locks is still referenced by: %', _sites;
  END IF;
END $premise$;

DROP TABLE public.attendance_locks;

DO $verify$
DECLARE _n int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'attendance_locks') THEN
    RAISE EXCEPTION 'ABORT: attendance_locks survived the drop';
  END IF;

  -- POSITIVE CONTROL. The replacement must be here and populated, or this
  -- migration has removed the only record of which days are closed. "The table
  -- is gone" is also what a broken attendance feature looks like.
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'attendance_submissions') THEN
    RAISE EXCEPTION 'ABORT: attendance_submissions is missing -- nothing records a closed day';
  END IF;

  SELECT count(*) INTO _n FROM public.attendance_submissions;
  IF _n = 0 THEN
    RAISE EXCEPTION 'ABORT: attendance_submissions is EMPTY -- the lock this replaces records nothing';
  END IF;

  RAISE NOTICE 'attendance_locks dropped; % submission(s) carry the lock instead.', _n;
END $verify$;

COMMIT;
