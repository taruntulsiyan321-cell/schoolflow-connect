-- ACTIVE DAYS IS A COUNT OF DAYS.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
--
-- The Analysis header prints "Study consistency: N active days (14d)" on every
-- tab, from _exam_readiness.active_days_14d. Measured live on 2026-09-17 it
-- read, for one student:
--
--     Study consistency   15 active days (14d)
--
-- Fifteen days out of fourteen. The field is not a count of days at all:
--
--     SELECT COALESCE(sum(test_count + homework_count + battle_count
--                         + self_practice_count), 0)
--       INTO _practice FROM public.academic_daily_activity
--      WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 14;
--     ...
--     'active_days_14d', _practice
--
-- It is the sum of ACTIVITY COUNTS over that window, returned under a name
-- that says days. A student with four sessions on one day is "4 active days".
-- The number exceeding its own window is only the visible tip; below fourteen
-- it is wrong in exactly the same way and looks perfectly plausible.
--
-- ── WHY THE FIX IS A SECOND VALUE, NOT A RENAME ─────────────────────────────
--
-- _practice has a second reader, four lines down:
--
--     _score := ... + LEAST(_practice, 14) / 14.0 * 100 * 0.15
--
-- The readiness composite wants HOW MUCH WORK, and that is what _practice
-- honestly is. The header wants HOW MANY DAYS. They are different questions
-- and one variable cannot answer both — which is how the label came to be
-- attached to the wrong one.
--
-- So _practice stays exactly as it is and the composite is untouched: this
-- migration changes no score. A new _active_days counts distinct dates, and
-- that is what goes out under the name active_days_14d.
--
-- CONSUMERS, checked before changing anything:
--   database   _exam_readiness is the only function mentioning the field
--   client     learningMetrics.hasStudyActiveDays / studyActiveDaysFromSnapshot,
--              useStudentAcademicSnapshot's type, and the header chip
-- All four already read it as a number of days, so they become correct without
-- being touched — which is the point of fixing the value rather than relabelling
-- the screen.
--
-- Live bodies on this database are stored with CRLF; normalised first.

BEGIN;

DO $$
DECLARE
  _def text;
  _new text;
  _old_decl text := E'  SELECT COALESCE(sum(test_count + homework_count + battle_count + self_practice_count), 0)\n    INTO _practice FROM public.academic_daily_activity\n    WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 14;\n';
  _new_decl text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_exam_readiness';

  IF _def IS NULL THEN
    RAISE EXCEPTION '_exam_readiness is not defined on this database';
  END IF;

  IF position(_old_decl IN _def) = 0 THEN
    RAISE EXCEPTION 'would have failed open: the _practice assignment was not found verbatim in the live body';
  END IF;

  _new_decl := _old_decl ||
    E'\n' ||
    E'  -- DAYS, not activities. _practice above is a SUM of counts and feeds\n' ||
    E'  -- the readiness composite, which is what it is right for. The screen\n' ||
    E'  -- asks how many days the student showed up, and one day with four\n' ||
    E'  -- sessions on it is one day.\n' ||
    E'  SELECT count(DISTINCT activity_date) INTO _active_days\n' ||
    E'    FROM public.academic_daily_activity\n' ||
    E'   WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 14\n' ||
    E'     AND (test_count + homework_count + battle_count + self_practice_count) > 0;\n';

  _new := replace(_def, _old_decl, _new_decl);

  -- Declare the new variable beside the one it is derived from.
  IF position(E'  _practice   int := 0;' IN _new) > 0 THEN
    _new := replace(_new, E'  _practice   int := 0;', E'  _practice   int := 0;\n  _active_days int := 0;');
  ELSIF position(E'_practice ' IN _new) > 0 THEN
    -- The declaration's spacing differs between deployments; find the DECLARE
    -- line for _practice whatever its padding and append beside it.
    _new := regexp_replace(_new, E'(\n\\s*_practice\\s+int[^;]*;)', E'\\1\n  _active_days int := 0;');
  ELSE
    RAISE EXCEPTION 'would have failed open: could not find the _practice declaration to add _active_days beside';
  END IF;

  _new := replace(_new, E'''active_days_14d'', _practice', E'''active_days_14d'', _active_days');
  IF position(E'''active_days_14d'', _active_days' IN _new) = 0 THEN
    RAISE EXCEPTION 'would have failed open: the returned field still carries _practice';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'active_days_14d now counts distinct days; the readiness composite is unchanged';
END $$;

-- POSITIVE CONTROL, against the live rows rather than against the text: the
-- field may never exceed its own window.
DO $$
DECLARE _n int;
BEGIN
  -- _exam_readiness(_uid uuid, _student_id uuid) — both arguments, because
  -- calling it with one silently resolves to nothing and the check would have
  -- errored rather than measured.
  SELECT count(*) INTO _n
  FROM public.students s
  JOIN LATERAL (
    SELECT (public._exam_readiness(s.user_id, s.id) ->> 'active_days_14d')::int AS d
  ) r ON true
  WHERE s.user_id IS NOT NULL AND r.d > 15;
  IF _n > 0 THEN
    RAISE EXCEPTION 'would have failed open: % student(s) still report more than 15 active days in a 14-day window', _n;
  END IF;
END $$;

COMMIT;
