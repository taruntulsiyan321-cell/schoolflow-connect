-- ═══════════════════════════════════════════════════════════════════════════
-- THE SYLLABUS IS READ AS A MAP
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-03 (approved analysis, 3c): the Analysis tab shows the
-- student their WHOLE syllabus — every chapter and topic of their exam,
-- practised or not — and which topics are slipping: right less often lately
-- than before.
--
-- rpc_student_syllabus_map(_recent_days) returns, for the caller's exam and
-- stream (exam_accounts.account_id = the caller):
--   chapters  every syllabus chapter: its subject and place, and the
--             caller's answered / right — in all, and within the last
--             _recent_days — and when they last answered one
--   topics    every topic of those chapters, the same counts
-- An answer is a question answered (not skipped, not timed out) and not left
-- out of accuracy. It is placed by its bank question's chapter and topic, or —
-- an upload or capture, which has no bank question — by the chapter its
-- attempt carries. Earlier = all − recent; the client derives it.
--
-- The window is the client's (thresholds.ts) so it has one home; the server
-- refuses one outside 1–90 days. Topics follow the plan, as the rest of topic
-- analysis does (_premium_topic_analysis).
--
-- OWNER-scoped: every attempt read is the caller's; the syllabus, chapters,
-- topics and bank are global.
--
-- ROLLBACK: rollback/20261145000000_the_syllabus_is_read_as_a_map.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE FUNCTION public.rpc_student_syllabus_map(_recent_days integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _uid    uuid := auth.uid();
  _exam   uuid;
  _stream text;
  _since  timestamptz;
  _out    jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF _recent_days IS NULL OR _recent_days < 1 OR _recent_days > 90 THEN
    RAISE EXCEPTION 'the recent window must be 1 to 90 days' USING ERRCODE = '22023';
  END IF;
  SELECT ea.exam_id, ea.stream INTO _exam, _stream
    FROM public.exam_accounts ea
   WHERE ea.account_id = _uid
   ORDER BY ea.created_at
   LIMIT 1;
  _since := now() - make_interval(days => _recent_days);

  WITH syl AS (
    SELECT esc.chapter_id, esc.sequence, c.name AS chapter, cs.name AS subject
      FROM public.exam_syllabus_chapters esc
      JOIN public.chapters c ON c.id = esc.chapter_id
      JOIN public.curriculum_subjects cs ON cs.id = c.curriculum_subject_id
     WHERE esc.exam_id = _exam AND esc.stream = _stream
  ), att AS (
    SELECT COALESCE(qb.chapter_id,
                    CASE WHEN qa.generated_question->>'chapter_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         THEN (qa.generated_question->>'chapter_id')::uuid END) AS chapter_id,
           qb.topic_id,
           COALESCE(qa.is_correct, false) AS is_correct,
           qa.created_at
      FROM public.question_attempts qa
      LEFT JOIN public.question_bank qb ON qb.id = qa.bank_question_id
     WHERE qa.user_id = _uid
       AND NOT COALESCE(qa.skipped, false)
       AND NOT COALESCE(qa.timed_out, false)
       AND NOT COALESCE(qa.excluded_from_accuracy, false)
  )
  SELECT jsonb_build_object(
    'exam_found',  _exam IS NOT NULL,
    'recent_days', _recent_days,
    'chapters', (
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.subject, r.sequence, r.chapter), '[]'::jsonb)
        FROM (
          SELECT s.chapter_id, s.chapter, s.subject, s.sequence,
                 count(a.chapter_id)::int                                             AS answered,
                 count(a.chapter_id) FILTER (WHERE a.is_correct)::int                 AS correct,
                 count(a.chapter_id) FILTER (WHERE a.created_at >= _since)::int       AS recent_answered,
                 count(a.chapter_id) FILTER (WHERE a.created_at >= _since AND a.is_correct)::int AS recent_correct,
                 max(a.created_at)                                                    AS last_at
            FROM syl s
            LEFT JOIN att a ON a.chapter_id = s.chapter_id
           GROUP BY s.chapter_id, s.chapter, s.subject, s.sequence
        ) r),
    'topics', (
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.chapter_id, r.topic), '[]'::jsonb)
        FROM (
          SELECT t.id AS topic_id, t.name AS topic, t.chapter_id,
                 count(a.topic_id)::int                                               AS answered,
                 count(a.topic_id) FILTER (WHERE a.is_correct)::int                   AS correct,
                 count(a.topic_id) FILTER (WHERE a.created_at >= _since)::int         AS recent_answered,
                 count(a.topic_id) FILTER (WHERE a.created_at >= _since AND a.is_correct)::int AS recent_correct,
                 max(a.created_at)                                                    AS last_at
            FROM public.topics t
            JOIN syl s ON s.chapter_id = t.chapter_id
            LEFT JOIN att a ON a.topic_id = t.id
           GROUP BY t.id, t.name, t.chapter_id
        ) r)
  ) INTO _out;

  RETURN public._premium_topic_analysis(_uid, _out, ARRAY['topics']);
