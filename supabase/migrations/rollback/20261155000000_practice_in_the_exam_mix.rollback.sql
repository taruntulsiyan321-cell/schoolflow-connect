-- ROLLBACK 20261155000000 — practice no longer reads the exam's form mix.
--
-- Drops rpc_exam_form_mix, puts _mock_targets back exactly as
-- 20261150000000 left it (its own form query), and drops the helper.

BEGIN;

DROP FUNCTION public.rpc_exam_form_mix(text);

CREATE OR REPLACE FUNCTION public._mock_targets(_exam uuid, _subject text, _chapter uuid, _options jsonb)
RETURNS TABLE(kind text, key text, questions integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _want    int := (public._mock_paper()->>'questions')::int;
  _missing text;
BEGIN
  SELECT string_agg(DISTINCT o.label_group, '; ') INTO _missing
    FROM (SELECT o.option_group, string_agg(o.label, ' or ' ORDER BY o.position) AS label_group
            FROM public.exam_blueprint_options o
           WHERE o.exam_id = _exam AND lower(o.subject) = lower(_subject)
             AND (_chapter IS NULL OR EXISTS (
                   SELECT 1 FROM public.exam_blueprint_forms f
                    WHERE f.exam_id = _exam AND lower(f.subject) = lower(_subject) AND f.option_group = o.option_group))
           GROUP BY o.option_group) o
   WHERE NOT EXISTS (SELECT 1 FROM public.exam_blueprint_options c
                      WHERE c.exam_id = _exam AND lower(c.subject) = lower(_subject)
                        AND c.option_group = o.option_group AND c.option = _options->>o.option_group);
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'mock_option_not_chosen' USING ERRCODE = 'P0001',
      DETAIL = format('Choose first: %s.', _missing);
  END IF;

  IF _chapter IS NULL THEN
    RETURN QUERY
      SELECT 'chapter'::text, b.chapter_id::text, sum(b.questions)::int
        FROM public.exam_blueprint_chapters b
        JOIN public.chapters c ON c.id = b.chapter_id
        JOIN public.curriculum_subjects s ON s.id = c.curriculum_subject_id
       WHERE b.exam_id = _exam AND lower(s.name) = lower(_subject)
         AND (b.option_group = '' OR b.option = _options->>b.option_group)
       GROUP BY b.chapter_id;
  ELSE
    RETURN QUERY SELECT 'chapter'::text, _chapter::text, _want;
  END IF;
  RETURN QUERY
    SELECT 'form'::text, f.form, sum(f.questions)::int
      FROM public.exam_blueprint_forms f
     WHERE f.exam_id = _exam AND lower(f.subject) = lower(_subject)
       AND (f.option_group = '' OR f.option = _options->>f.option_group)
     GROUP BY f.form;
END $$;

DROP FUNCTION public._blueprint_forms(uuid, text, jsonb);

COMMIT;
