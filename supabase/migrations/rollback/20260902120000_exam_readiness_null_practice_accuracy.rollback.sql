-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — _exam_readiness null practice accuracy
-- Undoes 20260902120000_exam_readiness_null_practice_accuracy.sql
--
-- ⚠ Rolling this back RESTORES a G4 violation. A student who has never
-- practised goes back to being shown
--
--     Practice accuracy: 0%
--
-- which reads as "you got everything wrong" rather than "you have not
-- practised". Run this only to undo a regression caused by the fix itself.
--
-- ── Why the body comes from the migration, not from an older file ─────────
--
-- The migration was built by splicing the LIVE body with exactly two
-- substitutions. Reversing those two reconstructs the pre-fix body precisely.
-- The last literal definition in the repo (20260614000000) is NOT the right
-- source: this function has changed since, and restoring that body would undo
-- those changes as well as this one.
--
-- The two substitutions, reversed here:
--   _practice_acc numeric := NULL   ->  := 0
--   round(...)                      ->  COALESCE(round(...), 0)
--
-- ── The client side is NOT reverted by this file ──────────────────────────
--
-- hasPracticeAccuracy() and the "not recorded yet" rendering are TypeScript
-- and stay. They keep working against a 0: the helper asks whether the key is
-- present, and it is. The screen simply stops distinguishing absent from zero,
-- which is the behaviour being restored.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._exam_readiness(_uid uuid, _student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _att_pct numeric := 0; _test_pct numeric := 0; _acc numeric := 0; _practice_acc numeric := 0;
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

  SELECT COALESCE(round(100.0 * count(*) FILTER (WHERE is_correct) / NULLIF(count(*), 0), 1), 0)
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

-- Assert the restore actually took, on the same fixture the migration used.
DO $verify$
DECLARE _uid uuid; _sid uuid; _out jsonb; _attempts int;
BEGIN
  SELECT s.user_id, s.id INTO _uid, _sid
    FROM public.students s JOIN auth.users u ON u.id = s.user_id
   WHERE u.email = 'aarav.sharma@wisdomcampus.com';
  IF _uid IS NULL THEN
    RAISE NOTICE 'fixture student absent; cannot confirm the restore behaviourally';
    RETURN;
  END IF;

  SELECT count(*) INTO _attempts FROM public.question_attempts WHERE user_id = _uid;
  IF _attempts <> 0 THEN
    RAISE NOTICE 'fixture student now has % attempts; skipping the behavioural check', _attempts;
    RETURN;
  END IF;

  _out := public._exam_readiness(_uid, _sid);
  IF _out->'practice_accuracy_pct' IS NOT DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'rollback did not take: practice_accuracy_pct is still null';
  END IF;
END
$verify$;

COMMIT;
