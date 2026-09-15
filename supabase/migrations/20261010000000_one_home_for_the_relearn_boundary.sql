-- ════════════════════════════════════════════════════════════════════════════
-- ONE HOME FOR THE RELEARN BOUNDARY
-- ════════════════════════════════════════════════════════════════════════════
--
-- 20261006000000 created a recovery_constants row called RECOVERY_RELEARN_ABOVE
-- holding 8, while src/academic/recovery/constants.ts declares it as
--
--     export const RECOVERY_RELEARN_ABOVE = RECOVERY_WIDE_MAX_MISTAKES;
--
-- i.e. derived, with no independent value of its own. `npm run
-- check:recovery-constants` refused that combination and was right to:
--
--     RECOVERY_RELEARN_ABOVE is declared derived but now exists in the table
--     too. Either remove the declaration or remove the row — a declared
--     asymmetry that is no longer true is worse than none.
--
-- Two numbers that must always be equal, in two places, is the split-brain
-- that gate exists to prevent. Tune the wide band and the relearn boundary
-- silently stays where it was; every session between 9 and the old value then
-- builds a ladder nobody intended.
--
-- The boundary is not an independent judgment. It IS the top of the wide band:
-- one more mistake than wide mode can handle is the point at which drilling
-- stops being the answer. So the row goes and the two readers read
-- RECOVERY_WIDE_MAX_MISTAKES directly.
--
-- Recorded rather than quietly fixed: the duplicate was introduced three
-- migrations ago in this same piece of work, and the gate caught it. The fix
-- is to remove the duplicate, never to relax the gate.
--
-- ROLLBACK: supabase/migrations/rollback/20261010000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── The two readers ────────────────────────────────────────────────────────
-- Rewritten by substitution against the LIVE bodies rather than restated from
-- a file: these functions have been rewritten in place across four migrations
-- and a CREATE OR REPLACE typed from an older file would silently revert
-- whichever change came last.
--
-- Line endings are normalised first. Live bodies are stored with CRLF, an
-- anchor written with LF matches nothing, and a substitution that matches
-- nothing fails OPEN — the guard below is what turns that into an error.

DO $rewrite$
DECLARE
  _fn   text;
  _def  text;
  _new  text;
  _hits int;
BEGIN
  FOREACH _fn IN ARRAY ARRAY['_recovery_session_plan_for', 'rpc_student_recovery_queue'] LOOP
    SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = _fn;

    IF _def IS NULL THEN
      RAISE EXCEPTION 'function public.% not found', _fn;
    END IF;
    IF position(E'\r' IN _def) > 0 THEN
      RAISE EXCEPTION 'a carriage return survived normalisation in %', _fn;
    END IF;

    _hits := (length(_def) - length(replace(_def, '''RECOVERY_RELEARN_ABOVE''', '')))
             / length('''RECOVERY_RELEARN_ABOVE''');
    IF _hits = 0 THEN
      RAISE EXCEPTION '% does not read RECOVERY_RELEARN_ABOVE — the anchor matched nothing', _fn;
    END IF;

    _new := replace(_def, '''RECOVERY_RELEARN_ABOVE''', '''RECOVERY_WIDE_MAX_MISTAKES''');

    IF _new = _def THEN
      RAISE EXCEPTION 'the substitution changed nothing in % — it would have failed open', _fn;
    END IF;

    EXECUTE _new;
    RAISE NOTICE 'rewrote % (% occurrence(s))', _fn, _hits;
  END LOOP;
END $rewrite$;

-- ── The duplicate row ──────────────────────────────────────────────────────

DELETE FROM public.recovery_constants WHERE key = 'RECOVERY_RELEARN_ABOVE';

DO $check$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.recovery_constants WHERE key = 'RECOVERY_RELEARN_ABOVE';
  IF _n <> 0 THEN
    RAISE EXCEPTION 'the duplicate row is still present';
  END IF;

  -- Nothing may still read it. _recovery_const raises on a missing key, and it
  -- would do so for one student, on one chapter, long after this migration.
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) LIKE '%RECOVERY_RELEARN_ABOVE%';
  IF _n <> 0 THEN
    RAISE EXCEPTION 'RECOVERY_RELEARN_ABOVE is still read by % function(s) but no longer exists', _n;
  END IF;

  -- And the boundary still answers, through its one remaining home.
  IF public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int <> 8 THEN
    RAISE EXCEPTION 'RECOVERY_WIDE_MAX_MISTAKES is not 8 — the boundary moved unintentionally';
  END IF;
END $check$;

COMMIT;
