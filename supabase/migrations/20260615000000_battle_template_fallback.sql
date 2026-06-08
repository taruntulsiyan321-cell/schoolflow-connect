-- Battleground: fallback to question_templates when question_bank is empty (Class 12 Math)

CREATE OR REPLACE FUNCTION public.rpc_battle_curriculum(_subject text, _class_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'chapter', sub.chapter,
    'topic', sub.topic
  ) ORDER BY sub.chapter, sub.topic), '[]'::jsonb)
  FROM (
    SELECT DISTINCT
      COALESCE(NULLIF(trim(chapter), ''), 'General') AS chapter,
      NULLIF(trim(topic), '') AS topic
    FROM public.question_bank
    WHERE is_approved AND lower(subject) = lower(_subject)
      AND (
        _class_id IS NULL
        OR class_level IS NULL
        OR class_level = public._class_grade(_class_id)
      )
    UNION
    SELECT DISTINCT
      qt.chapter,
      NULL::text AS topic
    FROM public.question_templates qt
    WHERE qt.is_active
      AND lower(qt.subject) = lower(_subject)
      AND (
        _class_id IS NULL
        OR qt.class = public._class_grade(_class_id)
        OR public._class_grade(_class_id) IS NULL
      )
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_battle_curriculum(text, uuid) TO authenticated;

-- Solo battle populated from client-generated template questions
CREATE OR REPLACE FUNCTION public.rpc_create_template_solo_battle(
  _subject text,
  _chapter text,
  _difficulty text DEFAULT 'medium',
  _count int DEFAULT 5,
  _per_q int DEFAULT 20,
  _class_id uuid DEFAULT NULL,
  _questions jsonb DEFAULT '[]'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _bid uuid;
  _cid uuid;
  _grade int;
  _q jsonb;
  _idx int := 0;
  _n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF jsonb_typeof(_questions) <> 'array' OR jsonb_array_length(_questions) = 0 THEN
    RAISE EXCEPTION 'No questions provided';
  END IF;

  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  _grade := public._class_grade(_cid);

  INSERT INTO public.battles (
    title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level
  ) VALUES (
    'Solo Practice · ' || _subject || ' · ' || _chapter,
    _subject, _chapter, NULL, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, false, 'solo', 'template', now(), _grade
  ) RETURNING id INTO _bid;

  FOR _q IN SELECT value FROM jsonb_array_elements(_questions)
  LOOP
    INSERT INTO public.battle_questions (battle_id, order_index, question, options, correct_index, points)
    VALUES (
      _bid,
      _idx,
      _q->>'question',
      COALESCE(_q->'options', '[]'::jsonb),
      COALESCE((_q->>'correct_index')::int, 0),
      COALESCE((_q->>'points')::int, 10)
    );
    _idx := _idx + 1;
  END LOOP;

  _n := _idx;
  UPDATE public.battles
    SET question_count = _n, duration_sec = per_question_sec * _n
    WHERE id = _bid;

  RETURN _bid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_create_template_solo_battle(text, text, text, int, int, uuid, jsonb) TO authenticated;
