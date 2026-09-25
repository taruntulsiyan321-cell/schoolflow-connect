-- ===========================================================================
-- A QUESTION THE STUDENT BROUGHT GETS ITS RECOVERY STEPS
--
-- A recovery session asks, for each open mistake, the question itself (rung 0),
-- a procedural variant (1), a conceptual variant (2) and a chapter question
-- (3); it can be offered once it holds 2 procedural and 2 conceptual.
--
-- Rungs 1 and 2 came only from variants generated FROM A BANK QUESTION. A
-- mistake on a question the student brought — a screen capture, or an upload —
-- has no bank id, and the plan skipped it: nothing may be generated from
-- captured content (screen-capture spec §9) or from an AI-answered upload
-- (upload §6.2), and nothing ever queued the variants an upload answered from
-- its own file is allowed (upload §10: the owner-driven enqueue had no caller).
-- So a chapter whose mistakes were all captures or uploads could never reach
-- 2 procedural: its recovery was blocked for ever, with a reason the student
-- could do nothing about. Measured 2026-09-25: 1 open capture mistake and 2
-- open upload mistakes (both AI-answered), no upload-sourced variant ever
-- generated or queued.
--
-- Ruled (2026-09-25, "Option A"): such a mistake's rungs are filled from the
-- bank — _recovery_step_pool, in this order: the upload's own variants; the
-- variants of the bank question it was matched to when filed, and that
-- question itself; then the chapter's bank questions, its topic first. A
-- mistake on a bank question is laddered exactly as before.
--
-- The variants that ARE allowed are asked for by 20261105000000.
--
-- ROLLBACK: rollback/20261104000000_a_question_the_student_brought_gets_its_recovery_steps.rollback.sql
-- ===========================================================================

BEGIN;

-- The ladder of every bank mistake, before, so the proof can show it is
-- untouched.
CREATE TEMP TABLE _bank_before ON COMMIT DROP AS
SELECT sm.user_id, sm.chapter_id,
       public._recovery_session_plan_for(sm.user_id, sm.chapter_id)->'tiers' AS tiers
  FROM (SELECT sm.user_id, sm.chapter_id
          FROM public.student_mistakes sm
         WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
         GROUP BY sm.user_id, sm.chapter_id
        HAVING bool_and(sm.question_id IS NOT NULL)
           AND count(*) <= public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int) sm
 WHERE public._recovery_chapter_is_for(sm.user_id, sm.chapter_id);

