-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — Chunk 7B batch 2b (20260828200000_chunk7b_batch2b_mistake_status)
--
-- Reverses student_mistakes.status (open/cleared) + cleared_at back to the
-- `mastered` boolean, and rewrites the ten SECURITY DEFINER functions back.
--
-- THE SUBSTITUTION TRAP, IN REVERSE. The forward migration applied, in order:
--
--     'NOT m.mastered'   -> 'm.status = ''open'''
--     'NOT mastered'     -> 'status = ''open'''
--     'mastered = false' -> 'status = ''open'', cleared_at = NULL'
--
-- Reversing it needs the OPPOSITE order, and for the same reason the forward
-- order mattered. Two of the three replacement strings are prefixes of each
-- other:
--
--   * 'status = ''open'', cleared_at = NULL' CONTAINS 'status = ''open'''.
--     Reverse the bare read first and the write form is left as
--     'mastered = false, cleared_at = NULL' — a column that no longer exists,
--     in a SET list. So the WRITE form must be reversed first.
--   * 'm.status = ''open''' CONTAINS 'status = ''open'''. Reverse the bare
--     one first and the aliased read becomes 'm.NOT mastered', which does not
--     parse. So the ALIASED read must be reversed before the bare one.
--
-- Hence: write form, then aliased read, then bare read. Getting this wrong
-- does not error — it silently inverts or corrupts the mistake book, which is
-- exactly the failure the forward migration was written to avoid.
--
-- The 'unmastered' JSON key in rpc_refresh_academic_brain is untouched here
-- for the same reason it was untouched going forward: none of the three
-- patterns occurs inside that literal, and the assertion uses a word-boundary
-- match so the key cannot make it pass or fail spuriously.
--
-- LIMIT — cleared_at is dropped and its values are lost. The boolean cannot
-- carry a timestamp. A mistake that was cleared comes back as mastered=true
-- with no record of when. Nothing reads that value today; if something does by
-- the time this is run, capture it first:
--   CREATE TABLE _cleared_at_backup AS
--     SELECT id, cleared_at FROM public.student_mistakes WHERE cleared_at IS NOT NULL;
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The boolean comes back, populated from status ────────────────────────
ALTER TABLE public.student_mistakes
  ADD COLUMN IF NOT EXISTS mastered boolean;

UPDATE public.student_mistakes
   SET mastered = (status = 'cleared');

ALTER TABLE public.student_mistakes ALTER COLUMN mastered SET DEFAULT false;
ALTER TABLE public.student_mistakes ALTER COLUMN mastered SET NOT NULL;

-- ── 2. Rewrite the ten functions back ───────────────────────────────────────
-- Scoped to functions that actually touch student_mistakes, so an unrelated
-- function using the very common literal `status = 'open'` for some other
-- table is never rewritten. The forward migration could select on the word
-- `mastered` alone because that word was unique to this feature; `status` is
-- not, so this direction needs the tighter predicate.
DO $rewrite$
DECLARE
  r    record;
  _def text;
  _new text;
  _n   int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosrc ~ 'student_mistakes'
       AND p.prosrc ~ 'status'
     ORDER BY p.proname
  LOOP
    _def := pg_get_functiondef(r.oid);

    -- Order matters. See the header.
    _new := replace(_def, 'status = ''open'', cleared_at = NULL', 'mastered = false');
    _new := replace(_new, 'm.status = ''open''',                  'NOT m.mastered');
    _new := replace(_new, 'status = ''open''',                    'NOT mastered');

    IF _new <> _def THEN
      EXECUTE _new;
      _n := _n + 1;
    END IF;
  END LOOP;

  IF _n <> 10 THEN
    RAISE EXCEPTION
      'Chunk 7B batch 2b rollback: rewrote % function(s), expected 10. The set of functions reading student_mistakes has changed since the forward migration — re-enumerate rather than proceeding on a stale list.',
      _n;
  END IF;

  RAISE NOTICE 'Chunk 7B batch 2b rollback: rewrote % functions back onto the mastered boolean.', _n;
END
$rewrite$;

-- ── 3. Assert the rewrite landed ────────────────────────────────────────────
-- The forward migration's closing assertion was "nothing still says mastered".
-- The naive mirror of it — "nothing still says status" — is WRONG, and this
-- comment exists because it was written that way first and caught here.
--
-- `status` is one of the most common column names in this schema. Scoping the
-- check to functions that merely MENTION student_mistakes still swept up:
--
--   rpc_finish_battle                 SELECT status FROM public.battles
--   rpc_student_academic_snapshot     hs.status / att.status (homework, attendance)
--   rpc_refresh_academic_brain        status IN ('pending','in_progress')  (recovery)
--
-- none of which is a student_mistakes read. Exactly the false-positive class
-- the forward migration guarded against with the 'unmastered' JSON key, in
-- the other direction: there the risk was rewriting something that should not
-- be touched, here it was failing on something that was never wrong.
--
-- So assert the two things that ARE unambiguous:
--   a) the boolean is back in exactly the 10 functions it left, and
--   b) no student_mistakes-specific artefact of the forward substitution
--      survives. `m.status = 'open'` and the write form carrying cleared_at
--      only ever existed as products of that substitution.
--
-- \mmastered\M is a word-boundary match, so the 'unmastered' JSON key in
-- rpc_refresh_academic_brain does not count toward (a) — the same reason the
-- forward migration used it.
DO $assert_fns$
DECLARE
  _n   int;
  _bad text;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.prosrc ~ '\mmastered\M';

  IF _n <> 10 THEN
    RAISE EXCEPTION
      'Chunk 7B batch 2b rollback: % function(s) reference the mastered boolean, expected 10.', _n;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO _bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND (p.prosrc LIKE '%m.status = ''open''%'
       OR p.prosrc LIKE '%status = ''open'', cleared_at = NULL%');

  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION
      'Chunk 7B batch 2b rollback: these functions still carry a student_mistakes status artefact: %',
      _bad;
  END IF;
END
$assert_fns$;

-- ── 4. Drop the new shape ───────────────────────────────────────────────────
ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_cleared_at_agrees;
ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_status_check;
ALTER TABLE public.student_mistakes DROP COLUMN IF EXISTS cleared_at;
ALTER TABLE public.student_mistakes DROP COLUMN IF EXISTS status;

COMMIT;
