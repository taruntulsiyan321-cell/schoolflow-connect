-- Data-completeness fix, found via a schema-wide sweep for partially-
-- populated nullable columns (the same signature as the earlier
-- battle-family bug: some write paths set a column, others silently don't).
-- Neither notifications' nor student_badges' RLS depends on school_id (both
-- are scoped by user_id/auth.uid() directly), so this was never a security
-- hole -- but "everything stored properly" means fixing incomplete rows and
-- the write paths that produce them, not just the ones RLS happens to need.
--
-- notifications.school_id: 28/37 rows (75.7%) NULL. The only insert path,
-- _notify(uuid,...), never set it.
-- student_badges.school_id: 1/6 rows (16.7%) NULL. Two insert paths:
-- _award_badge() already RESOLVES the correct school (_school) for its own
-- event-emission call right after the insert -- it just never passed that
-- value INTO the insert itself. rpc_dpp_submit()'s two inline badge inserts
-- never set it either, despite having _att.school_id (the parent
-- dpp_attempts row, already fixed for school_id earlier this session)
-- sitting right there unused.

-- Backfill existing rows first.
UPDATE public.notifications n
SET school_id = p.school_id
FROM public.profiles p
WHERE n.user_id = p.id AND n.school_id IS NULL AND p.school_id IS NOT NULL;

UPDATE public.student_badges b
SET school_id = COALESCE(s.school_id, p.school_id)
FROM public.profiles p
LEFT JOIN public.students s ON s.user_id = p.id
WHERE b.user_id = p.id AND b.school_id IS NULL;

-- Fix the write paths.
CREATE OR REPLACE FUNCTION public._notify(_uid uuid, _type text, _title text, _body text DEFAULT NULL::text, _icon text DEFAULT NULL::text, _link text DEFAULT NULL::text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.notifications(user_id, type, title, body, icon, link, school_id)
  VALUES (_uid, _type, _title, _body, _icon, _link, (SELECT school_id FROM public.profiles WHERE id = _uid));
$function$;

CREATE OR REPLACE FUNCTION public._award_badge(_uid uuid, _code text, _tier badge_tier DEFAULT 'bronze'::badge_tier)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _inserted uuid;
  _school uuid;
  _student uuid;
BEGIN
  SELECT s.id, s.school_id INTO _student, _school
  FROM public.students s
  WHERE s.user_id = _uid
  LIMIT 1;

  _school := coalesce(
    _school,
    public.get_my_school_id(),
    public.default_school_id()
  );

  INSERT INTO public.student_badges(user_id, badge_code, tier, school_id)
  VALUES (_uid, _code, _tier, _school)
  ON CONFLICT (user_id, badge_code) DO NOTHING
  RETURNING user_id INTO _inserted;

  IF _inserted IS NULL THEN
    RETURN;
  END IF;

  IF _school IS NOT NULL THEN
    PERFORM public.emit_academic_event(
      'badge.earned',
      'student_badge',
      NULL,
      _school,
      _student,
      NULL,
      NULL,
      jsonb_build_object('badge_code', _code, 'tier', _tier::text, 'user_id', _uid)
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_dpp_submit(_attempt_id uuid, _answers jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _att record; _q record; _ans record; _correct boolean; _award numeric;
  _score numeric := 0; _correct_n int := 0; _total int := 0; _neg numeric;
  _resp jsonb; _selected jsonb; _val numeric; _tol numeric; _has_answer boolean;
  _accuracy numeric := 0;
BEGIN
  SELECT * INTO _att FROM public.dpp_attempts WHERE id = _attempt_id;
  IF NOT FOUND OR _att.user_id <> auth.uid() THEN RAISE EXCEPTION 'Not your attempt'; END IF;
  IF _att.status = 'submitted' THEN
    RETURN jsonb_build_object(
      'score', COALESCE(_att.score, 0),
      'correct_count', COALESCE(_att.correct_count, 0),
      'total_count', COALESCE(_att.total_count, 0),
      'accuracy', CASE
        WHEN COALESCE(_att.total_count, 0) > 0
          THEN round(100.0 * COALESCE(_att.correct_count, 0) / _att.total_count, 1)
        ELSE 0
      END,
      'already_submitted', true
    );
  END IF;

  -- Optional bulk answers payload (legacy clients)
  IF _answers IS NOT NULL AND jsonb_typeof(_answers) = 'object' THEN
    FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
      IF _answers ? _q.id::text THEN
        INSERT INTO public.dpp_answers (attempt_id, question_id, response, school_id)
        VALUES (_attempt_id, _q.id, _answers->_q.id::text, _att.school_id)
        ON CONFLICT (attempt_id, question_id) DO UPDATE SET response = EXCLUDED.response;
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(negative_marking, 0) INTO _neg FROM public.dpps WHERE id = _att.dpp_id;
  FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
    _total := _total + 1;
    SELECT * INTO _ans FROM public.dpp_answers WHERE attempt_id = _attempt_id AND question_id = _q.id;
    _has_answer := FOUND; _correct := false; _award := 0;
    IF _has_answer THEN
      _resp := _ans.response;
      IF _q.kind IN ('mcq','multi') THEN
        _selected := COALESCE(_resp->'indexes','[]'::jsonb);
        IF jsonb_array_length(_selected) > 0 AND
           (SELECT array_agg(value::int ORDER BY value::int) FROM jsonb_array_elements_text(_selected) AS value)
           = (SELECT array_agg(value::int ORDER BY value::int) FROM jsonb_array_elements_text(COALESCE(_q.correct->'indexes','[]'::jsonb)) AS value)
        THEN _correct := true; END IF;
      ELSIF _q.kind = 'numerical' THEN
        IF _resp ? 'value' AND (_resp->>'value') IS NOT NULL THEN
          BEGIN
            _val := (_resp->>'value')::numeric;
            _tol := COALESCE((_q.correct->>'tolerance')::numeric, 0);
            IF abs(_val - (_q.correct->>'value')::numeric) <= _tol THEN _correct := true; END IF;
          EXCEPTION WHEN others THEN
            _correct := false;
          END;
        END IF;
      ELSIF _q.kind = 'short' THEN
        IF lower(trim(COALESCE(_resp->>'text',''))) = lower(trim(COALESCE(_q.correct->>'text',''))) AND
           length(trim(COALESCE(_resp->>'text',''))) > 0 THEN _correct := true; END IF;
      END IF;
      IF _correct THEN _award := COALESCE(_q.marks, 1); _correct_n := _correct_n + 1;
      ELSIF _resp <> '{}'::jsonb THEN _award := -1 * COALESCE(_neg, 0); END IF;
      UPDATE public.dpp_answers SET is_correct = _correct, marks_awarded = _award WHERE id = _ans.id;
      _score := _score + _award;
    END IF;
  END LOOP;

  UPDATE public.dpp_attempts SET status = 'submitted', submitted_at = now(),
    score = _score, correct_count = _correct_n, total_count = _total,
    time_spent_sec = GREATEST(EXTRACT(EPOCH FROM (now() - started_at))::int, 0)
  WHERE id = _attempt_id;

  -- Progression Engine owns student_xp.xp / level / league — do not bump here.
  BEGIN
    INSERT INTO public.student_badges(user_id, badge_code, tier, school_id) VALUES (auth.uid(), 'first_dpp','bronze', _att.school_id)
      ON CONFLICT (user_id, badge_code) DO NOTHING;
    IF _total > 0 AND _correct_n = _total THEN
      INSERT INTO public.student_badges(user_id, badge_code, tier, school_id) VALUES (auth.uid(), 'dpp_perfect','gold', _att.school_id)
        ON CONFLICT (user_id, badge_code) DO NOTHING;
    END IF;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  PERFORM public._capture_dpp_mistakes(_attempt_id);
  BEGIN
    PERFORM public._bump_academic_activity(auth.uid(), 1, 0, 0, GREATEST(COALESCE(_att.time_spent_sec,0) / 60, 1));
  EXCEPTION WHEN others THEN
    NULL;
  END;

  IF _total > 0 THEN
    _accuracy := round(100.0 * _correct_n / _total, 1);
  END IF;

  RETURN jsonb_build_object(
    'score', _score,
    'correct_count', _correct_n,
    'total_count', _total,
    'accuracy', _accuracy,
    'already_submitted', false
  );
END; $function$;