END $fn$;

REVOKE ALL ON FUNCTION public.rpc_student_syllabus_map(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_student_syllabus_map(integer) TO authenticated;

COMMENT ON FUNCTION public.rpc_student_syllabus_map(integer) IS
  'Every chapter and topic of the caller''s exam syllabus with their own answered/right counts, all and recent (20261145000000). Owner-scoped.';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.rpc_student_syllabus_map(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_student_syllabus_map(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the map is shut to students or open to strangers';
  END IF;
END $verify$;

-- ── PROOF: as the students themselves; rolled back ─────────────────────────
DO $proof$
DECLARE
  _fail text := '';
  _sentinel constant text := 'm20261145 proof rolled back';
  _a uuid; _a_school uuid; _exam uuid; _stream text;
  _b uuid; _b_school uuid;
  _ch uuid; _q uuid; _topic uuid; _sess uuid; _bsess uuid;
  _syllabus int;
  _r jsonb; _c0 jsonb; _c1 jsonb; _t0 jsonb; _t1 jsonb;
BEGIN
  SELECT ea.account_id, ea.school_id, ea.exam_id, ea.stream INTO _a, _a_school, _exam, _stream
    FROM public.exam_accounts ea
    JOIN public.students st ON st.user_id = ea.account_id
   ORDER BY ea.account_id LIMIT 1;
  SELECT esc.chapter_id, qb.id, qb.topic_id INTO _ch, _q, _topic
    FROM public.exam_syllabus_chapters esc
    JOIN public.question_bank qb ON qb.chapter_id = esc.chapter_id AND qb.topic_id IS NOT NULL
   WHERE esc.exam_id = _exam AND esc.stream = _stream
   ORDER BY esc.chapter_id, qb.id LIMIT 1;
  SELECT st.user_id, st.school_id INTO _b, _b_school
    FROM public.students st WHERE st.user_id IS NOT NULL AND st.user_id <> _a ORDER BY st.user_id LIMIT 1;
  SELECT count(*) INTO _syllabus FROM public.exam_syllabus_chapters WHERE exam_id = _exam AND stream = _stream;
  IF _a IS NULL OR _ch IS NULL OR _b IS NULL OR _syllabus = 0 THEN
    RAISE EXCEPTION 'PROOF FAILED: fixture missing (a % chapter % b % syllabus %)', _a, _ch, _b, _syllabus;
  END IF;

  BEGIN
    -- The map before the fixture: the student's real answers stay counted.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    _r := public.rpc_student_syllabus_map(14);
    EXECUTE 'RESET ROLE';
    SELECT c INTO _c0 FROM jsonb_array_elements(_r->'chapters') c WHERE (c->>'chapter_id')::uuid = _ch;
    SELECT t INTO _t0 FROM jsonb_array_elements(_r->'topics') t WHERE (t->>'topic_id')::uuid = _topic;

    -- 1. Every syllabus chapter is on the map, practised or not.
    IF jsonb_array_length(_r->'chapters') <> _syllabus THEN
      _fail := _fail || ' [1 chapters ' || jsonb_array_length(_r->'chapters') || ' of ' || _syllabus || ']';
    END IF;
    IF _c0 IS NULL OR _t0 IS NULL THEN
      _fail := _fail || ' [1 the fixture chapter or topic is not on the map]';
    END IF;

    -- The fixture: for the student, 2 right and 1 wrong today, 1 right 40 days
    -- ago, 1 skipped and 1 left out of accuracy; for another student, 3 answers.
    INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at)
      VALUES (_a, _a_school, 'Probe 20261145', 'Probe', 6, now()) RETURNING id INTO _sess;
    INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at)
      VALUES (_b, _b_school, 'Probe 20261145', 'Probe', 3, now()) RETURNING id INTO _bsess;
    INSERT INTO public.question_attempts (user_id, school_id, session_id, bank_question_id, generated_question, correct_answer, is_correct, skipped, excluded_from_accuracy, created_at) VALUES
      (_a, _a_school, _sess, _q, '{}', '{}', true,  false, false, now()),
      (_a, _a_school, _sess, _q, '{}', '{}', true,  false, false, now()),
      (_a, _a_school, _sess, _q, '{}', '{}', false, false, false, now()),
      (_a, _a_school, _sess, _q, '{}', '{}', true,  false, false, now() - interval '40 days'),
      (_a, _a_school, _sess, _q, '{}', '{}', false, true,  false, now()),
      (_a, _a_school, _sess, _q, '{}', '{}', false, false, true,  now()),
      (_b, _b_school, _bsess, _q, '{}', '{}', true, false, false, now()),
      (_b, _b_school, _bsess, _q, '{}', '{}', true, false, false, now()),
      (_b, _b_school, _bsess, _q, '{}', '{}', false, false, false, now());

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    _r := public.rpc_student_syllabus_map(14);
    EXECUTE 'RESET ROLE';
    SELECT c INTO _c1 FROM jsonb_array_elements(_r->'chapters') c WHERE (c->>'chapter_id')::uuid = _ch;
    SELECT t INTO _t1 FROM jsonb_array_elements(_r->'topics') t WHERE (t->>'topic_id')::uuid = _topic;

    -- 2. Their own answers, and only those: +4 answered, +3 right, of them +3
    --    and +2 recent. Not the skip, not the excluded one, not the other student's.
    IF (_c1->>'answered')::int - (_c0->>'answered')::int <> 4
       OR (_c1->>'correct')::int - (_c0->>'correct')::int <> 3
       OR (_c1->>'recent_answered')::int - (_c0->>'recent_answered')::int <> 3
       OR (_c1->>'recent_correct')::int - (_c0->>'recent_correct')::int <> 2 THEN
      _fail := _fail || ' [2 chapter ' || coalesce(_c0::text, 'null') || ' -> ' || coalesce(_c1::text, 'null') || ']';
    END IF;
    IF (_t1->>'answered')::int - (_t0->>'answered')::int <> 4
       OR (_t1->>'correct')::int - (_t0->>'correct')::int <> 3
       OR (_t1->>'recent_answered')::int - (_t0->>'recent_answered')::int <> 3
       OR (_t1->>'recent_correct')::int - (_t0->>'recent_correct')::int <> 2 THEN
      _fail := _fail || ' [2 topic ' || coalesce(_t0::text, 'null') || ' -> ' || coalesce(_t1::text, 'null') || ']';
    END IF;

    -- 3. A window of 60 days counts the 40-day-old answer as recent too.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    _r := public.rpc_student_syllabus_map(60);
    EXECUTE 'RESET ROLE';
    IF (SELECT (c->>'recent_answered')::int FROM jsonb_array_elements(_r->'chapters') c WHERE (c->>'chapter_id')::uuid = _ch)
       < (_c1->>'recent_answered')::int + 1 THEN
      _fail := _fail || ' [3 the window did not move]';
    END IF;

    -- 4. Refusals: a stranger, no identity, a window out of range.
    PERFORM set_config('request.jwt.claims', NULL, true);
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM public.rpc_student_syllabus_map(14);
      _fail := _fail || ' [4 a stranger read a map]';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.rpc_student_syllabus_map(14);
      _fail := _fail || ' [4 read with no identity]';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'auth required' THEN _fail := _fail || ' [4 ' || SQLERRM || ']'; END IF;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.rpc_student_syllabus_map(0);
      _fail := _fail || ' [4 a zero-day window was accepted]';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    EXECUTE 'RESET ROLE';

    RAISE EXCEPTION USING MESSAGE = _sentinel;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> _sentinel THEN
      RAISE EXCEPTION 'PROOF FAILED (unexpected %): %', SQLSTATE, SQLERRM;
    END IF;
  END;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'PROOF FAILED:%', _fail;
  END IF;
END $proof$;

COMMIT;
