-- ═══════════════════════════════════════════════════════════════════════════
-- _exam_readiness: a student who has never practised has no practice accuracy
--
-- MEASURED, not inferred. aarav.sharma@wisdomcampus.com has 0 practice_sessions
-- and 0 question_attempts, and /student/analysis showed him
--
--     Practice accuracy: 0%
--
-- which reads as "you got everything wrong", not "you have not practised".
--
-- ── The guard was already there, and undone on the same line ──────────────
--
--   COALESCE(round(100.0 * count(*) FILTER (WHERE is_correct)
--            / NULLIF(count(*), 0), 1), 0)
--
-- NULLIF makes the division NULL when there are no attempts — correctly. The
-- COALESCE then turns that NULL straight back into 0. The author wrote the
-- null-guard and cancelled it in the same expression, which is why this reads
-- as careful code and behaves as G4's "null is not zero" violation.
--
-- ── Why the blend still behaves ───────────────────────────────────────────
--
-- The next line is `IF _practice_acc > 0 THEN` — with NULL that comparison is
-- NULL, which IF treats as false, so the test/practice blend is skipped exactly
-- when there is no practice to blend. That is the behaviour that was wanted;
-- the 0 was making it accidentally correct for the wrong reason.
--
-- ── Blast radius, checked before applying ─────────────────────────────────
--
-- practice_accuracy_pct now arrives NULL rather than 0. The client helper
-- practiceAccuracyFromSnapshot() already returns 0 for a null input, so all 16
-- of its call sites are unchanged. Only callers that ASK whether the figure
-- exists — hasPracticeAccuracy(), added beside it — see the difference, and
-- the Analysis Summary block renders "not recorded yet".
--
-- The body is COPIED from pg_get_functiondef and spliced, not retyped.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._exam_readiness(_uid uuid, _student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _att_pct numeric := 0; _test_pct numeric := 0; _acc numeric := 0; _practice_acc numeric := NULL;
  _practice int := 0; _score numeric := 0; _label text; _tone text;
  _att_total int; _att_present int; _test_done int; _test_total int;
BEGIN
  IF _student_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE status = 'present')
      INTO _att_total, _att_present FROM public.attendance_current WHERE student_id = _student_id;
    IF _att_total > 0 THEN _att_pct := 100.0 * _att_present / _att_total; END IF;
  END IF;

  SELECT count(DISTINCT test_id) FILTER (WHERE status = 'submitted'),
         count(DISTINCT test_id)
    INTO _test_done, _test_total
  FROM public.test_attempts WHERE user_id = _uid;
  IF _test_total > 0 THEN _test_pct := 100.0 * _test_done / _test_total; END IF;

  SELECT COALESCE(round(avg(CASE WHEN total_count > 0 THEN 100.0 * correct_count / total_count END), 1), 0)
    INTO _acc FROM public.test_attempts WHERE user_id = _uid AND status = 'submitted';

  SELECT round(100.0 * count(*) FILTER (WHERE is_correct) / NULLIF(count(*), 0), 1)
    INTO _practice_acc FROM public.question_attempts WHERE user_id = _uid;

  IF _practice_acc > 0 THEN
    _acc := round((_acc + _practice_acc) / CASE WHEN _acc > 0 THEN 2 ELSE 1 END, 1);
  END IF;

  SELECT COALESCE(sum(test_count + homework_count + battle_count + self_practice_count), 0)
    INTO _practice FROM public.academic_daily_activity
    WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 14;

  _score := LEAST(100, round(
    _att_pct * 0.25 + _test_pct * 0.25 + _acc * 0.35 + LEAST(_practice, 14) / 14.0 * 100 * 0.15
  , 0));

  IF _score >= 75 THEN _label := 'Ready'; _tone := 'ready';
  ELSIF _score >= 50 THEN _label := 'Needs Improvement'; _tone := 'improving';
  ELSE _label := 'High Risk'; _tone := 'risk';
  END IF;

  RETURN jsonb_build_object(
    'score', _score, 'label', _label, 'tone', _tone,
    'attendance_pct', round(_att_pct, 1), 'test_completion_pct', round(_test_pct, 1),
    'accuracy_pct', _acc, 'practice_accuracy_pct', _practice_acc,
    'active_days_14d', _practice
  );
END; $function$
;


-- Assert the OUTCOME on a student with no attempts, not the text of the body.
DO $verify$
DECLARE
  _uid uuid;
  _sid uuid;
  _out jsonb;
  _attempts int;
BEGIN
  SELECT s.user_id, s.id INTO _uid, _sid
    FROM public.students s JOIN auth.users u ON u.id = s.user_id
   WHERE u.email = 'aarav.sharma@wisdomcampus.com';
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'the zero-attempt fixture student is missing — this check would prove nothing';
  END IF;

  SELECT count(*) INTO _attempts FROM public.question_attempts WHERE user_id = _uid;
  IF _attempts <> 0 THEN
    RAISE EXCEPTION 'fixture student now has % attempts, so a null result would not distinguish the fix from the data', _attempts;
  END IF;

  _out := public._exam_readiness(_uid, _sid);
  IF _out->'practice_accuracy_pct' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'practice_accuracy_pct is % for a student with zero attempts; expected null',
      _out->>'practice_accuracy_pct';
  END IF;

  -- And the positive: a student WITH attempts must still get a number, or the
  -- fix would have closed the hole by breaking the metric.
  SELECT s.user_id, s.id INTO _uid, _sid
    FROM public.students s
   WHERE EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.user_id = s.user_id)
   LIMIT 1;
  IF _uid IS NOT NULL THEN
    _out := public._exam_readiness(_uid, _sid);
    IF _out->'practice_accuracy_pct' IS NOT DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'a student WITH attempts now gets null practice_accuracy_pct — the fix went too far';
    END IF;
  END IF;
END
$verify$;

COMMIT;
