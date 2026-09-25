-- ROLLBACK 20261092000000 — the recovery card is sized by formula again and
-- offers Start on the mistake count alone (the definition live before it,
-- restored verbatim).
BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_student_recovery_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid           uuid := auth.uid();
  _trigger       int;
  _deep_max      int;
  _relearn_above int;
  _out           jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  _trigger       := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;
  _deep_max      := public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int;
  _relearn_above := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;

  SELECT COALESCE(
           jsonb_agg(row ORDER BY (row->>'ready')::boolean DESC,
                                  (row->>'open_mistakes')::int DESC),
           '[]'::jsonb)
    INTO _out
    FROM (
      SELECT jsonb_build_object(
               'chapter_id',     m.chapter_id,
               'chapter',        c.name,
               'subject',        sub.name,
               'open_mistakes',  m.open_mistakes,
               'trigger_count',  _trigger,
               'ready',          (m.open_mistakes >= _trigger
                                  AND m.open_mistakes <= _relearn_above),
               'mode',           CASE
                                   WHEN m.open_mistakes > _relearn_above THEN 'relearn'
                                   WHEN m.open_mistakes < _trigger       THEN 'none'
                                   WHEN m.open_mistakes <= _deep_max     THEN 'deep'
                                   ELSE 'wide' END,
               'planned_size',   CASE
                                   WHEN m.open_mistakes > _relearn_above THEN 0
                                   WHEN m.open_mistakes <= _deep_max
                                     THEN m.open_mistakes * (
                                       public._recovery_const('RECOVERY_DEEP_TIER0')::int
                                     + public._recovery_const('RECOVERY_DEEP_TIER1')::int
                                     + public._recovery_const('RECOVERY_DEEP_TIER2')::int
                                     + public._recovery_const('RECOVERY_DEEP_TIER3')::int)
                                   ELSE m.open_mistakes * (
                                       public._recovery_const('RECOVERY_WIDE_TIER0')::int
                                     + public._recovery_const('RECOVERY_WIDE_TIER1')::int
                                     + public._recovery_const('RECOVERY_WIDE_TIER2')::int
                                     + public._recovery_const('RECOVERY_WIDE_TIER3')::int)
                                 END,
               'relearn_above',  _relearn_above,
               'state',          COALESCE(cs.state, 'has_mistakes'),
               'in_recovery',    (cs.state = 'in_recovery'),
               'last_recovery_readiness', cs.last_recovery_readiness,
               'recovered_at',   cs.recovered_at,
               'rounds_taken',   COALESCE(rs.rounds, 0)
             ) AS row
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
        LEFT JOIN public.chapter_state cs
               ON cs.user_id = _uid AND cs.chapter_id = m.chapter_id
        LEFT JOIN (
          SELECT chapter_id, count(*)::int AS rounds
            FROM public.recovery_sessions
           WHERE user_id = _uid
             AND completed_at IS NOT NULL
           GROUP BY chapter_id
        ) rs ON rs.chapter_id = m.chapter_id
    ) t;

  RETURN _out;
END;
$function$;

DELETE FROM public.schema_migrations WHERE version = '20261092000000_the_recovery_card_says_what_the_session_holds';

COMMIT;
