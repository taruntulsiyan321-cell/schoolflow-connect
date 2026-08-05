-- Bug #10 — recovery_assignments can get duplicate open assignments for the
-- same (user, subject, chapter, concept, subconcept). Same failure class as
-- Bug #8 (20260805010000_fix_revision_queue_conflict_bug8.sql): check-then-
-- insert with no database-level uniqueness guarantee. Confirmed live via
-- Playwright (e2e/diag-compare-weak-areas.spec.ts): 5 concepts on one test
-- account each had two separate pending recovery_assignments rows, created
-- ~3 seconds apart -- two overlapping calls to rpc_assign_concept_recovery
-- both passed the `IF NOT EXISTS (...)` check before either had committed
-- its own INSERT, so both inserted.
--
-- This is actually a step further than Bug #8: revision_queue at least had
-- a unique index (revision_queue_open_unique), just one whose WHERE clause
-- didn't match every caller's check. recovery_assignments has NO unique
-- index at all -- only a plain, non-unique index (recovery_assignments_user_open,
-- on (user_id, status)) for query performance. Confirmed by reading the
-- table's sole CREATE TABLE (20260613000000_concept_mastery_recovery.sql)
-- and grepping every migration for any CREATE UNIQUE INDEX on this table --
-- there is none. That is the missing invariant: "at most one open
-- (pending/in_progress) recovery_assignment per (user_id, subject, chapter,
-- concept, subconcept)" was never enforced by the database, only assumed by
-- application code that cannot actually guarantee it under concurrency.
--
-- Fix: add that partial unique index, then make the INSERT atomic against
-- it (INSERT ... ON CONFLICT ... DO NOTHING) instead of a separate
-- check-then-insert. Preserves exact prior behavior on a duplicate call
-- (return the existing assignment's id, never mutate its severity/question
-- count) -- ON CONFLICT DO NOTHING with RETURNING produces no row on the
-- conflict path, so the existing assignment is looked up explicitly and
-- returned early, skipping question population, exactly as the old
-- check-then-return branch did.

