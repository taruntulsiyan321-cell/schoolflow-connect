-- rpc_student_chapter_analysis (20261057000000) answered correctly and cost
-- 443 ms of database time per call: every chapter re-scanned the student's
-- answers through a dozen correlated subqueries, and every topic did again.
-- Same output, aggregated once per chapter and once per (chapter, topic),
-- then joined. Verified against the previous version's output below.
CREATE OR REPLACE FUNCTION public.rpc_student_chapter_analysis()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE _uid uuid := auth.uid(); _out jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  WITH att AS MATERIALIZED (
    SELECT qa.session_id, qa.created_at, qa.is_correct, COALESCE(qa.skipped, false) AS skipped,
           qa.time_taken_ms, q.chapter_id, q.topic_id
      FROM public.question_attempts qa
      JOIN public.question_bank q ON q.id = qa.bank_question_id
     WHERE qa.user_id = _uid AND q.chapter_id IS NOT NULL
  ),
  skp AS MATERIALIZED (
    SELECT q.chapter_id, q.topic_id
      FROM public._still_skipped_questions(_uid) s
      JOIN public.question_bank q ON q.id = s.bank_question_id
     WHERE q.chapter_id IS NOT NULL
  ),
  mis AS MATERIALIZED (
    SELECT sm.chapter_id, sm.times_wrong, sm.created_at, q.topic_id
      FROM public.student_mistakes sm
      LEFT JOIN public.question_bank q ON q.id = sm.question_id
     WHERE sm.user_id = _uid AND sm.status = 'open' AND sm.source = 'practice'
       AND sm.chapter_id IS NOT NULL
  ),
  st AS (
    SELECT cs.chapter_id, cs.state, cs.revision_stage, cs.next_revision_at
      FROM public.chapter_state cs WHERE cs.user_id = _uid
  ),
  a_ch AS (
    SELECT chapter_id,
           count(*) FILTER (WHERE NOT skipped)::int AS answered,
           count(*) FILTER (WHERE is_correct AND NOT skipped)::int AS correct,
           count(*) FILTER (WHERE COALESCE(time_taken_ms, 0) > 0)::int AS timed,
           round(avg(time_taken_ms) FILTER (WHERE COALESCE(time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec
      FROM att GROUP BY chapter_id
  ),
  s_ch AS (SELECT chapter_id, count(*)::int AS skipped FROM skp GROUP BY chapter_id),
  m_ch AS (
    SELECT chapter_id, count(*)::int AS open_mistakes,
           count(*) FILTER (WHERE times_wrong > 1)::int AS repeated,
           min(created_at) AS oldest_open_at
      FROM mis GROUP BY chapter_id
  ),
  sess AS (
    SELECT chapter_id, jsonb_agg(jsonb_build_object('answered', answered, 'correct', correct) ORDER BY at) AS sessions
      FROM (
        SELECT chapter_id, session_id, min(created_at) AS at,
               count(*) FILTER (WHERE NOT skipped)::int AS answered,
               count(*) FILTER (WHERE is_correct AND NOT skipped)::int AS correct
          FROM att WHERE session_id IS NOT NULL
         GROUP BY chapter_id, session_id
        HAVING count(*) FILTER (WHERE NOT skipped) > 0
      ) ps
     GROUP BY chapter_id
  ),
  t_raw AS (
    SELECT chapter_id, topic_id,
           count(*) FILTER (WHERE NOT skipped)::int AS answered,
           count(*) FILTER (WHERE is_correct AND NOT skipped)::int AS correct,
           0 AS skipped, 0 AS open_mistakes
      FROM att WHERE topic_id IS NOT NULL GROUP BY chapter_id, topic_id
    UNION ALL
    SELECT chapter_id, topic_id, 0, 0, count(*)::int, 0 FROM skp WHERE topic_id IS NOT NULL GROUP BY chapter_id, topic_id
    UNION ALL
    SELECT chapter_id, topic_id, 0, 0, 0, count(*)::int FROM mis WHERE topic_id IS NOT NULL GROUP BY chapter_id, topic_id
  ),
  t_ch AS (
    SELECT t.chapter_id,
           jsonb_agg(jsonb_build_object('topic', tp.name, 'answered', t.answered, 'correct', t.correct,
                                        'skipped', t.skipped, 'open_mistakes', t.open_mistakes) ORDER BY tp.name) AS topics
      FROM (SELECT chapter_id, topic_id, sum(answered)::int AS answered, sum(correct)::int AS correct,
                   sum(skipped)::int AS skipped, sum(open_mistakes)::int AS open_mistakes
              FROM t_raw GROUP BY chapter_id, topic_id) t
      JOIN public.topics tp ON tp.id = t.topic_id
     GROUP BY t.chapter_id
  ),
  chs AS (
    SELECT chapter_id FROM a_ch UNION SELECT chapter_id FROM s_ch
    UNION SELECT chapter_id FROM m_ch
    UNION SELECT chapter_id FROM st WHERE state = 'revision_failed'
  ),
  subj AS (
    SELECT DISTINCT ON (q.chapter_id) q.chapter_id, q.subject
      FROM public.question_bank q WHERE q.chapter_id IN (SELECT chapter_id FROM chs)
     ORDER BY q.chapter_id
  )
  SELECT jsonb_build_object(
    'student_avg_sec', (SELECT round(avg(time_taken_ms) FILTER (WHERE COALESCE(time_taken_ms, 0) > 0) / 1000.0, 1) FROM att),
    'student_timed',   (SELECT count(*) FILTER (WHERE COALESCE(time_taken_ms, 0) > 0)::int FROM att),
    'chapters', COALESCE(jsonb_agg(jsonb_build_object(
        'chapter_id', c.chapter_id,
        'chapter', ch.name,
        'subject', subj.subject,
        'open_mistakes', COALESCE(m.open_mistakes, 0),
        'repeated', COALESCE(m.repeated, 0),
        'oldest_open_at', m.oldest_open_at,
        'answered', COALESCE(a.answered, 0),
        'correct', COALESCE(a.correct, 0),
        'skipped', COALESCE(s.skipped, 0),
        'timed', COALESCE(a.timed, 0),
        'avg_sec', a.avg_sec,
        'sessions', COALESCE(sess.sessions, '[]'::jsonb),
        'state', st.state,
        'revision_stage', st.revision_stage,
        'next_revision_at', st.next_revision_at,
        'topics', COALESCE(t.topics, '[]'::jsonb))), '[]'::jsonb))
    INTO _out
    FROM chs c
    JOIN public.chapters ch ON ch.id = c.chapter_id
    LEFT JOIN a_ch a ON a.chapter_id = c.chapter_id
    LEFT JOIN s_ch s ON s.chapter_id = c.chapter_id
    LEFT JOIN m_ch m ON m.chapter_id = c.chapter_id
    LEFT JOIN sess ON sess.chapter_id = c.chapter_id
    LEFT JOIN t_ch t ON t.chapter_id = c.chapter_id
    LEFT JOIN st ON st.chapter_id = c.chapter_id
    LEFT JOIN subj ON subj.chapter_id = c.chapter_id;

  RETURN _out;
END;
$fn$;
