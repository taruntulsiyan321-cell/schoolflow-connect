-- ═══════════════════════════════════════════════════════════════════════════
-- RECOVERY CONSTANTS — make the two homes checkable, and make the reader
-- honest about missing keys
--
-- 7C-A put the constants in two homes on purpose: a database function cannot
-- import a TypeScript module, and §10 forbids literals in either. That
-- reasoning is sound and there is no third option. But two homes holding one
-- fact is G9's exact shape, and "kept in sync" is a property that holds until
-- someone changes one. If RECOVERY_TRIGGER_COUNT is 5 in the table and 8 in
-- the module, nothing errors: recovery fires at one threshold, the UI
-- describes another, and the first person to notice is a confused student.
--
-- The design stays. What changes is that the agreement becomes checkable —
-- scripts/check-recovery-constants.mjs reads both and fails on any mismatch,
-- any key in one and not the other, and any undeclared asymmetry.
--
-- This migration does the two things that gate needs from the database side.
--
-- ── 1. _recovery_const does not do what its own comment says ───────────────
--
-- Its comment reads: "Raises rather than defaulting: a missing constant must
-- fail loudly, not silently behave as 0." The body contains no RAISE.
--
--     SELECT CASE WHEN c.value IS NULL
--            THEN (SELECT NULL::numeric WHERE false)
--            ELSE c.value END
--       FROM public.recovery_constants c WHERE c.key = _key;
--
-- A missing key matches no rows, and a SQL function declared RETURNS numeric
-- that selects no rows returns NULL. Measured before this migration:
--
--     existing=5  raised_on_missing=f  missing_is_null=t  five_ge_missing=<NULL>
--
-- That last column is the one that matters. A trigger asking
-- `IF _open_count >= public._recovery_const('RECOVERY_TRIGGER_COUNT')` with a
-- mistyped key evaluates NULL, which an IF treats as false, so the rule
-- silently never fires. Not "fires on every chapter" as the comment feared —
-- worse, because nothing happens at all and nothing is logged.
--
-- Rewritten to actually raise. CREATE OR REPLACE, never DROP: the grants
-- (authenticated, service_role) survive a replace and would be lost by a drop.
--
-- ── 2. Three constants existed in the module and not in the table ──────────
--
-- GENERATION_TARGET_SECONDS, GENERATION_MAX_RETRIES and REMINDER_MAX_PER_DAY
-- are plain numbers with no reason to be missing. They are added so the gate's
-- declared-asymmetry list stays as short as it can honestly be — every
-- exception on that list is a place the two homes are allowed to differ, and
-- a short list is easier to keep true than a long one.
--
-- After this, exactly two TS-only constants remain, both declared with a
-- reason the gate itself asserts:
--
--   RECOVERY_SESSION_SIZE   derived (tier0+tier1+tier2+tier3), so storing it
--                           would be a third home for a fact the other four
--                           already determine. The gate re-derives it.
--   VARIANT_CACHE_FIRST     boolean. recovery_constants.value is numeric, and
--                           encoding true as 1 is the type-lie that produces a
--                           `value > 0` bug later. If a database function ever
--                           needs it, that is the moment to give the table a
--                           boolean column — the gate will force the decision.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Prove the defect is live before fixing it ──────────────────────────────
-- G11: "a missing key now raises" proves nothing on its own if it always did.
DO $before$
DECLARE _v numeric; _raised boolean := false;
BEGIN
  BEGIN
    _v := public._recovery_const('NO_SUCH_KEY_PROBE');
  EXCEPTION WHEN others THEN
    _raised := true;
  END;

  IF _raised THEN
    RAISE EXCEPTION
      '_recovery_const already raises on a missing key, so there is nothing to fix here and the after-check would be vacuous. Re-read the body before assuming this migration is needed.';
  END IF;

  RAISE NOTICE 'confirmed: _recovery_const returns % for a missing key instead of raising.',
    coalesce(_v::text, 'NULL');
END
$before$;