CREATE OR REPLACE FUNCTION public._recovery_step_pool(_uid uuid, _chapter_id uuid, _src jsonb, _tier smallint)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- The questions a recovery rung (1 procedural, 2 conceptual) can be filled
  -- from for ONE mistake, best first.
  --
  --   a mistake on a bank question    its own generated variants — nothing
  --                                   else, exactly as before this function
  --   a mistake on a question the student brought (upload or capture):
  --     1. the variants generated from that upload (answered from its file)
  --     2. the variants of the bank question it matched when it was filed,
  --        and, for the procedural rung, that question itself
  --     3. the chapter's own bank questions, its topic first, then the
  --        mistake's difficulty, then what the student has not seen yet
  --
  -- A question the student already got wrong is never offered as a step for
  -- a brought question: it is a mistake of its own, not new practice.
  WITH s AS (
    SELECT NULLIF(_src->>'question_id', '')::uuid        AS bank_id,
           NULLIF(_src->>'upload_question_id', '')::uuid AS upload_id,
           NULLIF(_src->>'anchor_question_id', '')::uuid AS anchor_id,
           NULLIF(_src->>'topic_id', '')::uuid           AS topic_id,
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
       AND qb.is_active AND qb.replaced_by_question_id IS NULL
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
     WHERE s.bank_id IS NULL
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


COMMENT ON FUNCTION public._recovery_step_pool(uuid, uuid, jsonb, smallint) IS
  'Where a recovery rung (1, 2) is filled from for one mistake: a bank mistake''s own variants; a brought question''s upload variants, matched bank question, then chapter bank questions topic-first.';
REVOKE ALL ON FUNCTION public._recovery_step_pool(uuid, uuid, jsonb, smallint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._recovery_session_plan_for(_uid uuid, _chapter_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _n             int;
  _deep_max      int;
  _wide_max      int;
  _relearn_above int;
  _mode          text;
  _per           int[] := ARRAY[0, 0, 0, 0];
  _sources       jsonb := '[]'::jsonb;
  _tiers         jsonb := '{}'::jsonb;
  _used          uuid[] := ARRAY[]::uuid[];
  _used_upload   uuid[] := ARRAY[]::uuid[];
  _used_capture  uuid[] := ARRAY[]::uuid[];
  _m             record;
  _src           record;
  _tier          smallint;
  _need          int;
  _got           uuid[];
  _ids           uuid[];
  _short         int;
  _total_short   int := 0;
  _proc_filled   int := 0;
  _conc_filled   int := 0;
  _min_proc      int;
  _min_conc      int;
  _filled        int;
  _offerable     boolean;
  _up_ok         boolean;
  _cap_ok        boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF NOT public._recovery_chapter_is_for(_uid, _chapter_id) THEN
    RAISE EXCEPTION 'chapter % is not taught to this student''s section', _chapter_id
      USING HINT = 'The curriculum filter is enforced here, in the query layer, not in the UI.';
  END IF;

  _deep_max      := public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int;
  _wide_max      := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;
  _relearn_above := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;
  _min_proc      := public._recovery_const('RECOVERY_MIN_PROCEDURAL_TO_OFFER')::int;
  _min_conc      := public._recovery_const('RECOVERY_MIN_CONCEPTUAL_TO_OFFER')::int;

  SELECT count(*)::int INTO _n
    FROM public.student_mistakes sm
   WHERE sm.user_id = _uid
     AND sm.chapter_id = _chapter_id
     AND sm.status = 'open'
     AND (sm.question_id IS NOT NULL
          OR sm.upload_question_id IS NOT NULL
          OR sm.capture_question_id IS NOT NULL);

  IF _n = 0 THEN
    RETURN jsonb_build_object(
      'mode', 'none', 'open_mistakes', 0,
      'sources', '[]'::jsonb, 'tiers', '{}'::jsonb,
      'shortfall', 0, 'complete', false,
      'offerable_if_generation_exhausted', false,
      'not_offerable_reason',
        'nothing is open in this chapter — there is no mistake to build a session from');
  END IF;

  IF _n > _relearn_above THEN
    RETURN jsonb_build_object(
      'mode', 'relearn', 'open_mistakes', _n, 'relearn_above', _relearn_above,
      'sources', '[]'::jsonb, 'tiers', '{}'::jsonb,
      'shortfall', 0, 'complete', false,
      'offerable_if_generation_exhausted', false,
      'not_offerable_reason',
        format('%s open mistakes in one chapter is not a set of slips to drill away. '
               'Practising %s variant questions would not teach the chapter. '
               'Work through the material again first.', _n, _n * 3));
  END IF;

  IF _n <= _deep_max THEN
    _mode := 'deep';
    _per := ARRAY[
      public._recovery_const('RECOVERY_DEEP_TIER0')::int,
      public._recovery_const('RECOVERY_DEEP_TIER1')::int,
      public._recovery_const('RECOVERY_DEEP_TIER2')::int,
      public._recovery_const('RECOVERY_DEEP_TIER3')::int];
  ELSE
    _mode := 'wide';
    _per := ARRAY[
      public._recovery_const('RECOVERY_WIDE_TIER0')::int,
      public._recovery_const('RECOVERY_WIDE_TIER1')::int,
      public._recovery_const('RECOVERY_WIDE_TIER2')::int,
      public._recovery_const('RECOVERY_WIDE_TIER3')::int];
  END IF;

  FOR _m IN
    SELECT sm.question_id, sm.upload_question_id, sm.capture_question_id,
           sm.difficulty, sm.times_wrong,
           -- A question the student brought (upload or capture) has no
           -- variants of its own to ladder on; these two say where its steps
           -- come from instead (_recovery_step_pool).
           COALESCE(uq.topic_id, cq.topic_id) AS src_topic_id,
           COALESCE(uq.matched_bank_question_id, cq.matched_bank_question_id) AS src_anchor_id
      FROM public.student_mistakes sm
      LEFT JOIN public.student_upload_questions uq
             ON uq.id = sm.upload_question_id AND uq.owner_id = _uid
      LEFT JOIN public.student_capture_questions cq
             ON cq.id = sm.capture_question_id AND cq.owner_id = _uid
     WHERE sm.user_id = _uid AND sm.chapter_id = _chapter_id
       AND sm.status = 'open'
       AND (sm.question_id IS NOT NULL
            OR sm.upload_question_id IS NOT NULL
            OR sm.capture_question_id IS NOT NULL)
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
  LOOP
    _sources := _sources || (jsonb_build_object(
      'question_id', _m.question_id,
      'upload_question_id', _m.upload_question_id,
      'capture_question_id', _m.capture_question_id,
      'difficulty', _m.difficulty,
      'times_wrong', _m.times_wrong)
      || jsonb_strip_nulls(jsonb_build_object(
           'topic_id', _m.src_topic_id,
           'anchor_question_id', _m.src_anchor_id)));

    IF _per[1] <= 0 THEN
      CONTINUE;
    END IF;

    IF _m.question_id IS NOT NULL THEN
      -- Only a question the student can be shown: a bank question withdrawn
      -- after the mistake (retired, or its key disputed) is not an original
      -- that can be asked again (20261093000000).
      IF NOT (_m.question_id = ANY (_used)) AND EXISTS (
           SELECT 1 FROM public.question_bank q
            WHERE q.id = _m.question_id AND q.is_active AND q.is_approved) THEN
        _used := _used || _m.question_id;
      END IF;
    ELSIF _m.upload_question_id IS NOT NULL
          AND NOT (_m.upload_question_id = ANY (_used_upload)) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.student_upload_questions uq
         WHERE uq.id = _m.upload_question_id
           AND uq.owner_id = _uid
      ) INTO _up_ok;
      IF _up_ok THEN
        _used_upload := _used_upload || _m.upload_question_id;
      END IF;
    ELSIF _m.capture_question_id IS NOT NULL
          AND NOT (_m.capture_question_id = ANY (_used_capture)) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.student_capture_questions cq
         WHERE cq.id = _m.capture_question_id
           AND cq.owner_id = _uid
      ) INTO _cap_ok;
      IF _cap_ok THEN
        _used_capture := _used_capture || _m.capture_question_id;
      END IF;
    END IF;
  END LOOP;

  _need := _n * _per[1];
  _filled := COALESCE(array_length(_used, 1), 0)
           + COALESCE(array_length(_used_upload, 1), 0)
           + COALESCE(array_length(_used_capture, 1), 0);
  _short  := greatest(0, _need - _filled);
  _total_short := _total_short + _short;
  _proc_filled := _proc_filled + _filled;

  _tiers := jsonb_set(_tiers, '{0}', jsonb_build_object(
    'needed', _need,
    'from_bank', to_jsonb(COALESCE(_used, ARRAY[]::uuid[])),
    'from_upload', to_jsonb(COALESCE(_used_upload, ARRAY[]::uuid[])),
    'from_capture', to_jsonb(COALESCE(_used_capture, ARRAY[]::uuid[])),
    'filled', _filled,
    'shortfall', _short,
    'note',
      'own wrongs: bank in from_bank, uploads in from_upload, captures in from_capture'));

  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    _need := _n * _per[_tier + 1];
    _got  := ARRAY[]::uuid[];

    IF _need > 0 THEN
      FOR _src IN SELECT value AS v FROM jsonb_array_elements(_sources) LOOP
        -- Every mistake gets its rung, including one on a question the
        -- student brought: _recovery_step_pool says where each comes from.
        SELECT array_agg(t.qid) INTO _ids
          FROM (
            SELECT qid
              FROM public._recovery_step_pool(_uid, _chapter_id, _src.v, _tier) AS pool(qid)
             WHERE NOT (qid = ANY (_used))
             LIMIT _per[_tier + 1]
          ) t;
        IF _ids IS NOT NULL THEN
          _got  := _got || _ids;
          _used := _used || _ids;
        END IF;
      END LOOP;
    END IF;

    _filled := COALESCE(array_length(_got, 1), 0);
    _short  := greatest(0, _need - _filled);
    _total_short := _total_short + _short;
    IF _tier = 1 THEN _proc_filled := _proc_filled + _filled;
                 ELSE _conc_filled := _conc_filled + _filled; END IF;

    _tiers := jsonb_set(_tiers, ARRAY[_tier::text], jsonb_build_object(
      'needed', _need, 'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
      'filled', _filled, 'shortfall', _short,
      'note', 'bank checked first; the shortfall is what generation must supply'));
  END LOOP;

  _need := _n * _per[4];
  _got  := ARRAY[]::uuid[];

  IF _need > 0 THEN
    SELECT array_agg(id) INTO _got
      FROM (
        SELECT qb.id FROM public.question_bank qb
         WHERE qb.chapter_id = _chapter_id
           AND qb.is_active
           AND qb.source_question_id IS NULL
           AND qb.replaced_by_question_id IS NULL
           AND NOT (qb.id = ANY (_used))
           AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                            WHERE sm.user_id = _uid AND sm.question_id = qb.id)
         ORDER BY qb.created_at LIMIT _need
      ) t;
    IF _got IS NOT NULL THEN _used := _used || _got; END IF;
  END IF;

  _filled := COALESCE(array_length(_got, 1), 0);
  _short  := greatest(0, _need - _filled);
  _total_short := _total_short + _short;
  _conc_filled := _conc_filled + _filled;

  _tiers := jsonb_set(_tiers, '{3}', jsonb_build_object(
    'needed', _need, 'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
    'filled', _filled, 'shortfall', _short,
    'note', CASE WHEN _need = 0 THEN 'not asked for in wide mode'
                 ELSE 'bank where coverage allows; AI otherwise' END));

  _offerable := (_proc_filled >= _min_proc) AND (_conc_filled >= _min_conc);

  RETURN jsonb_build_object(
    'mode', _mode, 'open_mistakes', _n, 'sources', _sources, 'tiers', _tiers,
    'shortfall', _total_short, 'complete', (_total_short = 0),
    'procedural_filled', _proc_filled, 'conceptual_filled', _conc_filled,
    'offerable_if_generation_exhausted', _offerable,
    'not_offerable_reason',
      CASE WHEN _offerable THEN NULL
           WHEN _conc_filled < _min_conc AND _proc_filled < _min_proc THEN
             'the bank holds neither enough procedural nor enough conceptual material for this chapter yet'
           WHEN _conc_filled < _min_conc THEN
             'no conceptual questions exist for these mistakes yet, so the session could not tell you whether you understand it or merely remember the steps'
           ELSE
             'not enough procedural questions exist for these mistakes yet'
      END);
