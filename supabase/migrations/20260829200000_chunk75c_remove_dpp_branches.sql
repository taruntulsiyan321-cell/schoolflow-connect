-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7.5c — the DPP branches, the column, and the badge codes
--
-- Fifteen function bodies, one column, two badge codes. 7.5 verification item
-- 4 requires zero references to dpp anywhere — schema, functions, data.
--
-- ── One ordered pass, not fifteen bespoke edits ───────────────────────────
--
-- Four substitution traps came out of this chunk already. The case for a
-- single pass is that it removes what produced all four: fifteen separately
-- hand-matched literals, each able to match nothing and fail open (G15).
--
-- ── The mapping is NOT total, and the first draft claimed it was ──────────
--
-- `dpps.subject` has no counterpart. A test resolves its subject through
-- section_subject (§10.22), so `tests` has no subject column at all. Two
-- bodies read it.
--
-- That draft failed loudly only because CREATE OR REPLACE validates a
-- SQL-language body. Both offenders happen to be LANGUAGE sql; a plpgsql body
-- would have been accepted and failed at run time instead.
--
-- Deeper still: both read per-question answers for a SUBMITTED attempt, and
-- 7.5b purges those at submit (§10.8). A straight rename would have left each
-- silently returning nothing — G15's fail-open shape reached from the other
-- direction, and invisible to a test that only checks the query runs.
--
-- What survives a submitted test is the mark and the WRONG answers in
-- student_mistakes, so that is what they now read. Both fixes are applied
-- INSIDE the pass, before anything is executed: a second pass afterwards
-- would have to repair a body the first pass had already installed, and the
-- first pass raises before it gets there.
--
-- A consequence worth stating: neither can populate a "strong areas" list any
-- more, because only wrong answers persist. §10.8 says strong areas are never
-- surfaced anywhere, so that is the rule landing, not a regression.
--
-- For everything else the mapping holds. Checked against the heaviest body
-- (_exam_readiness, 17 references) rather than assumed:
--
--   dpp_attempts.dpp_id / .status / .user_id  ->  test_attempts.test_id / .status / .user_id
--   status values 'in_progress' | 'submitted' ->  identical on test_attempts
--   dpp_count                                 ->  test_count (renamed below)
--   _dpp_pct / _dpp_done / _dpp_total         ->  locals
--   'dpp_completion_pct'                      ->  a JSON key the client reads
--
-- ── Order is the correctness argument ─────────────────────────────────────
--
-- Longest token first. Replacing `dpp` before `dpp_count` leaves `testcount`;
-- replacing `dpps` after `dpp_` turns `dpp_attempts` into `test_sattempts`.
-- The list is sorted so no pattern is a prefix of a later one.
--
-- ── _bump_academic_activity needs DROP, not REPLACE ───────────────────────
--
-- Its second parameter is named `_dpp`, and Postgres cannot rename an input
-- parameter through CREATE OR REPLACE. Both overloads are dropped and
-- recreated. Verified safe first: all four callers (rpc_complete_revision,
-- rpc_finish_battle, rpc_finish_practice_session, rpc_test_submit) pass
-- arguments POSITIONALLY, so a rename cannot break them. A named-argument
-- caller would have.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The column ─────────────────────────────────────────────────────────
DO $col$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'academic_daily_activity'
       AND column_name = 'dpp_count'
  ) THEN
    RAISE EXCEPTION 'academic_daily_activity.dpp_count does not exist — refusing to report a no-op rename as success (G15)';
  END IF;
END
$col$;

ALTER TABLE public.academic_daily_activity RENAME COLUMN dpp_count TO test_count;

-- ── 2. Capture, rewrite, replay ───────────────────────────────────────────
DO $rewrite$
DECLARE
  r     record;
  _def  text;
  _new  text;
  _n    int := 0;
  _fix  int := 0;
  _defs text[] := ARRAY[]::text[];
