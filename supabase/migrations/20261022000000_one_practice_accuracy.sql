-- ════════════════════════════════════════════════════════════════════════════
-- ONE PRACTICE ACCURACY
-- ════════════════════════════════════════════════════════════════════════════
--
-- FOUR DEFINITIONS OF ONE NUMBER
--
-- 20261021000000 fixed the stored per-session rate to exclude skips, because
-- Analysis already excluded them and the two disagreed. Walking the app found
-- that was still only half of it. "Practice accuracy" is computed in four
-- places, and after that migration three of them still disagreed:
--
--   practice_sessions.accuracy           correct / answered      (20261021)
--   Analysis (accuracyOverAnswered)      correct / answered
--   _exam_readiness.practice_accuracy    correct / ALL attempts  <- skips wrong
--   student_academic_profile.…_pct       mean of per-session     <- skips wrong
--                                        correct / question_count   AND a mean
--
-- Measured for one student, 2026-09-15: 22 correct, 78 answered, 8 skipped.
--
--   correct / answered      22/78 = 28%
--   correct / all attempts  22/86 = 26%   <- what the Home screen showed
--
-- So the student's own Home tile and their Analysis page quoted different
-- accuracies for the same practice, and the profile row the teacher and parent
-- views read quoted a third.
--
-- THE RULE, EVERYWHERE
--
--   accuracy = correct / (questions actually answered)
--
-- A skipped question was asked and not answered. It is not evidence of getting
-- something wrong, and counting it as such makes a student who skips what they
-- know they cannot do look worse than one who guesses.
--
-- POOLED, NOT AVERAGED
--
-- The profile also took avg() of per-session percentages, so a 1-question
-- session weighed the same as a 40-question one. This repo already rejects
-- that in so many words for multi-session accuracy — "Not the mean of
-- per-session accuracies … The same fault the school attendance figure had" —
-- so the profile now sums the parts and divides once.
--
-- Stored profile rows are refreshed at the end, because a row written under
-- the old rule is exactly the disagreement this removes.
--
-- ROLLBACK: supabase/migrations/rollback/20261022000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. _exam_readiness — the Home tile and the Analysis tile ────────────────
DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = '_exam_readiness';
  IF _def IS NULL THEN RAISE EXCEPTION '_exam_readiness not found'; END IF;

  _new := replace(_def,
    'SELECT round(100.0 * count(*) FILTER (WHERE is_correct) / NULLIF(count(*), 0), 1)
    INTO _practice_acc FROM public.question_attempts WHERE user_id = _uid;',
    'SELECT round(100.0 * count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(skipped, false)), 0), 1)
    INTO _practice_acc FROM public.question_attempts WHERE user_id = _uid;');

  IF _new = _def THEN
    RAISE EXCEPTION '_exam_readiness: the accuracy anchor matched nothing — the substitution would have failed open';
  END IF;
  EXECUTE _new;
END $rewrite$;

-- ── 2. refresh_student_academic_profile — what teacher and parent views read ─
DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'refresh_student_academic_profile';
  IF _def IS NULL THEN RAISE EXCEPTION 'refresh_student_academic_profile not found'; END IF;

  _new := replace(_def,
    'SELECT count(*), coalesce(avg(
    CASE WHEN question_count > 0 THEN (correct_count::numeric / question_count) * 100 ELSE NULL END
  ), 0)
  INTO _practice_n, _practice_avg',
    'SELECT count(*), coalesce(
    100.0 * sum(correct_count)::numeric
          / NULLIF(sum(GREATEST(question_count - COALESCE(skipped_count, 0), 0)), 0), 0)
  INTO _practice_n, _practice_avg');

  IF _new = _def THEN
    RAISE EXCEPTION 'refresh_student_academic_profile: the accuracy anchor matched nothing — the substitution would have failed open';
  END IF;
  EXECUTE _new;
END $rewrite$;

-- Both rewrites must be live, and neither old form may survive.
DO $check$
DECLARE _er text; _rp text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _er
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_exam_readiness';
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _rp
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='refresh_student_academic_profile';

  IF position('NOT COALESCE(skipped, false)' IN _er) = 0 THEN
    RAISE EXCEPTION '_exam_readiness still counts skips';
  END IF;
  IF position('avg(' IN _rp) > 0 AND position('correct_count::numeric / question_count' IN _rp) > 0 THEN
    RAISE EXCEPTION 'refresh_student_academic_profile still averages per-session percentages';
  END IF;
END $check$;

-- ── 3. The rows already written under the old rule ──────────────────────────
DO $refresh$
DECLARE _sid uuid; _n int := 0;
BEGIN
  FOR _sid IN SELECT id FROM public.students LOOP
    BEGIN
      PERFORM public.refresh_student_academic_profile(_sid);
      _n := _n + 1;
    EXCEPTION WHEN OTHERS THEN
      -- One unrefreshable student must not roll back the rewrite above.
      RAISE NOTICE 'profile refresh skipped for %: %', _sid, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'refreshed % student profile(s)', _n;
END $refresh$;

COMMIT;