END;
$function$;


-- ── Verify (each check can fail) ─────────────────────────────────────────────
DO $proof$
DECLARE
  _n int; _uid uuid; _chap uuid; _plan jsonb; _src jsonb; _ids uuid[]; _topic uuid;
BEGIN
  -- 1. Every bank mistake's ladder is what it was.
  SELECT count(*) INTO _n FROM _bank_before b
   WHERE (public._recovery_session_plan_for(b.user_id, b.chapter_id)->'tiers') IS DISTINCT FROM b.tiers;
  IF _n <> 0 THEN RAISE EXCEPTION '% chapters of bank mistakes were laddered differently', _n; END IF;
  SELECT count(*) INTO _n FROM _bank_before;
  IF _n = 0 THEN RAISE EXCEPTION 'no chapter of bank mistakes to compare — the check above proved nothing'; END IF;

  -- 2. A brought question now gets rungs 1 and 2, from its own chapter, and
  --    none of them is one of the student's own mistakes.
  SELECT sm.user_id, sm.chapter_id INTO _uid, _chap
    FROM public.student_mistakes sm
   WHERE sm.status = 'open' AND sm.question_id IS NULL
     AND (sm.capture_question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL)
   ORDER BY sm.capture_question_id IS NOT NULL DESC LIMIT 1;
  IF _uid IS NULL THEN RAISE EXCEPTION 'no open capture or upload mistake to prove the new rungs on'; END IF;

  SELECT value INTO _src
    FROM jsonb_array_elements(public._recovery_session_plan_for(_uid, _chap)->'sources')
   WHERE value->>'question_id' IS NULL LIMIT 1;
  SELECT array_agg(q) INTO _ids FROM public._recovery_step_pool(_uid, _chap, _src, 1::smallint) q;
  IF COALESCE(array_length(_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'a brought question still gets no procedural rung (%)', _src;
  END IF;
  IF EXISTS (SELECT 1 FROM public.question_bank qb WHERE qb.id = ANY (_ids) AND qb.chapter_id IS DISTINCT FROM _chap) THEN
    RAISE EXCEPTION 'a rung came from another chapter';
  END IF;
  IF EXISTS (SELECT 1 FROM public.student_mistakes sm WHERE sm.user_id = _uid AND sm.question_id = ANY (_ids)) THEN
    RAISE EXCEPTION 'a rung is one of the student''s own mistakes';
  END IF;
  _topic := NULLIF(_src->>'topic_id', '')::uuid;
  IF _topic IS NOT NULL AND EXISTS (SELECT 1 FROM public.question_bank qb WHERE qb.chapter_id = _chap AND qb.topic_id = _topic AND qb.is_active AND qb.is_approved AND qb.source_question_id IS NULL)
     AND (SELECT qb.topic_id FROM public.question_bank qb WHERE qb.id = _ids[1]) IS DISTINCT FROM _topic THEN
    RAISE EXCEPTION 'the chapter has questions in the mistake''s topic, and the first rung is not one of them';
  END IF;

  -- 3. CONTROL: the same source with a bank id is laddered on its variants
  --    only — the new pool does not leak into bank mistakes.
  IF EXISTS (SELECT 1 FROM public._recovery_step_pool(_uid, _chap,
               jsonb_build_object('question_id', gen_random_uuid()), 1::smallint)) THEN
    RAISE EXCEPTION 'a bank question with no variants was given bank siblings';
  END IF;
END
$proof$;

COMMIT;
