-- ROLLBACK 20261058000000 — restores the 20261057000000 body of
-- rpc_student_chapter_analysis: the same output through correlated
-- subqueries, ~443 ms of database time per call instead of ~56 ms.
CREATE OR REPLACE FUNCTION public.rpc_student_chapter_analysis()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE _uid uuid := auth.uid(); _out jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  WITH att AS (
    SELECT qa.session_id, qa.created_at, qa.is_correct, COALESCE(qa.skipped, false) AS skipped,
           qa.time_taken_ms, q.chapter_id, q.topic_id
      FROM public.question_attempts qa
      JOIN public.question_bank q ON q.id = qa.bank_question_id
     WHERE qa.user_id = _uid AND q.chapter_id IS NOT NULL
  ),
  skp AS (
    SELECT q.chapter_id, q.topic_id
      FROM public._still_skipped_questions(_uid) s
      JOIN public.question_bank q ON q.id = s.bank_question_id
     WHERE q.chapter_id IS NOT NULL
  ),
  mis AS (
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
  chs AS (
    SELECT chapter_id FROM att UNION SELECT chapter_id FROM skp
    UNION SELECT chapter_id FROM mis
    UNION SELECT chapter_id FROM st WHERE state = 'revision_failed'
  ),
  per_session AS (
    SELECT chapter_id, session_id, min(created_at) AS at,
           count(*) FILTER (WHERE NOT skipped)::int AS answered,
           count(*) FILTER (WHERE is_correct AND NOT skipped)::int AS correct
      FROM att WHERE session_id IS NOT NULL
     GROUP BY chapter_id, session_id
    HAVING count(*) FILTER (WHERE NOT skipped) > 0
  ),
  topic_ids AS (
    SELECT chapter_id, topic_id FROM att WHERE topic_id IS NOT NULL
    UNION SELECT chapter_id, topic_id FROM skp WHERE topic_id IS NOT NULL
    UNION SELECT chapter_id, topic_id FROM mis WHERE topic_id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'student_avg_sec', (SELECT round(avg(time_taken_ms) FILTER (WHERE COALESCE(time_taken_ms, 0) > 0) / 1000.0, 1) FROM att),
    'student_timed',   (SELECT count(*) FILTER (WHERE COALESCE(time_taken_ms, 0) > 0)::int FROM att),
    'chapters', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'chapter_id', c.chapter_id,
        'chapter', ch.name,
        'subject', (SELECT q.subject FROM public.question_bank q WHERE q.chapter_id = c.chapter_id LIMIT 1),
        'open_mistakes', (SELECT count(*)::int FROM mis WHERE mis.chapter_id = c.chapter_id),
        'repeated',      (SELECT count(*)::int FROM mis WHERE mis.chapter_id = c.chapter_id AND mis.times_wrong > 1),
        'oldest_open_at',(SELECT min(mis.created_at) FROM mis WHERE mis.chapter_id = c.chapter_id),
        'answered', (SELECT count(*) FILTER (WHERE NOT skipped)::int FROM att WHERE att.chapter_id = c.chapter_id),
        'correct',  (SELECT count(*) FILTER (WHERE is_correct AND NOT skipped)::int FROM att WHERE att.chapter_id = c.chapter_id),
        'skipped',  (SELECT count(*)::int FROM skp WHERE skp.chapter_id = c.chapter_id),
        'timed',    (SELECT count(*) FILTER (WHERE COALESCE(time_taken_ms, 0) > 0)::int FROM att WHERE att.chapter_id = c.chapter_id),
        'avg_sec',  (SELECT round(avg(time_taken_ms) FILTER (WHERE COALESCE(time_taken_ms, 0) > 0) / 1000.0, 1) FROM att WHERE att.chapter_id = c.chapter_id),
        'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object('answered', ps.answered, 'correct', ps.correct) ORDER BY ps.at)
                                FROM per_session ps WHERE ps.chapter_id = c.chapter_id), '[]'::jsonb),
        'state', st.state,
        'revision_stage', st.revision_stage,
        'next_revision_at', st.next_revision_at,
        'topics', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'topic', tp.name,
                   'answered', (SELECT count(*) FILTER (WHERE NOT skipped)::int FROM att WHERE att.chapter_id = c.chapter_id AND att.topic_id = ti.topic_id),
                   'correct',  (SELECT count(*) FILTER (WHERE is_correct AND NOT skipped)::int FROM att WHERE att.chapter_id = c.chapter_id AND att.topic_id = ti.topic_id),
                   'skipped',  (SELECT count(*)::int FROM skp WHERE skp.chapter_id = c.chapter_id AND skp.topic_id = ti.topic_id),
                   'open_mistakes', (SELECT count(*)::int FROM mis WHERE mis.chapter_id = c.chapter_id AND mis.topic_id = ti.topic_id))
                 ORDER BY tp.name)
            FROM topic_ids ti JOIN public.topics tp ON tp.id = ti.topic_id
           WHERE ti.chapter_id = c.chapter_id), '[]'::jsonb)
      ))
        FROM chs c
        JOIN public.chapters ch ON ch.id = c.chapter_id
        LEFT JOIN st ON st.chapter_id = c.chapter_id
    ), '[]'::jsonb)
  ) INTO _out;

  RETURN _out;
END;
$fn$;
DELETE FROM public.schema_migrations WHERE version = '20261058000000_the_chapter_list_reads_each_answer_once';
