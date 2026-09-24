-- ===========================================================================
-- UPLOAD ATTEMPTS DO NOT NEED A TEMPLATE
--
-- Binding: docs/custom-practice-upload-spec.md Â§9 / Â§12.2
--
-- Measured defect (2026-09-24, Â§12.2 measure as exam_cuet):
--   Non-bank ELSE branch SELECTs into _tm only when _template_id IS NOT NULL,
--   then always dereferences _tm.subconcept / _tm.subject in COALESCE.
--   Upload attempts (bank_question_id NULL, template_id NULL) raise:
--     record "_tm" is not assigned yet
--
-- Fix: only read _tm fields inside the _template_id IS NOT NULL arm.
--
-- ROLLBACK: rollback/20261074000000_upload_attempts_dont_need_a_template.rollback.sql
-- ===========================================================================

BEGIN;

DO $rewrite$
DECLARE
  _def text;
  _new text;
  -- Unique needle from the defective arm (must not appear after the fix).
  _needle text := E'_sub_f := COALESCE(_tm.subconcept, _concept_f);\n    _class := COALESCE(\n      NULLIF(_m->>''class_level'', '''')::int,\n      _tm.class, _ps.class_level, 12\n    );';
  _old_arm text;
  _new_arm text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_record_question_attempt';
  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_record_question_attempt not found';
  END IF;

  IF position('Upload / free-text: no bank row, often no template' IN _def) > 0 THEN
    RAISE NOTICE 'already applied';
    RETURN;
  END IF;

  IF position(_needle IN _def) = 0 THEN
    RAISE EXCEPTION
      'unguarded _tm.subconcept needle missing â€” live body changed; re-read pg_get_functiondef';
  END IF;

  -- Locate the ELSE â€¦ END IF arm that owns the needle.
  _old_arm := substring(
    _def
    from position(E'ELSE\n    IF _template_id IS NOT NULL THEN\n      SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;\n    END IF;\n    _subject := COALESCE(' IN _def)
    for (
      position(E'_mistake_qid := _bank_id;\n  END IF;' IN _def)
      - position(E'ELSE\n    IF _template_id IS NOT NULL THEN\n      SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;\n    END IF;\n    _subject := COALESCE(' IN _def)
      + length(E'_mistake_qid := _bank_id;\n  END IF;')
    )
  );

  IF _old_arm IS NULL OR position('_sub_f := COALESCE(_tm.subconcept' IN _old_arm) = 0 THEN
    RAISE EXCEPTION 'could not slice defective ELSE arm (len=%)', length(coalesce(_old_arm, ''));
  END IF;

  _new_arm := $arm$ELSE
    -- Upload / free-text: no bank row, often no template. Never dereference
    -- _tm unless SELECT INTO assigned it â€” PL/pgSQL raises on unassigned
    -- record fields even inside COALESCE (Â§12.2 measured 2026-09-24).
    IF _template_id IS NOT NULL THEN
      SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;
      _subject := COALESCE(
        NULLIF(_generated_question->>'subject', ''),
        _tm.subject, _ps.subject, 'General'
      );
      _chapter := COALESCE(
        NULLIF(_generated_question->>'chapter', ''),
        _tm.chapter, _ps.chapter
      );
      _topic := COALESCE(_topic, NULLIF(_generated_question->>'topic', ''), _tm.chapter, _chapter);
      _concept_f := COALESCE(
        NULLIF(_generated_question->>'concept', ''),
        _tm.concept, _tm.chapter, _ps.chapter, _ps.subject
      );
      _sub_f := COALESCE(_tm.subconcept, _concept_f);
      _class := COALESCE(
        NULLIF(_m->>'class_level', '')::int,
        _tm.class, _ps.class_level, 12
      );
      _difficulty := COALESCE(
        NULLIF(_m->>'difficulty', ''),
        _tm.difficulty, _tm.template_data->>'difficulty', 'medium'
      );
    ELSE
      _subject := COALESCE(
        NULLIF(_generated_question->>'subject', ''),
        _ps.subject, 'General'
      );
      _chapter := COALESCE(
        NULLIF(_generated_question->>'chapter', ''),
        _ps.chapter
      );
      _topic := COALESCE(_topic, NULLIF(_generated_question->>'topic', ''), _chapter);
      _concept_f := COALESCE(
        NULLIF(_generated_question->>'concept', ''),
        _ps.chapter, _ps.subject
      );
      _sub_f := _concept_f;
      _class := COALESCE(
        NULLIF(_m->>'class_level', '')::int,
        _ps.class_level, 12
      );
      _difficulty := COALESCE(
        NULLIF(_m->>'difficulty', ''),
        'medium'
      );
    END IF;
    _resolved_correct := CASE
      WHEN COALESCE(_skipped, false) OR _timed_out THEN false
      ELSE COALESCE(_is_correct, false)
    END;
    _resolved_score := CASE WHEN _resolved_correct THEN COALESCE(_score, 1) ELSE 0 END;
    _resolved_correct_answer := COALESCE(_correct_answer, '{}'::jsonb);
    _mistake_qid := _bank_id;
  END IF;$arm$;

  _new := replace(_def, _old_arm, _new_arm);
  IF _new = _def THEN
    RAISE EXCEPTION 'rewrite produced identical body';
  END IF;
  EXECUTE _new;
END
$rewrite$;

DO $prove$
DECLARE
  _src text;
BEGIN
  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_question_attempt';
  IF position('Upload / free-text: no bank row, often no template' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: guarded upload/no-template arm missing';
  END IF;
  IF position(
       E'_sub_f := COALESCE(_tm.subconcept, _concept_f);\n    _class := COALESCE(\n      NULLIF(_m->>''class_level'', '''')::int,\n      _tm.class, _ps.class_level, 12\n    );'
       IN _src
     ) > 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: unguarded _tm.subconcept COALESCE still present';
  END IF;
END
$prove$;

COMMIT;
