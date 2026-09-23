-- A REVISION CHECK IS SET AT THE LEVEL THE STUDENT WORKS AT.
--
-- §5.4: a check's fresh half is questions this student has never seen. It says
-- nothing about which ones, and `rpc_revision_session_plan` took the answer
-- literally:
--
--     ORDER BY qb.created_at
--     LIMIT REVISION_COUNT
--
-- — the eight OLDEST unseen rows in the chapter. Insertion order is not a
-- teaching decision. The live bank is 7,498 easy, 9,847 medium and 4,520 hard
-- questions, seeded chapter by chapter, so which difficulty a student's check
-- is made of is decided by which rows a seed script happened to write first.
--
-- A student who has been working through a chapter at HARD gets a check made
-- of whatever was inserted first — and passing it says nothing about the
-- level they were actually at. A student who has been at EASY can be handed
-- eight hard questions and fail a chapter they had not been taught to that
-- depth. Either way the check stops measuring retention, which is the one
-- thing revision exists to measure (§5.1).
--
-- THE RULE: the fresh half is drawn NEAREST THE LEVEL THE STUDENT HAS BEEN
-- WORKING AT IN THAT CHAPTER — the mean difficulty of the questions they have
-- answered there (easy 1, medium 2, hard 3), rounded. With no history in the
-- chapter, their level across the whole bank; with none at all, medium, which
-- is both the middle rung and the largest part of the bank.
--
-- NEAREST, not equal: a chapter that has only two unseen hard questions left
-- must still give a check. Distance orders the candidates, `created_at` breaks
-- ties, and the length is unchanged — so "short is reported, never padded"
-- (the `fresh_short` contract) still holds exactly as before.