BEGIN
  -- Collect FIRST: the loop drops and recreates functions, and reading pg_proc
  -- while mutating it would be reading a moving target.
  FOR r IN
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) ~* 'dpp'   -- case-INSENSITIVE; see below
     ORDER BY p.proname
  LOOP
    _def := r.def;

    _new := replace(_def, 'dpp_completion_pct', 'test_completion_pct');
    _new := replace(_new, 'dpp_attempts',       'test_attempts');
    _new := replace(_new, 'dpp_questions',      'test_questions');
    _new := replace(_new, 'dpp_answers',        'test_answers');
    _new := replace(_new, 'dpp_perfect',        'test_perfect');
    _new := replace(_new, 'dpp_count',          'test_count');
    _new := replace(_new, 'first_dpp',          'first_test');
    _new := replace(_new, 'dpp_id',             'test_id');
    _new := replace(_new, 'dpps',               'tests');
    _new := replace(_new, '_dpp',               '_test');
    _new := replace(_new, 'dpp',                'test');

    -- Uppercase DPP, in user-facing strings. The collector above is ~* rather
    -- than ~ because of exactly this: _rule_improvement_plan tells a student
    -- to "Solve 5 easy DPP questions" and rpc_parent_weekly_digest tells a
    -- parent to "Encourage daily DPP and revision". A case-sensitive collector
    -- skipped both, and only the case-INSENSITIVE closing assertion caught
    -- them — the checker was stricter than the thing it checked, which is the
    -- one direction that fails safe.
    --
    -- These are the only DPP references a human ever actually reads, so they
    -- are also the ones that would have survived longest.
    _new := replace(_new, 'DPP',                'Test');

    -- The two the pass cannot reach, repaired before anything is executed.
    IF r.proname = '_weak_topics_for_user' THEN
      _new := replace(_new,
        'SELECT d.subject, d.chapter, d.topic,' || chr(10) ||
        '           count(*)::int AS attempts,' || chr(10) ||
        '           count(*) FILTER (WHERE da.is_correct)::int AS correct' || chr(10) ||
        '    FROM public.test_attempts att' || chr(10) ||
        '    JOIN public.tests d ON d.id = att.test_id' || chr(10) ||
        '    JOIN public.test_answers da ON da.attempt_id = att.id' || chr(10) ||
        '    WHERE att.user_id = _uid AND att.status = ''submitted''' || chr(10) ||
        '    GROUP BY d.subject, d.chapter, d.topic',
        '-- Per-question test answers are purged at submit (§10.8). What a' || chr(10) ||
        '    -- test leaves behind is its wrong answers, in student_mistakes.' || chr(10) ||
        '    SELECT COALESCE(sm.subject, ''General'') AS subject,' || chr(10) ||
        '           sm.chapter,' || chr(10) ||
        '           COALESCE(NULLIF(sm.concept, ''''), sm.topic, sm.chapter) AS topic,' || chr(10) ||
        '           count(*)::int AS attempts,' || chr(10) ||
        '           0::int AS correct' || chr(10) ||
        '    FROM public.student_mistakes sm' || chr(10) ||
        '    WHERE sm.user_id = _uid AND sm.source = ''test''' || chr(10) ||
        '    GROUP BY 1, 2, 3');
      IF _new = replace(_def, 'dpp', 'test') THEN
        RAISE EXCEPTION '7.5c: _weak_topics_for_user subject fix did not match';
      END IF;
      _fix := _fix + 1;
    END IF;

    IF r.proname = '_build_concept_recovery_report' THEN
      _new := replace(_new,
        'COALESCE(dq.subject, d.subject, ''General'') AS subject,' || chr(10) ||
        '        COALESCE(dq.chapter, d.chapter) AS chapter,' || chr(10) ||
        '        COALESCE(dq.concept, dq.subconcept, d.topic, d.chapter, d.subject) AS concept,' || chr(10) ||
        '        dq.subconcept,' || chr(10) ||
        '        count(*)::int AS attempts,' || chr(10) ||
        '        count(*) FILTER (WHERE da.is_correct)::int AS correct' || chr(10) ||
        '      FROM public.test_answers da' || chr(10) ||
        '      JOIN public.test_questions dq ON dq.id = da.question_id' || chr(10) ||
        '      JOIN public.test_attempts att ON att.id = da.attempt_id' || chr(10) ||
        '      JOIN public.tests d ON d.id = att.test_id' || chr(10) ||
        '      WHERE att.id = _source_id AND att.user_id = _uid',
        'COALESCE(sm.subject, ''General'') AS subject,' || chr(10) ||
        '        sm.chapter AS chapter,' || chr(10) ||
        '        COALESCE(sm.concept, sm.subconcept, sm.topic, sm.chapter) AS concept,' || chr(10) ||
        '        sm.subconcept,' || chr(10) ||
        '        count(*)::int AS attempts,' || chr(10) ||
        '        0::int AS correct' || chr(10) ||
        '      FROM public.student_mistakes sm' || chr(10) ||
        '      JOIN public.test_attempts att ON att.test_id = sm.source_id' || chr(10) ||
        '      WHERE att.id = _source_id AND att.user_id = _uid' || chr(10) ||
        '        AND sm.user_id = _uid AND sm.source = ''test''');
      _fix := _fix + 1;
    END IF;

    IF _new <> _def THEN
      _defs := _defs || _new;
      _n := _n + 1;
    END IF;
  END LOOP;

  IF _n = 0 THEN
    RAISE EXCEPTION 'no function bodies matched dpp — refusing to report a no-op rewrite as success (G15)';
  END IF;
  IF _fix <> 2 THEN
    RAISE EXCEPTION '7.5c: expected to repair 2 bodies that read a subject off dpps, repaired %', _fix;
  END IF;

  DROP FUNCTION IF EXISTS public._bump_academic_activity(uuid, integer, integer, integer, integer);
  DROP FUNCTION IF EXISTS public._bump_academic_activity(uuid, integer, integer, integer, integer, integer);

  FOR i IN 1 .. array_length(_defs, 1) LOOP
    EXECUTE _defs[i];
  END LOOP;

  RAISE NOTICE 'chunk 7.5c: rewrote % function body/bodies off dpp', _n;