-- The live database already has duplicate rows (confirmed: this exact bug,
-- 5 concepts on one test account), so CREATE UNIQUE INDEX below would fail
-- outright on its own duplicate-key check without this. For each duplicate
-- group, keep the row with the most real progress (questions_completed),
-- tie-broken by earliest creation, tie-broken by id for a strict total
-- order -- never keep a fresher, untouched duplicate over one a student may
-- have already started. recovery_assignment_questions cascades (ON DELETE
-- CASCADE), so deleting a duplicate assignment cleans up its own questions
-- automatically -- no orphaned rows.
DELETE FROM public.recovery_assignments dup
USING public.recovery_assignments keep
WHERE dup.id <> keep.id
  AND dup.user_id = keep.user_id
  AND dup.status IN ('pending', 'in_progress')
  AND keep.status IN ('pending', 'in_progress')
  AND dup.subject = keep.subject
  AND COALESCE(dup.chapter, '') = COALESCE(keep.chapter, '')
  AND dup.concept = keep.concept
  AND COALESCE(dup.subconcept, '') = COALESCE(keep.subconcept, '')
  AND (
    dup.questions_completed < keep.questions_completed
    OR (dup.questions_completed = keep.questions_completed AND dup.created_at > keep.created_at)
    OR (dup.questions_completed = keep.questions_completed AND dup.created_at = keep.created_at AND dup.id > keep.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS recovery_assignments_open_unique
  ON public.recovery_assignments (user_id, subject, (COALESCE(chapter, '')), concept, (COALESCE(subconcept, '')))
  WHERE status IN ('pending', 'in_progress');

CREATE OR REPLACE FUNCTION public.rpc_assign_concept_recovery(
  _subject text,
  _chapter text DEFAULT NULL,
  _concept text DEFAULT NULL,
  _subconcept text DEFAULT NULL,
  _accuracy numeric DEFAULT 40,
  _source_type text DEFAULT NULL,
  _source_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _severity text; _cnt int; _aid uuid; _concept_f text;
  _qb record; _tm record; _idx int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _severity := public._concept_severity(_accuracy);
  _cnt := public._recovery_question_count(_severity);

  -- ▼ Bug #10 fix: was `IF EXISTS (SELECT ...) THEN return ELSE INSERT`,
  -- racy under concurrent calls because no unique index backed it. Atomic
  -- upsert against recovery_assignments_open_unique instead.
  INSERT INTO public.recovery_assignments (
    user_id, student_id, subject, chapter, concept, subconcept,
    severity, question_count, source_type, source_id
  ) VALUES (
    _uid, _sid, _subject, _chapter, _concept_f, _subconcept,
    _severity, _cnt, _source_type, _source_id
  )
  ON CONFLICT (user_id, subject, (COALESCE(chapter, '')), concept, (COALESCE(subconcept, '')))
    WHERE status IN ('pending', 'in_progress')
  DO NOTHING
  RETURNING id INTO _aid;

  IF _aid IS NULL THEN
    -- Conflict: an open assignment already exists for this exact key.
    -- Return it as-is, matching prior behavior exactly -- never mutate an
    -- existing assignment's severity/question_count on a repeat call.
    SELECT id INTO _aid FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress')
      AND subject = _subject AND COALESCE(chapter, '') = COALESCE(_chapter, '')
      AND concept = _concept_f AND COALESCE(subconcept, '') = COALESCE(_subconcept, '')
    ORDER BY created_at DESC LIMIT 1;
    RETURN _aid;
  END IF;
  -- ▲

  FOR _qb IN
    SELECT id, question, options, correct_index, explanation
    FROM public.question_bank
    WHERE is_approved
      AND lower(subject) = lower(_subject)
      AND (_chapter IS NULL OR chapter ILIKE '%' || _chapter || '%' OR concept ILIKE '%' || _concept_f || '%')
      AND (concept ILIKE '%' || _concept_f || '%' OR topic ILIKE '%' || _concept_f || '%' OR chapter ILIKE '%' || _concept_f || '%')
    ORDER BY random() LIMIT _cnt
  LOOP
    _idx := _idx + 1;
    INSERT INTO public.recovery_assignment_questions (
      assignment_id, order_index, question_text, options, correct_answer, explanation, bank_question_id
    ) VALUES (
      _aid, _idx, _qb.question, _qb.options,
      jsonb_build_object('correct_index', _qb.correct_index),
      _qb.explanation, _qb.id
    );
  END LOOP;

  IF _idx < _cnt AND lower(_subject) LIKE '%math%' THEN
    FOR _tm IN
      SELECT DISTINCT ON (template_type) id, chapter, template_type, template_data, explanation_template
      FROM public.question_templates
      WHERE is_active AND class = 12 AND lower(subject) = 'mathematics'
        AND (_chapter IS NULL OR chapter = _chapter)
      ORDER BY template_type, random()
      LIMIT (_cnt - _idx)
    LOOP
      _idx := _idx + 1;
      INSERT INTO public.recovery_assignment_questions (
        assignment_id, order_index, question_text, options, correct_answer, explanation, template_id
      ) VALUES (
        _aid, _idx,
        '',
        '[]'::jsonb,
        jsonb_build_object('client_generate', true),
        _tm.explanation_template,
        _tm.id
      );
    END LOOP;
  END IF;

  UPDATE public.recovery_assignments SET question_count = _idx WHERE id = _aid;

  IF _idx = 0 THEN
    DELETE FROM public.recovery_assignments WHERE id = _aid;
    RAISE EXCEPTION 'No recovery questions available for this topic yet — try Class 12 Math practice for %', COALESCE(_chapter, _subject);
  END IF;

  INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
  VALUES (_uid, _sid, _subject, _chapter, _concept_f, 'concept_recovery', 95, CURRENT_DATE)
  ON CONFLICT (user_id, subject, (COALESCE(chapter, '')), (COALESCE(topic, '')))
    WHERE completed = false
  DO NOTHING;

  RETURN _aid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_assign_concept_recovery(text, text, text, text, numeric, text, uuid) TO authenticated;