-- ── 1. The reader ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._recovery_const(_key text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _v numeric;
BEGIN
  SELECT c.value INTO _v FROM public.recovery_constants c WHERE c.key = _key;

  -- A missing key is a typo or a constant someone forgot to add. Either way it
  -- must stop the caller, not hand back a NULL that every comparison quietly
  -- treats as false.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recovery constant % is not defined', _key
      USING HINT = 'Add it to public.recovery_constants AND to src/academic/recovery/constants.ts, then run scripts/check-recovery-constants.mjs.';
  END IF;

  -- A row that exists with a NULL value is the same failure wearing a row.
  IF _v IS NULL THEN
    RAISE EXCEPTION 'recovery constant % exists but its value is NULL', _key;
  END IF;

  RETURN _v;
END
$fn$;

COMMENT ON FUNCTION public._recovery_const(text) IS
  'Reads one tuning constant from public.recovery_constants. RAISES on a missing key or a NULL value — verified by the migration that wrote this, which first proved the previous version did not. A NULL here would make every threshold comparison evaluate NULL, which an IF treats as false, silently disabling the rule it guards. The other home for these values is src/academic/recovery/constants.ts; scripts/check-recovery-constants.mjs proves the two agree.';


-- ── 2. The three constants that were only in the module ────────────────────
INSERT INTO public.recovery_constants (key, value, spec_ref, rationale) VALUES
  ('GENERATION_TARGET_SECONDS', 120, '§4.1',
   'Target build time, not a timeout. The system must degrade by taking longer, never by failing or serving something worse.'),
  ('GENERATION_MAX_RETRIES', 5, '§4.1a',
   'AI calls fail for ordinary reasons at roughly one in a few hundred. At 210 students that is several times a week — invisible with retry, a broken screen without it.'),
  ('REMINDER_MAX_PER_DAY', 1, '§4.1b / §9',
   'At most one recovery-or-revision reminder a day, batched across chapters, stopping the moment the student starts. Nagging is how a paid feature gets muted.')
ON CONFLICT (key) DO UPDATE
  SET value     = EXCLUDED.value,
      spec_ref  = EXCLUDED.spec_ref,
      rationale = EXCLUDED.rationale,
      updated_at = now();


-- ── 3. Assert the post-state ───────────────────────────────────────────────
DO $after$
DECLARE _v numeric; _raised boolean := false; _n int;
BEGIN
  -- The reader now refuses a missing key.
  BEGIN
    _v := public._recovery_const('NO_SUCH_KEY_PROBE');
  EXCEPTION WHEN others THEN
    _raised := true;
  END;
  IF NOT _raised THEN
    RAISE EXCEPTION '_recovery_const still does not raise on a missing key.';
  END IF;

  -- And still answers a real one, so the fix did not simply break it.
  IF public._recovery_const('RECOVERY_TRIGGER_COUNT') <> 5 THEN
    RAISE EXCEPTION '_recovery_const no longer returns the trigger count correctly.';
  END IF;

  -- The grants survived the replace. A DROP would have silently taken them,
  -- and every 7C trigger runs as authenticated.
  IF NOT has_function_privilege('authenticated', 'public._recovery_const(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '_recovery_const lost its EXECUTE grant to authenticated.';
  END IF;

  -- The three keys this migration adds are present and readable through the
  -- reader, which is what it can prove locally. Deliberately NOT a count
  -- assertion: "the table holds 21 keys" is a snapshot that fails the next
  -- time a constant is legitimately added (G11). Whether the two homes AGREE
  -- is not knowable from inside the database at all — that is
  -- scripts/check-recovery-constants.mjs, which reads both.
  SELECT count(*) INTO _n
    FROM public.recovery_constants
   WHERE key IN ('GENERATION_TARGET_SECONDS', 'GENERATION_MAX_RETRIES', 'REMINDER_MAX_PER_DAY');
  IF _n <> 3 THEN
    RAISE EXCEPTION 'expected the 3 generation constants to be present, found %.', _n;
  END IF;

  IF public._recovery_const('GENERATION_MAX_RETRIES') <> 5
     OR public._recovery_const('REMINDER_MAX_PER_DAY') <> 1
     OR public._recovery_const('GENERATION_TARGET_SECONDS') <> 120 THEN
    RAISE EXCEPTION 'a newly added generation constant does not read back at its module value.';
  END IF;
END
$after$;

COMMIT;
