-- ROLLBACK 20261157000000 — the recovery helpers are SQL functions again.
--
-- Puts back, exactly as they were live before it (pg_get_functiondef):
-- _recovery_step_pool, _recovery_variant_pool and _recovery_chapter_is_for as
-- LANGUAGE sql (planned on every call again), and _recovery_queue_for as
-- 20261101000000 left it (ordered by ready and open_mistakes only, so tied
-- chapters come out in plan order again). CREATE OR REPLACE keeps the grants.

BEGIN;

CREATE OR REPLACE FUNCTION public._recovery_step_pool(_uid uuid, _chapter_id uuid, _src jsonb, _tier smallint)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- The questions a recovery rung can be filled from for ONE mistake, best
  -- first. Every one is a question the app will show: approved, active, not
  -- replaced.
  --
  --   rungs 1 and 2 (procedural, conceptual)
  --     a mistake on a bank question    its own generated variants
  --     a mistake on a question the student brought (upload or capture):
  --       1. the variants generated from that upload (answered from its file)
  --       2. the variants of the bank question it matched when it was filed,
  --          and, for the procedural rung, that question itself
  --       3. the chapter's own questions, as for rung 3
  --
  --   rung 3 (far — §4.2 "same topic, different application")
  --     the chapter's own questions for every mistake: its topic first, then
  --     its difficulty, then what the student has not seen yet, then age.
  --     Originals only: a variant is the same question, not another use of it.
  --
  -- A question the student already got wrong is never a step for another
  -- mistake: it is a mistake of its own, not new practice.
  WITH s AS (
    SELECT NULLIF(_src->>'question_id', '')::uuid        AS bank_id,
           NULLIF(_src->>'upload_question_id', '')::uuid AS upload_id,
           NULLIF(_src->>'anchor_question_id', '')::uuid AS anchor_id,
           -- A brought question carries its topic in the source; a bank
           -- mistake's topic is its question's.
           COALESCE(NULLIF(_src->>'topic_id', '')::uuid,
                    (SELECT qb.topic_id FROM public.question_bank qb
                      WHERE qb.id = NULLIF(_src->>'question_id', '')::uuid)) AS topic_id,
           NULLIF(_src->>'difficulty', '')               AS difficulty
  ),
  cand AS (
    SELECT p.qid, 1 AS rk, p.n AS ord
      FROM s CROSS JOIN LATERAL public._recovery_variant_pool(s.bank_id, _tier, s.difficulty)
           WITH ORDINALITY AS p(qid, n)
     WHERE s.bank_id IS NOT NULL
    UNION ALL
    SELECT qb.id, 2, row_number() OVER (ORDER BY qb.created_at)
      FROM s JOIN public.question_bank qb ON qb.source_upload_question_id = s.upload_id
     WHERE s.bank_id IS NULL
       AND qb.variant_tier = _tier
       AND qb.is_active AND qb.is_approved AND qb.replaced_by_question_id IS NULL
    UNION ALL
    SELECT p.qid, 3, p.n
      FROM s CROSS JOIN LATERAL public._recovery_variant_pool(s.anchor_id, _tier, s.difficulty)
           WITH ORDINALITY AS p(qid, n)
     WHERE s.bank_id IS NULL AND s.anchor_id IS NOT NULL
    UNION ALL
    SELECT qb.id, 4, 1
      FROM s JOIN public.question_bank qb ON qb.id = s.anchor_id
     WHERE s.bank_id IS NULL AND _tier = 1
       AND qb.is_active AND qb.is_approved AND qb.replaced_by_question_id IS NULL
    UNION ALL
    SELECT qb.id,
           CASE WHEN qb.topic_id = s.topic_id THEN 5 ELSE 6 END,
           row_number() OVER (
             ORDER BY (qb.topic_id IS NOT DISTINCT FROM s.topic_id) DESC,
                      (qb.difficulty IS NOT DISTINCT FROM s.difficulty) DESC,
                      EXISTS (SELECT 1 FROM public.question_attempts qa
                               WHERE qa.user_id = _uid AND qa.bank_question_id = qb.id),
                      qb.created_at)
      FROM s JOIN public.question_bank qb ON qb.chapter_id = _chapter_id
     WHERE (s.bank_id IS NULL OR _tier = 3)
       AND qb.is_active AND qb.is_approved AND qb.replaced_by_question_id IS NULL
       AND qb.source_question_id IS NULL AND qb.source_upload_question_id IS NULL
  )
  SELECT c.qid
    FROM cand c
   WHERE c.rk = 1
      OR NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                      WHERE sm.user_id = _uid AND sm.question_id = c.qid)
   GROUP BY c.qid
   ORDER BY min(c.rk * 1000000 + c.ord);
$function$;

CREATE OR REPLACE FUNCTION public._recovery_variant_pool(_source_question_id uuid, _tier smallint, _difficulty text)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Existing bank variants of one source question at one tier. Variants are
  -- ordinary bank questions (§4.2a), and a recovery session is loaded through
  -- question_bank_student, which serves approved, active questions only — so
  -- that is what is offered here, written out: this runs under the definer
  -- rpc_start_recovery_session, where no policy filters it. Retired questions
  -- are excluded: a rewrite creates a NEW question and retires the old one
  -- (§10.21).
  SELECT qb.id
    FROM public.question_bank qb
   WHERE qb.source_question_id = _source_question_id
     AND qb.variant_tier       = _tier
     AND qb.is_active
     AND qb.is_approved
     AND qb.replaced_by_question_id IS NULL
     -- §4.2: "variants mirror the difficulty of what was failed." When the
     -- mistake recorded no difficulty there is nothing to mirror, so the
     -- constraint is dropped rather than guessed at.
     AND (_difficulty IS NULL OR qb.difficulty = _difficulty)
   ORDER BY qb.created_at