END
$rewrite$;

-- _backfill_dpp_question_concepts exists only to backfill the DPP tables, and
-- its caller lost that branch in the pass above, so nothing calls it. The pass
-- will have renamed it; both names are dropped so this cannot silently miss.
DROP FUNCTION IF EXISTS public._backfill_test_question_concepts();
DROP FUNCTION IF EXISTS public._backfill_dpp_question_concepts();

-- ── 3. The badge codes, in data ───────────────────────────────────────────
-- The functions that AWARD them were rewritten above; these are the rows they
-- already wrote. Renaming one without the other would orphan a student's badge.
UPDATE public.student_badges SET badge_code = 'first_test'   WHERE badge_code = 'first_dpp';
UPDATE public.student_badges SET badge_code = 'test_perfect' WHERE badge_code = 'dpp_perfect';

-- ── 3b. Two more constraints that name dpp as a VALUE ─────────────────────
--
-- The fourth and fifth instances in this chunk of the retired feature living
-- as an enumerated value rather than a table name (student_mistakes.source and
-- .assessment_type, recovery_assignments.source_type, and now these). Both
-- were found by the closing assertion, not by looking.
--
--   question_attempts.source            'dpp'          -> 'test'
--   progression_history.source_type     'dpp_attempt'  -> 'test_attempt'
--
-- Neither value is in use (question_attempts.source is all 'practice';
-- progression_history.source_type is 'attendance' and 'practice_session'), so
-- nothing is migrated. The constraints still change: leaving them would mean
-- the first test-sourced row of either kind is rejected by a constraint naming
-- a feature that no longer exists — G15's third pattern exactly.
ALTER TABLE public.question_attempts DROP CONSTRAINT IF EXISTS question_attempts_source_check;
UPDATE public.question_attempts SET source = 'test' WHERE source = 'dpp';
ALTER TABLE public.question_attempts
  ADD CONSTRAINT question_attempts_source_check
  CHECK (source = ANY (ARRAY['battle', 'test', 'practice', 'mistake_book']));

ALTER TABLE public.progression_history DROP CONSTRAINT IF EXISTS progression_history_source_type_check;
UPDATE public.progression_history SET source_type = 'test_attempt' WHERE source_type = 'dpp_attempt';
ALTER TABLE public.progression_history
  ADD CONSTRAINT progression_history_source_type_check
  CHECK (source_type = ANY (ARRAY['attendance', 'battle', 'deep_link', 'test_attempt',
                                  'homework_submission', 'practice_session', 'recovery_followup',
                                  'revision', 'student_mistake', 'student_test_attempt',
                                  'weak_concept', 'battle_participant', 'recovery_assignment']));

-- ── 4. Assert it landed, across every surface ─────────────────────────────
DO $assert$
DECLARE _bad text; _n int;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO _bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) ~* 'dpp';
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'these function bodies still reference dpp: %', _bad;
  END IF;

  SELECT string_agg(table_name || '.' || column_name, ', ') INTO _bad
    FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name ILIKE '%dpp%'
     AND table_name NOT LIKE 'dpp%';
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'these columns still name dpp: %', _bad;
  END IF;

  SELECT count(*)::int INTO _n FROM public.student_badges WHERE badge_code ILIKE '%dpp%';
  IF _n > 0 THEN RAISE EXCEPTION '% badge row(s) still name dpp', _n; END IF;

  SELECT string_agg(conname, ', ') INTO _bad
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%dpp%'
     AND t.relname NOT LIKE 'dpp%';
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'these constraints still name dpp: %', _bad;
  END IF;
END
$assert$;

COMMIT;
