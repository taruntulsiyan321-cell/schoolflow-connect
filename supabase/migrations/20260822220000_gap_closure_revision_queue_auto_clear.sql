-- Gap closure, 2026-08-22: _rebuild_revision_queue already does real,
-- accuracy-severity-based due-date scheduling (0/1/2 days out depending on
-- how weak the topic is, re-verified by reading its current live body) --
-- narrower and more nuanced than first assessed. The actual gap: once a
-- topic's accuracy recovers to >= 60% (the same threshold this function
-- itself uses to decide what counts as "weak"), the function simply stops
-- touching that topic's existing revision_queue row -- it's never
-- completed or removed, so a student who has since mastered a topic still
-- sees it sitting in their revision queue at its last (now stale) priority
-- and due_date, indefinitely, until they manually mark it done. Fixed by
-- adding a step that auto-completes any not-yet-completed revision_queue
-- row whose topic no longer qualifies as weak, using the SAME
-- _weak_topics_for_user() data source this function already trusts for
-- everything else, so this can't disagree with the function's own idea of
-- "weak" -- rechecked without the top-8 LIMIT the main loop uses, so a
-- topic that's still weak but ranked outside the top 8 worst is correctly
-- left alone, not wrongly auto-cleared.
CREATE OR REPLACE FUNCTION public._rebuild_revision_queue(_uid uuid, _student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row record;
  _prio int;
  _existing uuid;
  _due date;
BEGIN
  FOR _row IN
    SELECT * FROM public._weak_topics_for_user(_uid) WHERE accuracy < 60 ORDER BY accuracy ASC LIMIT 8
  LOOP
    IF public._revision_recently_completed(_uid, _row.subject, _row.chapter, _row.topic, 7) THEN
      CONTINUE;
    END IF;

    SELECT p.priority INTO _prio
    FROM public._revision_topic_priority(_uid, _row.subject, _row.chapter, _row.topic, _row.accuracy) p;

    SELECT id INTO _existing FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed
      AND subject = _row.subject
      AND COALESCE(chapter, '') = COALESCE(_row.chapter, '')
      AND COALESCE(topic, '') = COALESCE(_row.topic, '')
    LIMIT 1;

    _due := CURRENT_DATE + CASE WHEN _row.accuracy < 40 THEN 0 WHEN _row.accuracy < 50 THEN 1 ELSE 2 END;

    IF _existing IS NOT NULL THEN
      UPDATE public.revision_queue SET
        priority = _prio, reason = 'weak_topic', due_date = LEAST(due_date, _due), student_id = _student_id
      WHERE id = _existing;
    ELSE
      INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (_uid, _student_id, _row.subject, _row.chapter, _row.topic, 'weak_topic', _prio, _due);
    END IF;
  END LOOP;

  FOR _row IN
    SELECT rq.*, w.accuracy
    FROM public.revision_queue rq
    LEFT JOIN public._weak_topics_for_user(_uid) w
      ON w.subject = rq.subject
     AND COALESCE(w.chapter, '') = COALESCE(rq.chapter, '')
     AND COALESCE(w.topic, '') = COALESCE(rq.topic, '')
    WHERE rq.user_id = _uid AND NOT rq.completed AND rq.reason = 'dpp_wrong'
  LOOP
    SELECT p.priority INTO _prio
    FROM public._revision_topic_priority(_uid, _row.subject, _row.chapter, _row.topic, _row.accuracy) p;
    UPDATE public.revision_queue SET priority = _prio WHERE id = _row.id;
  END LOOP;

  -- Auto-clear: a topic whose accuracy has recovered to >= 60 no longer
  -- belongs in an open revision queue. Only acts on rows where we have
  -- current accuracy data confirming recovery (w.accuracy IS NOT NULL) --
  -- a row with no matching attempt data is left untouched rather than
  -- guessed at.
  UPDATE public.revision_queue rq
  SET completed = true, completed_at = now()
  FROM public._weak_topics_for_user(_uid) w
  WHERE rq.user_id = _uid AND NOT rq.completed
    AND w.subject = rq.subject
    AND COALESCE(w.chapter, '') = COALESCE(rq.chapter, '')
    AND COALESCE(w.topic, '') = COALESCE(rq.topic, '')
    AND w.accuracy >= 60;
END; $function$;