$function$;

CREATE OR REPLACE FUNCTION public._recovery_chapter_is_for(_uid uuid, _chapter_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Taught to the student's own section...
  SELECT EXISTS (
    SELECT 1
      FROM public.chapters ch
      JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id
      JOIN public.students st        ON st.class_id = ss.section_id
     WHERE ch.id = _chapter_id
       AND st.user_id = _uid
  )
  -- ...or practised from the bank (20261044000000)...
  OR EXISTS (
    SELECT 1
      FROM public.question_attempts qa
      JOIN public.question_bank qb ON qb.id = qa.bank_question_id
     WHERE qa.user_id = _uid
       AND qb.chapter_id = _chapter_id
  )
  -- ...or practised via a private upload / screen-capture attempt, which
  -- stamps chapter_id onto generated_question (§9 / §7.4) with no bank row.
  OR EXISTS (
    SELECT 1
      FROM public.question_attempts qa
     WHERE qa.user_id = _uid
       AND (qa.generated_question->>'chapter_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       AND (qa.generated_question->>'chapter_id')::uuid = _chapter_id
  )
  -- ...or has a mistake filed against that chapter (covers rows where the
  -- attempt snapshot omitted chapter_id but the mistake writer kept it).
  OR EXISTS (
    SELECT 1
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid
       AND sm.chapter_id = _chapter_id
  )
$function$;

CREATE OR REPLACE FUNCTION public._recovery_queue_for(_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _trigger       int;
  _deep_max      int;
  _relearn_above int;
  _out           jsonb := '[]'::jsonb;
  _m             record;
  _plan          jsonb;
  _size          int;
  _startable     boolean;
  _why           text;
BEGIN
  IF _uid IS NULL THEN RETURN '[]'::jsonb; END IF;

  _trigger       := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;
  _deep_max      := public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int;
  _relearn_above := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;

  FOR _m IN
    SELECT m.chapter_id, m.open_mistakes, c.name AS chapter, sub.name AS subject,
           cs.state, cs.last_recovery_readiness, cs.recovered_at, COALESCE(rs.rounds, 0) AS rounds,
           (m.open_mistakes >= _trigger AND m.open_mistakes <= _relearn_above) AS ready
      FROM (
        SELECT sm.chapter_id, count(*)::int AS open_mistakes
          FROM public.student_mistakes sm
         WHERE sm.user_id = _uid
           AND sm.status = 'open'
           AND sm.chapter_id IS NOT NULL
           AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL OR sm.capture_question_id IS NOT NULL)
         GROUP BY sm.chapter_id
      ) m
      LEFT JOIN public.chapters c ON c.id = m.chapter_id
      LEFT JOIN public.curriculum_subjects sub ON sub.id = c.curriculum_subject_id
      LEFT JOIN public.chapter_state cs ON cs.user_id = _uid AND cs.chapter_id = m.chapter_id
      LEFT JOIN (
        SELECT chapter_id, count(*)::int AS rounds
          FROM public.recovery_sessions
         WHERE user_id = _uid AND completed_at IS NOT NULL
         GROUP BY chapter_id
      ) rs ON rs.chapter_id = m.chapter_id
  LOOP
    _size := 0; _startable := false; _why := NULL;
    IF _m.ready THEN
      BEGIN
        _plan := public._recovery_session_plan_for(_uid, _m.chapter_id);
        SELECT COALESCE(sum((t.value->>'filled')::int), 0)::int INTO _size
          FROM jsonb_each(COALESCE(_plan->'tiers', '{}'::jsonb)) t;
        _startable := public._recovery_plan_startable(_plan);
        IF NOT _startable THEN
          _why := COALESCE(_plan->>'not_offerable_reason',
                           'not enough material to produce a diagnosis for this chapter yet');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        _why := SQLERRM;
      END;
    END IF;

    _out := _out || jsonb_build_array(jsonb_build_object(
      'chapter_id',     _m.chapter_id,
      'chapter',        _m.chapter,
      'subject',        _m.subject,
      'open_mistakes',  _m.open_mistakes,
      'trigger_count',  _trigger,
      'ready',          _m.ready,
      'mode',           CASE
                          WHEN _m.open_mistakes > _relearn_above THEN 'relearn'
                          WHEN _m.open_mistakes < _trigger       THEN 'none'
                          WHEN _m.open_mistakes <= _deep_max     THEN 'deep'
                          ELSE 'wide' END,
      'planned_size',   _size,
      'startable',      _startable,
      'blocked_reason', _why,
      'relearn_above',  _relearn_above,
      'state',          COALESCE(_m.state, 'has_mistakes'),
      'in_recovery',    (_m.state = 'in_recovery'),
      'last_recovery_readiness', _m.last_recovery_readiness,
      'recovered_at',   _m.recovered_at,
      'rounds_taken',   _m.rounds
    ));
  END LOOP;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'ready')::boolean DESC, (r->>'open_mistakes')::int DESC), '[]'::jsonb)
    INTO _out FROM jsonb_array_elements(_out) r;
  RETURN _out;
END;
$function$;

COMMIT;
