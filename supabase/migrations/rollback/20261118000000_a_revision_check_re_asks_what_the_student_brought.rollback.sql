-- ROLLBACK 20261118000000 — the misses half goes back to bank questions only.
--
-- THIS RESTORES THE DEFECT: a screen capture's mistake and an upload's mistake
-- have `question_id IS NULL`, so neither can be in a bank-joined list, and a
-- chapter the student recovered from captured mistakes gets a revision check
-- that asks about none of the things they got wrong. Measured on production
-- 2026-09-28: chapter "Principles of Management" went from 0 of its mistakes
-- re-asked to 1 (the screen capture) when the forward migration landed; this
-- puts it back to 0.
--
-- It restores 20261100000000's body exactly. The client keeps resolving a
-- revision check's ids from all three places — that is harmless with this
-- rollback in force (the plan simply never names an upload or a capture again),
-- and it is what the recovery ladder needs anyway.

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
  _level      int;
  _cs         public.chapter_state%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF NOT public._recovery_chapter_is_mine(_chapter_id) THEN
    RAISE EXCEPTION 'chapter % is not taught to this student''s section', _chapter_id;
  END IF;

  SELECT * INTO _cs FROM public.chapter_state
   WHERE user_id = _uid AND chapter_id = _chapter_id;

  _want_fresh := public._recovery_const('REVISION_COUNT')::int;
  _want_miss  := public._recovery_const('REVISION_MISTAKE_MAX')::int;
  _level      := public._student_difficulty_rank(_chapter_id);

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
     ORDER BY abs(public._difficulty_rank(qb.difficulty) - _level), qb.created_at
     LIMIT _want_fresh
  ) t;

  _n_fresh := COALESCE(array_length(_fresh, 1), 0);

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
    'level',           CASE _level WHEN 1 THEN 'easy' WHEN 3 THEN 'hard' ELSE 'medium' END,
    'fresh_short',     greatest(0, _want_fresh - _n_fresh),
    'total',           _n_miss + _n_fresh,
    'stage',           COALESCE(_cs.revision_stage, 1),
    'next_revision_at', _cs.next_revision_at,
    'due',             (_cs.next_revision_at IS NOT NULL AND _cs.next_revision_at <= now()),
    'scheduled',       (_cs.user_id IS NOT NULL));
END;
$function$;

-- Fail closed: the brought arm must be gone, or this rollback did not land.
DO $verify$
DECLARE
  _def text := pg_get_functiondef('public.rpc_revision_session_plan(uuid)'::regprocedure);
BEGIN
  IF position('capture_question_id' IN _def) > 0 THEN
    RAISE EXCEPTION 'the brought-question arm is still in the misses half';
  END IF;
  IF position('JOIN public.question_bank qb ON qb.id = sm.question_id' IN _def) = 0 THEN
    RAISE EXCEPTION 'the bank-only join was not restored';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations
 WHERE version = '20261118000000_a_revision_check_re_asks_what_the_student_brought';

COMMIT;
