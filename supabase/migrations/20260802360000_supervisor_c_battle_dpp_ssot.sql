-- Supervisor C mutual SSOT:
-- 1) DPP correct keys + question_attempts capture for {indexes}
-- 2) Progression Engine owns student_xp.xp (no dual score bump)
-- 3) Server-grade battle answers (no client correct_index trust)
-- 4) Win XP / wins only when battle is finished

-- ─── A) Fix DPP attempt → question_attempts mirror ───────────────────────────
CREATE OR REPLACE FUNCTION public._capture_dpp_mistakes(_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _att record; _q record; _ans record; _prio int; _existing uuid;
  _concept text; _subconcept text;
  _skipped boolean;
  _is_correct boolean;
  _sel int;
  _aid uuid;
  _qa_existing uuid;
BEGIN
  SELECT a.*, d.subject, d.chapter, d.topic, d.school_id AS dpp_school_id
    INTO _att
  FROM public.dpp_attempts a JOIN public.dpps d ON d.id = a.dpp_id
  WHERE a.id = _attempt_id;
  IF _att IS NULL THEN RETURN; END IF;

  FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
    SELECT * INTO _ans FROM public.dpp_answers WHERE attempt_id = _attempt_id AND question_id = _q.id;

    _concept := COALESCE(_q.concept, _q.subconcept, _att.topic, _att.chapter, _att.subject);
    _subconcept := COALESCE(_q.subconcept, _q.concept, _att.topic);
    IF _ans IS NULL THEN
      _sel := -1;
      _skipped := true;
      _is_correct := false;
    ELSE
      -- Grader-native shapes: indexes[] (MCQ), selected_index/index, or non-empty value/text
      _sel := COALESCE(
        (_ans.response->>'selected_index')::int,
        (_ans.response->>'index')::int,
        ((_ans.response->'indexes'->>0))::int,
        CASE
          WHEN _ans.response ? 'value' AND length(trim(COALESCE(_ans.response->>'value',''))) > 0 THEN 0
          WHEN _ans.response ? 'text' AND length(trim(COALESCE(_ans.response->>'text',''))) > 0 THEN 0
          ELSE -1
        END
      );
      _skipped := (_sel < 0) AND NOT (
        (_ans.response ? 'value' AND length(trim(COALESCE(_ans.response->>'value',''))) > 0)
        OR (_ans.response ? 'text' AND length(trim(COALESCE(_ans.response->>'text',''))) > 0)
        OR (jsonb_typeof(_ans.response->'indexes') = 'array' AND jsonb_array_length(_ans.response->'indexes') > 0)
      );
      -- Graded row is SSOT when present
      _is_correct := CASE
        WHEN _skipped THEN false
        ELSE COALESCE(_ans.is_correct, false)
      END;
    END IF;

    SELECT id INTO _qa_existing
    FROM public.question_attempts
    WHERE user_id = _att.user_id
      AND source = 'dpp'
      AND source_id = _att.dpp_id
      AND generated_question->>'dpp_question_id' = _q.id::text
    LIMIT 1;

    IF _qa_existing IS NULL THEN
      INSERT INTO public.question_attempts (
        session_id, student_id, user_id, school_id, bank_question_id,
        generated_question, selected_answer, correct_answer, score, is_correct,
        skipped, subject, chapter, topic, concept, subconcept, difficulty,
        source, source_id, practice_mode, class_level, timed_out, answered_at
      ) VALUES (
        NULL,
        _att.student_id,
        _att.user_id,
        COALESCE(_att.school_id, _att.dpp_school_id),
        NULL,
        jsonb_build_object(
          'question', _q.question,
          'options', COALESCE(_q.options, '[]'::jsonb),
          'explanation', COALESCE(_q.explanation, ''),
          'dpp_question_id', _q.id,
          'dpp_id', _att.dpp_id,
          'dpp_attempt_id', _attempt_id,
          'subject', COALESCE(_q.subject, _att.subject, 'General'),
          'chapter', COALESCE(_q.chapter, _att.chapter),
          'topic', _att.topic,
          'concept', _concept
        ),
        COALESCE(_ans.response, jsonb_build_object('selected_index', -1)),
        COALESCE(_q.correct, '{}'::jsonb),
        CASE WHEN _is_correct THEN 1 ELSE 0 END,
        _is_correct,
        _skipped,
        COALESCE(_q.subject, _att.subject, 'General'),
        COALESCE(_q.chapter, _att.chapter),
        _att.topic,
        _concept,
        _subconcept,
        'medium',
        'dpp',
        _att.dpp_id,
        'dpp',
        _q.class_level,
        _skipped AND _ans IS NULL,
        now()
      )
      RETURNING id INTO _aid;
    END IF;

    IF _ans IS NULL OR _skipped THEN
      CONTINUE;
    END IF;

    IF _is_correct THEN
      PERFORM public._upsert_concept_mastery(_att.user_id, _att.student_id, _q.class_level,
        COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
        _concept, _subconcept, true, false);
      CONTINUE;
    END IF;

    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation, times_wrong, last_wrong_at
    ) VALUES (
      _att.user_id, _att.student_id, 'dpp', _att.dpp_id, _q.id,
      _q.class_level, COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
      _att.topic, _concept, _subconcept, 'dpp',
      _q.question, _q.options, _ans.response, _q.correct, _q.explanation, 1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      mastered = false;

    PERFORM public._upsert_concept_mastery(_att.user_id, _att.student_id, _q.class_level,
      COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
      _concept, _subconcept, false, false);

    SELECT p.priority INTO _prio
    FROM public._revision_topic_priority(
      _att.user_id, COALESCE(_att.subject, 'General'), _att.chapter, _concept, NULL
    ) p;

    SELECT id INTO _existing FROM public.revision_queue
    WHERE user_id = _att.user_id AND NOT completed
      AND subject = COALESCE(_att.subject, 'General')
      AND COALESCE(chapter, '') = COALESCE(_att.chapter, '')
      AND COALESCE(topic, '') = COALESCE(_concept, '')
    LIMIT 1;

    IF _existing IS NOT NULL THEN
      UPDATE public.revision_queue SET
        priority = GREATEST(priority, _prio), reason = 'dpp_wrong', due_date = LEAST(due_date, CURRENT_DATE)
      WHERE id = _existing;
    ELSE
      INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (
        _att.user_id, _att.student_id,
        COALESCE(_att.subject, 'General'), _att.chapter, _concept,
        'dpp_wrong', _prio, CURRENT_DATE
      );
    END IF;
  END LOOP;

  BEGIN
    PERFORM public.rpc_refresh_academic_brain();
  EXCEPTION WHEN others THEN
    NULL;
  END;
END; $$;

-- ─── B) rpc_dpp_submit — grade + return stats; Progression owns XP ───────────
DROP FUNCTION IF EXISTS public.rpc_dpp_submit(uuid);
DROP FUNCTION IF EXISTS public.rpc_dpp_submit(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.rpc_dpp_submit(_attempt_id uuid, _answers jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        INSERT INTO public.dpp_answers (attempt_id, question_id, response)
        VALUES (_attempt_id, _q.id, _answers->_q.id::text)
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
    INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (auth.uid(), 'first_dpp','bronze')
      ON CONFLICT (user_id, badge_code) DO NOTHING;
    IF _total > 0 AND _correct_n = _total THEN
      INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (auth.uid(), 'dpp_perfect','gold')
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
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_dpp_submit(uuid, jsonb) TO authenticated;

-- ─── C) Server-grade battle answer submit ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_submit_battle_answer(
  _participant_id uuid,
  _question_id uuid,
  _selected_index int,
  _time_ms int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _part record;
  _battle record;
  _q record;
  _correct boolean;
  _pts int := 0;
  _new_score int;
  _new_correct int;
  _new_answered int;
  _new_time int;
BEGIN
  SELECT * INTO _part FROM public.battle_participants WHERE id = _participant_id;
  IF NOT FOUND OR _part.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not your participation';
  END IF;
  IF _part.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'Battle already finished';
  END IF;

  SELECT * INTO _battle FROM public.battles WHERE id = _part.battle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Battle not found'; END IF;

  SELECT * INTO _q FROM public.battle_questions WHERE id = _question_id AND battle_id = _part.battle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question not in this battle'; END IF;

  -- Idempotent: existing answer wins
  IF EXISTS (
    SELECT 1 FROM public.battle_answers
    WHERE participant_id = _participant_id AND question_id = _question_id
  ) THEN
    SELECT is_correct INTO _correct
    FROM public.battle_answers
    WHERE participant_id = _participant_id AND question_id = _question_id;
    RETURN jsonb_build_object(
      'is_correct', COALESCE(_correct, false),
      'points', 0,
      'correct_index', _q.correct_index,
      'score', COALESCE(_part.score, 0),
      'correct_count', COALESCE(_part.correct_count, 0),
      'answered_count', COALESCE(_part.answered_count, 0),
      'total_time_ms', COALESCE(_part.total_time_ms, 0),
      'already', true
    );
  END IF;

  _correct := (_selected_index >= 0 AND _selected_index = _q.correct_index);
  IF _correct THEN
    _pts := COALESCE(_q.points, 10)
      + GREATEST(0, FLOOR((COALESCE(_battle.per_question_sec, 30) * 1000 - GREATEST(_time_ms, 0)) / 200.0)::int);
  END IF;

  INSERT INTO public.battle_answers (participant_id, question_id, selected_index, is_correct, time_ms)
  VALUES (_participant_id, _question_id, _selected_index, _correct, GREATEST(COALESCE(_time_ms, 0), 0));

  _new_score := COALESCE(_part.score, 0) + _pts;
  _new_correct := COALESCE(_part.correct_count, 0) + CASE WHEN _correct THEN 1 ELSE 0 END;
  _new_answered := COALESCE(_part.answered_count, 0) + 1;
  _new_time := COALESCE(_part.total_time_ms, 0) + GREATEST(COALESCE(_time_ms, 0), 0);

  UPDATE public.battle_participants SET
    score = _new_score,
    correct_count = _new_correct,
    answered_count = _new_answered,
    total_time_ms = _new_time
  WHERE id = _participant_id;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_mirror_battle_answer') THEN
      PERFORM public.rpc_mirror_battle_answer(_participant_id, _question_id);
    END IF;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'is_correct', _correct,
    'points', _pts,
    'correct_index', _q.correct_index,
    'score', _new_score,
    'correct_count', _new_correct,
    'answered_count', _new_answered,
    'total_time_ms', _new_time,
    'already', false
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_submit_battle_answer(uuid, uuid, int, int) TO authenticated;

-- ─── D) rpc_finish_battle — battle stats only; Progression owns XP/level ─────
CREATE OR REPLACE FUNCTION public.rpc_finish_battle(_participant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid;
  _battle uuid;
  _score int;
  _correct int;
  _answered int;
  _time int;
  _name text;
  _already timestamptz;
  _won boolean := false;
  _max_score int;
  _participants int;
  _tied_at_max int;
  _battle_status text;
BEGIN
  SELECT user_id, battle_id, score, correct_count, answered_count, total_time_ms, display_name, finished_at
    INTO _user, _battle, _score, _correct, _answered, _time, _name, _already
  FROM public.battle_participants
  WHERE id = _participant_id;

  IF _user IS NULL OR _user <> auth.uid() THEN
    RAISE EXCEPTION 'Not your participation';
  END IF;

  IF _already IS NULL THEN
    UPDATE public.battle_participants
    SET finished_at = now()
    WHERE id = _participant_id;
  END IF;

  WITH ranked AS (
    SELECT id, RANK() OVER (ORDER BY score DESC, total_time_ms ASC, joined_at ASC) AS r
    FROM public.battle_participants
    WHERE battle_id = _battle
  )
  UPDATE public.battle_participants p
  SET rank = r.r
  FROM ranked r
  WHERE p.id = r.id;

  PERFORM public._maybe_finish_battle(_battle);

  IF _already IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT status INTO _battle_status FROM public.battles WHERE id = _battle;

  SELECT MAX(score), count(*),
         count(*) FILTER (WHERE score = (SELECT MAX(score) FROM public.battle_participants WHERE battle_id = _battle))
    INTO _max_score, _participants, _tied_at_max
  FROM public.battle_participants
  WHERE battle_id = _battle;

  -- Win only when battle is closed (all done) — avoids premature sole-max lock.
  -- Only the last finisher reaches this block (earlier finishers return on _already),
  -- so we attribute the win once to the sole top scorer (may not be the caller).
  _won := (
    COALESCE(_battle_status, '') = 'finished'
    AND _participants > 1
    AND COALESCE(_max_score, 0) > 0
    AND COALESCE(_tied_at_max, 0) = 1
  );

  BEGIN
    INSERT INTO public.student_question_history (user_id, question_id, times_seen, last_seen_at)
    SELECT _user, bq.bank_question_id, 1, now()
    FROM public.battle_answers ba
    JOIN public.battle_questions bq ON bq.id = ba.question_id
    WHERE ba.participant_id = _participant_id
      AND bq.bank_question_id IS NOT NULL
    ON CONFLICT (user_id, question_id) DO UPDATE
      SET times_seen = student_question_history.times_seen + 1,
          last_seen_at = now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Battle counters only — do NOT add score into student_xp.xp or rewrite level (/100).
  BEGIN
    INSERT INTO public.student_xp(user_id, xp, level, total_battles, wins, last_battle_at,
      best_score, total_correct, total_answered, win_streak, best_win_streak, current_streak, longest_streak)
    VALUES (
      _user, 0, 1, 1, 0, now(),
      COALESCE(_score, 0), COALESCE(_correct, 0), COALESCE(_answered, 0),
      0, 0, 0, 0
    )
    ON CONFLICT (user_id) DO UPDATE SET
      total_battles   = student_xp.total_battles + 1,
      last_battle_at  = now(),
      best_score      = GREATEST(student_xp.best_score, COALESCE(_score, 0)),
      total_correct   = student_xp.total_correct + COALESCE(_correct, 0),
      total_answered  = student_xp.total_answered + COALESCE(_answered, 0),
      updated_at      = now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Attribute win / streaks once when the battle closes
  IF _won THEN
    BEGIN
      UPDATE public.student_xp sx
      SET
        wins = sx.wins + 1,
        win_streak = sx.win_streak + 1,
        best_win_streak = GREATEST(sx.best_win_streak, sx.win_streak + 1),
        current_streak = COALESCE(sx.current_streak, 0) + 1,
        longest_streak = GREATEST(COALESCE(sx.longest_streak, 0), COALESCE(sx.current_streak, 0) + 1),
        updated_at = now()
      WHERE sx.user_id = (
        SELECT bp.user_id FROM public.battle_participants bp
        WHERE bp.battle_id = _battle AND bp.score = _max_score
        ORDER BY bp.total_time_ms ASC, bp.joined_at ASC
        LIMIT 1
      );

      UPDATE public.student_xp sx
      SET win_streak = 0, current_streak = 0, updated_at = now()
      WHERE sx.user_id IN (
        SELECT bp.user_id FROM public.battle_participants bp
        WHERE bp.battle_id = _battle
          AND bp.finished_at IS NOT NULL
          AND bp.user_id <> (
            SELECT bp2.user_id FROM public.battle_participants bp2
            WHERE bp2.battle_id = _battle AND bp2.score = _max_score
            ORDER BY bp2.total_time_ms ASC, bp2.joined_at ASC
            LIMIT 1
          )
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  ELSIF COALESCE(_battle_status, '') = 'finished' THEN
    -- Draw / multi-tie: clear win streaks for all finishers
    BEGIN
      UPDATE public.student_xp sx
      SET win_streak = 0, current_streak = 0, updated_at = now()
      WHERE sx.user_id IN (
        SELECT bp.user_id FROM public.battle_participants bp
        WHERE bp.battle_id = _battle AND bp.finished_at IS NOT NULL
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  BEGIN
    IF _won THEN
      PERFORM public._award_badge((
        SELECT bp.user_id FROM public.battle_participants bp
        WHERE bp.battle_id = _battle AND bp.score = _max_score
        ORDER BY bp.total_time_ms ASC, bp.joined_at ASC
        LIMIT 1
      ), 'first_win', 'bronze');
    END IF;
    IF _correct >= 5 THEN PERFORM public._award_badge(_user, 'sharp_shooter', 'silver'); END IF;
    IF _answered >= 5 AND _correct = _answered THEN PERFORM public._award_badge(_user, 'flawless', 'gold'); END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_capture_battle_mistakes') THEN
      PERFORM public._capture_battle_mistakes(_participant_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Progression win/top when battle closes (idempotent; works even if winner finished first)
  IF COALESCE(_battle_status, '') = 'finished'
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_apply_progression') THEN
    DECLARE
      _bp record;
    BEGIN
      FOR _bp IN
        SELECT id, user_id, rank
        FROM public.battle_participants
        WHERE battle_id = _battle
          AND finished_at IS NOT NULL
          AND rank IS NOT NULL
          AND rank BETWEEN 1 AND 3
      LOOP
        BEGIN
          PERFORM public.rpc_apply_progression(
            CASE WHEN _bp.rank = 1 THEN 'battle.win' ELSE 'battle.top_finish' END,
            'battle',
            _battle::text,
            CASE WHEN _bp.rank = 1 THEN 'battle.win:' ELSE 'battle.top:' END || _bp.id::text,
            NULL,
            jsonb_build_object('via', 'rpc_finish_battle'),
            _bp.user_id
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  BEGIN
    PERFORM public._bump_academic_activity(_user, 0, 1, CASE WHEN _won THEN 1 ELSE 0 END, GREATEST(COALESCE(_time,0) / 60000, 1));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_finish_battle(uuid) TO authenticated;
