-- ROLLBACK 20261100000000 — draws a revision check's fresh half by insertion
-- order again.
--
-- THIS RESTORES THE DEFECT: the eight oldest unseen questions of the chapter,
-- whatever level the student has been working at, so a seed script's write
-- order decides what a retention check measures.
--
-- The body below is the one that stood before 20261100000000, restored
-- verbatim from the live definition (without the `level` field, which only the new plan reports). The
-- two helpers go with it: nothing else calls them.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_revision_session_plan(_chapter_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid        uuid := auth.uid();
  _want_fresh int;
  _want_miss  int;
  _fresh      uuid[];
  _misses     uuid[];
  _n_fresh    int;
  _n_miss     int;
  _cs         public.chapter_state%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  -- Same curriculum fence as recovery, in the query layer, raising rather than
  -- returning an empty list — an empty list is indistinguishable from "this
  -- chapter has no questions" and would hide a permissions bug as a content
  -- problem.
  IF NOT public._recovery_chapter_is_mine(_chapter_id) THEN
    RAISE EXCEPTION 'chapter % is not taught to this student''s section', _chapter_id;
  END IF;

  SELECT * INTO _cs FROM public.chapter_state
   WHERE user_id = _uid AND chapter_id = _chapter_id;

  _want_fresh := public._recovery_const('REVISION_COUNT')::int;
  _want_miss  := public._recovery_const('REVISION_MISTAKE_MAX')::int;

  -- ── The misses ─────────────────────────────────────────────────────────
  -- Most-repeated first: a question missed four times is the one the check
  -- most needs to ask about.
  SELECT array_agg(qid) INTO _misses FROM (
    SELECT sm.question_id AS qid
      FROM public.student_mistakes sm
      JOIN public.question_bank qb ON qb.id = sm.question_id
     WHERE sm.user_id = _uid
       AND sm.chapter_id = _chapter_id
       AND sm.status = 'open'
       AND sm.question_id IS NOT NULL
       AND qb.is_active
       AND qb.replaced_by_question_id IS NULL
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
     LIMIT _want_miss
  ) t;

  -- ── The unseen ─────────────────────────────────────────────────────────
  -- §5.4, enforced. Two exclusions, and both are needed:
  --   * question_attempts — anything they have ever answered, in any session,
  --     including one they abandoned. Having seen it is what disqualifies it,
  --     not having got it right.
  --   * student_mistakes — a question they got wrong. It would otherwise
  --     arrive in the "fresh" half and be counted as new material.
  SELECT array_agg(qid) INTO _fresh FROM (
    SELECT qb.id AS qid
      FROM public.question_bank qb
     WHERE qb.chapter_id = _chapter_id
       AND qb.is_active
       AND qb.is_approved
       AND qb.replaced_by_question_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.question_attempts qa
          WHERE qa.user_id = _uid AND qa.bank_question_id = qb.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.student_mistakes sm
          WHERE sm.user_id = _uid AND sm.question_id = qb.id)
     ORDER BY qb.created_at
     LIMIT _want_fresh
  ) t;

  _n_fresh := COALESCE(array_length(_fresh, 1), 0);

  -- §5.4: a revision check is made of questions this student has NEVER
  -- SEEN. With none left there is no check to give, and building one out
  -- of the mistake book alone produces a sitting that
  -- rpc_submit_revision_session will refuse to score — measured live on
  -- 2026-09-17, twice, after the student had answered every question.
  -- Refusing here costs them nothing; refusing there costs them the
  -- sitting.
  IF _n_fresh = 0 THEN
    RAISE EXCEPTION 'there is nothing new left in this chapter to check you on — every question in it has already come up';
  END IF;
  _n_miss  := COALESCE(array_length(_misses, 1), 0);

  RETURN jsonb_build_object(
    'chapter_id',      _chapter_id,
    'mistake_ids',     to_jsonb(COALESCE(_misses, ARRAY[]::uuid[])),
    'fresh_ids',       to_jsonb(COALESCE(_fresh, ARRAY[]::uuid[])),
    'question_ids',    to_jsonb(COALESCE(_misses, ARRAY[]::uuid[]) || COALESCE(_fresh, ARRAY[]::uuid[])),
    'mistakes',        _n_miss,
    'fresh',           _n_fresh,
    'fresh_wanted',    _want_fresh,
    -- Short is reported, never padded. A chapter whose bank is exhausted for
    -- this student gives a shorter check and says so; filling the gap with
    -- questions they have already seen would quietly turn a retention check
    -- into a recall check.
    'fresh_short',     greatest(0, _want_fresh - _n_fresh),
    'total',           _n_miss + _n_fresh,
    'stage',           COALESCE(_cs.revision_stage, 1),
    'next_revision_at', _cs.next_revision_at,
    'due',             (_cs.next_revision_at IS NOT NULL AND _cs.next_revision_at <= now()),
    'scheduled',       (_cs.user_id IS NOT NULL));
END;
$function$;

DROP FUNCTION IF EXISTS public._student_difficulty_rank(uuid);
DROP FUNCTION IF EXISTS public._difficulty_rank(text);

-- Fail closed: the age ordering must be back and the helpers gone.
DO $check$
DECLARE _src text := pg_get_functiondef('public.rpc_revision_session_plan(uuid)'::regprocedure);
BEGIN
  IF _src LIKE '%_difficulty_rank%' THEN
    RAISE EXCEPTION 'the plan still orders by difficulty';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('_difficulty_rank', '_student_difficulty_rank')
  ) THEN
    RAISE EXCEPTION 'a difficulty helper still exists';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations
 WHERE version = '20261100000000_a_revision_check_is_set_at_the_level_the_student_works_at';

COMMIT;
