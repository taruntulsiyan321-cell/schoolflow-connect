-- ═══════════════════════════════════════════════════════════════════════════
-- The class list reads the roll number where it actually lives (§10.25)
--
-- `rpc_test_class_report` (20260916000000) selected `s.roll_number` from
-- `public.students`. That column is NOT on the table — it is on the
-- `students_current` VIEW, which resolves it for the current academic year.
-- `db:verify-integrity` already asserts exactly that:
--
--     PASS  the current academic year's roll number resolves through students_current
--
-- So every call to the class report raised
--
--     ERROR: column s.roll_number does not exist
--
-- My own defect, from yesterday's migration, caught by probe38's POSITIVE
-- CONTROL rather than by its refusals — the three teacher claims went red
-- while every denial still looked green. A refusal-only probe would have
-- shipped this.
--
-- Corrective migration rather than an edit to 20260916000000: that file is in
-- the ledger as applied, and editing an applied migration is what made
-- `db:migrate --replay` revert a later migration once before.
--
-- Rollback: not required to restore behaviour — 20260916000000's rollback drops
-- the function outright. Re-applying that file alone would restore the broken
-- body, which is why this note exists.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_test_class_report(_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _out jsonb;
BEGIN
  IF NOT public.can_read_test_report(_test_id) THEN
    RAISE EXCEPTION 'Not your class''s test report' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'test_id', t.id,
    'title', t.title,
    'max_mark', t.max_mark,
    'subject', cs.name,
    'submitted_count', (SELECT count(*) FROM public.test_attempts a
                         WHERE a.test_id = t.id AND a.status = 'submitted'),
    -- Null when nobody has submitted. A class average of 0 and "nobody sat it
    -- yet" are different facts and must not render the same (G4).
    'class_average', (SELECT round(avg(a.score)::numeric, 2) FROM public.test_attempts a
                       WHERE a.test_id = t.id AND a.status = 'submitted'),
    'average_seconds_per_question', (
       SELECT round((avg(ans.time_ms) / 1000.0)::numeric, 1)
         FROM public.test_answers ans
         JOIN public.test_attempts a ON a.id = ans.attempt_id
        WHERE a.test_id = t.id AND ans.time_ms IS NOT NULL),
    'weakest_topics', COALESCE((
       SELECT jsonb_agg(x) FROM (
         SELECT COALESCE(NULLIF(btrim(q.concept), ''), NULLIF(btrim(q.chapter), ''), 'Unlabelled') AS topic,
                count(*)::int AS asked,
                count(*) FILTER (WHERE COALESCE(ans.is_correct, false) = false)::int AS wrong,
                round(100.0 * count(*) FILTER (WHERE COALESCE(ans.is_correct, false) = false)
                      / NULLIF(count(*), 0), 1) AS wrong_pct
           FROM public.test_questions q
           JOIN public.test_attempts a ON a.test_id = q.test_id AND a.status = 'submitted'
           LEFT JOIN public.test_answers ans ON ans.question_id = q.id AND ans.attempt_id = a.id
          WHERE q.test_id = t.id
          GROUP BY 1
          HAVING count(*) FILTER (WHERE COALESCE(ans.is_correct, false) = false) > 0
          ORDER BY wrong_pct DESC, wrong DESC
       ) x), '[]'::jsonb),
    -- students_current, not students: roll_number lives on the view, which
    -- resolves it for the current academic year.
    'students', COALESCE((
       SELECT jsonb_agg(y ORDER BY y.full_name) FROM (
         SELECT s.id AS student_id, s.full_name, s.roll_number,
                a.score AS mark, a.correct_count, a.total_count,
                a.submitted_at,
                (a.id IS NOT NULL AND a.status = 'submitted') AS submitted
           FROM public.students_current s
           LEFT JOIN public.test_attempts a
                  ON a.test_id = t.id
                 AND (a.student_id = s.id OR a.user_id = s.user_id)
                 AND a.status = 'submitted'
          WHERE s.class_id = ss.section_id
            AND s.school_id = t.school_id
       ) y), '[]'::jsonb)
  )
    INTO _out
    FROM public.tests t
    JOIN public.section_subjects ss ON ss.id = t.section_subject_id
    LEFT JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
   WHERE t.id = _test_id;

  RETURN _out;
END;
$function$;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='rpc_test_class_report'
       AND pg_get_functiondef(p.oid) LIKE '%FROM public.students%'
       AND pg_get_functiondef(p.oid) NOT LIKE '%FROM public.students_current%'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the class list still reads roll_number off public.students';
  END IF;
  RAISE NOTICE 'rpc_test_class_report now reads the roll number from students_current.';
END $verify$;