CREATE OR REPLACE FUNCTION public._difficulty_rank(_difficulty text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE lower(coalesce(_difficulty, ''))
           WHEN 'easy' THEN 1
           WHEN 'hard' THEN 3
           ELSE 2                         -- medium, and anything unlabelled
         END;
$function$;

COMMENT ON FUNCTION public._difficulty_rank(text) IS
  'easy 1, medium 2, hard 3 — the one ordering of difficulty (§5.4 level matching).';

/**
 * The level a student has been working at in a chapter: the mean difficulty
 * of the bank questions they have answered there, rounded to a rank.
 *
 * Their own history in the chapter first, then their history anywhere, then
 * medium. A student with no attempts at all is not assumed to be weak.
 */
CREATE OR REPLACE FUNCTION public._student_difficulty_rank(_uid uuid, _chapter_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE _rank numeric;
BEGIN
  SELECT avg(public._difficulty_rank(qb.difficulty))
    INTO _rank
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
   WHERE qa.user_id = _uid AND qb.chapter_id = _chapter_id;

  IF _rank IS NULL THEN
    SELECT avg(public._difficulty_rank(qb.difficulty))
      INTO _rank
      FROM public.question_attempts qa
      JOIN public.question_bank qb ON qb.id = qa.bank_question_id
     WHERE qa.user_id = _uid;
  END IF;

  RETURN GREATEST(1, LEAST(3, round(COALESCE(_rank, 2))::int));
END;
$function$;

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
  _level      := public._student_difficulty_rank(_uid, _chapter_id);

  -- ── The misses ─────────────────────────────────────────────────────────
  -- Most-repeated first: a question missed four times is the one the check
  -- most needs to ask about. Their difficulty is not chosen — these are the
  -- student's own questions.
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
  --
  -- Ordered by distance from the level this student works at in this chapter,
  -- then by age. Insertion order alone decided this until 20261056000000.
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
    -- The level the fresh half was drawn around, so a screen (or a session
    -- report) can say what the check was set at rather than implying it.
    'level',           CASE _level WHEN 1 THEN 'easy' WHEN 3 THEN 'hard' ELSE 'medium' END,
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

-- ── THE PROOF ────────────────────────────────────────────────────────────
--
-- Behavioural, against the live bank, and it can fail three ways.
--
--   1. The ranking is an ordering, not a lookup: easy < medium < hard, and an
--      unlabelled difficulty is medium rather than an error.
--   2. A student's level is READ FROM THEIR OWN ATTEMPTS. The proof takes a
--      real student who has answered hard questions in a chapter and one who
--      has answered easy ones, and asserts the two levels differ. If the
--      function ignored its arguments — the failure a fixed ORDER BY has — the
--      two would be equal and this raises.
--   3. The plan's own text must order by that distance and must no longer
--      order the unseen half by age alone.
--
-- A student with no attempts at all must read as medium, not as weak: that is
-- the case a new student arrives in, and calling them weak would set every
-- first check at easy.
DO $guard$
DECLARE
  _hard_uid    uuid;
  _hard_chap   uuid;
  _easy_uid    uuid;
  _easy_chap   uuid;
  _src         text := pg_get_functiondef('public.rpc_revision_session_plan(uuid)'::regprocedure);
BEGIN
  IF public._difficulty_rank('easy') >= public._difficulty_rank('medium')
     OR public._difficulty_rank('medium') >= public._difficulty_rank('hard')
     OR public._difficulty_rank(NULL) <> public._difficulty_rank('medium') THEN
    RAISE EXCEPTION 'difficulty does not rank easy < medium < hard, with the unlabelled as medium';
  END IF;

  IF public._student_difficulty_rank('00000000-0000-0000-0000-000000000000'::uuid, NULL) <> 2 THEN
    RAISE EXCEPTION 'a student with no attempts must read as medium, not as weak';
  END IF;

  -- A real student and chapter where the work has been hard, and one where it
  -- has been easy. Both come from the attempt record itself.
  -- The averages are over EVERY attempt the student made in the chapter, not
  -- over the hard ones alone: the level must be what they have been working
  -- at, and a circular filter here would prove nothing.
  SELECT qa.user_id, qb.chapter_id INTO _hard_uid, _hard_chap
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
   WHERE qb.chapter_id IS NOT NULL
   GROUP BY qa.user_id, qb.chapter_id
  HAVING count(*) >= 3
     AND avg(public._difficulty_rank(qb.difficulty)) >= 2.5
   LIMIT 1;

  SELECT qa.user_id, qb.chapter_id INTO _easy_uid, _easy_chap
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
   WHERE qb.chapter_id IS NOT NULL
   GROUP BY qa.user_id, qb.chapter_id
  HAVING count(*) >= 3
     AND avg(public._difficulty_rank(qb.difficulty)) <= 1.4
   LIMIT 1;

  IF _hard_uid IS NOT NULL AND _easy_uid IS NOT NULL THEN
    IF public._student_difficulty_rank(_hard_uid, _hard_chap)
       <= public._student_difficulty_rank(_easy_uid, _easy_chap) THEN
      RAISE EXCEPTION
        'the level does not follow the student: hard-working % reads %, easy-working % reads %',
        _hard_uid, public._student_difficulty_rank(_hard_uid, _hard_chap),
        _easy_uid, public._student_difficulty_rank(_easy_uid, _easy_chap);
    END IF;
  ELSE
    -- Not silently skipped: the proof says what it could not measure.
    RAISE WARNING 'no student has both a hard-worked and an easy-worked chapter yet — the level-follows-the-student half was not measured';
  END IF;

  IF _src NOT LIKE '%abs(public._difficulty_rank(qb.difficulty) - _level)%' THEN
    RAISE EXCEPTION 'the plan does not order the unseen half by distance from the student''s level';
  END IF;
  IF _src LIKE '%ORDER BY qb.created_at
     LIMIT _want_fresh%' THEN
    RAISE EXCEPTION 'the plan still draws the unseen half by age alone';
  END IF;
END
$guard$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261056000000_a_revision_check_is_set_at_the_level_the_student_works_at')
ON CONFLICT (version) DO NOTHING;
