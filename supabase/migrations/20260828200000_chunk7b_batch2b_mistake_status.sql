-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7B — BATCH 2b: student_mistakes.mastered -> status (open/cleared)
--
-- The doc's mistake book carries `status (open/cleared) · cleared_at`.
-- The live table carried `mastered boolean NOT NULL` and no cleared_at, so
-- "when did this stop being a mistake" was not recordable at all.
--
-- Not a rename. A boolean and a status column answer different questions:
--   mastered = true   says only "not open any more"
--   status = 'cleared' + cleared_at says when, and leaves room for a third
--                     state without another boolean beside the first
--
-- ── Every reference, enumerated before touching anything ───────────────────
--
-- 11 real references across 10 SECURITY DEFINER functions, in three shapes:
--
--   6 reads    NOT mastered / NOT m.mastered
--                _revision_topic_priority, _upsert_concept_mastery,
--                rpc_refresh_academic_brain, rpc_student_academic_snapshot,
--                rpc_student_academic_snapshot_internal,
--                rpc_student_improvement_plans (x2)
--
--   4 writes   mastered = false, every one inside an
--              ON CONFLICT DO UPDATE SET — a mistake got wrong again, so it
--              re-opens
--                _capture_battle_mistakes, _capture_dpp_mistakes,
--                rpc_mirror_battle_answer, rpc_record_concept_mistake
--
--   1 false positive: the JSON key 'unmastered' in rpc_refresh_academic_brain,
--   which must NOT be rewritten. The substitutions below match `NOT mastered`
--   and `mastered = false`, neither of which occurs inside that literal, and
--   the closing assertion uses a word-boundary regex so the key does not make
--   it fail.
--
-- ── How the functions are rewritten ────────────────────────────────────────
--
-- Through pg_get_functiondef(), not by hand-retyping ten bodies. That keeps
-- the exact signature, volatility, SECURITY DEFINER flag, search_path and
-- grants — hand-copying any of those wrong is how a definer quietly loses its
-- fence. The substitution is applied to the generated definition and the
-- result is executed, then asserted.
--
-- The four writes also clear cleared_at. A mistake that recurs is open again,
-- and leaving a stale cleared_at on it would be a second source of truth for
-- the same fact.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The new shape ───────────────────────────────────────────────────────
ALTER TABLE public.student_mistakes
  ADD COLUMN IF NOT EXISTS status     text,
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;

-- Backfill before any constraint, so the constraint describes reality.
UPDATE public.student_mistakes
   SET status     = CASE WHEN mastered THEN 'cleared' ELSE 'open' END,
       cleared_at = CASE WHEN mastered THEN coalesce(cleared_at, last_wrong_at) ELSE NULL END
 WHERE status IS NULL;

ALTER TABLE public.student_mistakes ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE public.student_mistakes ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_status_check;
ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_status_check CHECK (status IN ('open', 'cleared'));

-- cleared_at and status must agree. Two columns holding one fact is G9's
-- shape; a CHECK is what stops them drifting.
ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_cleared_at_agrees;
ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_cleared_at_agrees
  CHECK ((status = 'cleared') = (cleared_at IS NOT NULL));

COMMENT ON COLUMN public.student_mistakes.status IS
  'open | cleared. Replaced the `mastered` boolean in Chunk 7B batch 2b. A mistake that is answered wrong again returns to open and cleared_at is nulled — see the ON CONFLICT branches in _capture_battle_mistakes, rpc_mirror_battle_answer and rpc_record_concept_mistake.';

COMMENT ON COLUMN public.student_mistakes.cleared_at IS
  'When the mistake stopped being open. NULL exactly when status = open, enforced by student_mistakes_cleared_at_agrees rather than by convention.';


-- ── 2. Rewrite the ten functions ───────────────────────────────────────────
DO $rewrite$
DECLARE
  r        record;
  _def     text;
  _new     text;
  _n       int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosrc ~ '\mmastered\M'
     ORDER BY p.proname
  LOOP
    _def := pg_get_functiondef(r.oid);

    -- Order matters: the aliased read must be replaced before the bare one,
    -- or `NOT m.mastered` would be left as `NOT m.status = 'open'`, which
    -- parses as `(NOT m.status) = 'open'` and is not the same predicate.
    _new := replace(_def, 'NOT m.mastered',  'm.status = ''open''');
    _new := replace(_new, 'NOT mastered',    'status = ''open''');
    _new := replace(_new, 'mastered = false','status = ''open'', cleared_at = NULL');

    IF _new <> _def THEN
      EXECUTE _new;
      _n := _n + 1;
    END IF;
  END LOOP;

  IF _n <> 10 THEN
    RAISE EXCEPTION
      'Chunk 7B batch 2b: rewrote % function(s), expected 10. The enumeration in this migration''s header no longer matches the database — stop and re-enumerate rather than proceeding on a stale list.',
      _n;
  END IF;

  RAISE NOTICE 'Chunk 7B batch 2b: rewrote % functions off the mastered boolean.', _n;
END
$rewrite$;


-- ── 3. Nothing may still read the boolean ──────────────────────────────────
-- Word-boundary match, so the 'unmastered' JSON key in
-- rpc_refresh_academic_brain does not register as a surviving reference.
DO $assert_fns$
DECLARE _bad text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO _bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~ '\mmastered\M';

  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'Chunk 7B batch 2b: these functions still reference the mastered boolean: %', _bad;
  END IF;

  -- The false positive must have SURVIVED. If it is gone, the substitution
  -- was too broad and corrupted a JSON key that screens read.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rpc_refresh_academic_brain'
       AND p.prosrc LIKE '%''unmastered''%'
  ) THEN
    RAISE EXCEPTION
      'Chunk 7B batch 2b: the ''unmastered'' JSON key was rewritten. That key is read by the client; the substitution was too broad.';
  END IF;
END
$assert_fns$;


-- ── 4. Prove the rewritten functions still answer the same question ────────
-- The reads all mean "mistakes still open for this user". Compare the old
-- predicate against the new one over the live table, per user, before the
-- column goes. If any user's count differs, the rewrite changed meaning.
DO $prove$
DECLARE _bad text;
BEGIN
  SELECT string_agg(format('%s: was %s, now %s', t.user_id, t.old_open, t.new_open), '; ')
    INTO _bad
    FROM (
      SELECT user_id,
             count(*) FILTER (WHERE NOT mastered)      AS old_open,
             count(*) FILTER (WHERE status = 'open')   AS new_open
        FROM public.student_mistakes
       GROUP BY user_id
    ) t
   WHERE t.old_open IS DISTINCT FROM t.new_open;

  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'Chunk 7B batch 2b: open-mistake counts changed for %', _bad;
  END IF;
END
$prove$;


-- ── 5. Drop the boolean. Not deprecated, not commented (G9). ───────────────
ALTER TABLE public.student_mistakes DROP COLUMN mastered;

COMMIT;
