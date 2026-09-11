-- ═══════════════════════════════════════════════════════════════════════════
-- Homework belongs to the class you teach (rule 18, G13)
--
-- `homework teacher manage` was, for both USING and WITH CHECK:
--
--     created_by = auth.uid()  OR  teacher_teaches_class(auth.uid(), class_id)
--
-- The client sets `created_by` to the signed-in teacher on every insert, so the
-- FIRST BRANCH IS ALWAYS TRUE and the second never constrains anything. Any
-- teacher could assign homework into any class in their school.
--
-- ── MEASURED, AS THE CALLER ──────────────────────────────────────────────
--
-- probe43 drives the whole journey — assign, see, submit, read back. Every
-- other hop held; this one did not. 2026-09-11:
--
--     teacher          d3000002-0009-…
--     class_teacher_of NULL
--     class assigned   d2000001-0002-…   (not in teacher_classes, not their
--                                          class_teacher_of — genuinely untaught)
--     result           INSERT SUCCEEDED
--
-- The probe excludes BOTH paths `teacher_teaches_class` honours, so this is not
-- a fixture that accidentally handed the teacher their own class.
--
-- ── THE SAME DOOR, RULED ON BEFORE ───────────────────────────────────────
--
-- This is the shape ruled out for test reports on 2026-09-09 (`20260916030000`):
-- "`created_by` because it is the same door with a different key … a rule that
-- says the office sees nothing, with an authorship exception, is not the rule
-- that was given." Authorship is not a teaching relationship. A teacher may
-- manage homework for the classes they teach — full stop.
--
-- ── WHAT THIS COSTS, COUNTED BEFORE IT WAS WRITTEN ───────────────────────
--
--     51  homework rows, not deleted
--     45  authored by a teacher who DOES teach that class   -> unaffected
--      3  authored by someone who is not a teacher           -> `homework admin all`
--      3  authored by a teacher into a class they do NOT teach
--
-- Those last 3 lose author-visibility. They are the defect's own output: rows
-- that could only exist because the door was open. They stay readable to the
-- admin and to the teachers who actually teach those classes, so nothing is
-- orphaned — it is re-scoped to the people the rule names.
--
-- Rollback: supabase/migrations/rollback/
--           20260919000000_homework_belongs_to_the_class_you_teach.rollback.sql
-- Assertion: probe43 (claim 2), which failed before this and must pass after.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "homework teacher manage" ON public.homework;

CREATE POLICY "homework teacher manage" ON public.homework
  FOR ALL
  TO authenticated
  USING (public.teacher_teaches_class((SELECT auth.uid()), class_id))
  WITH CHECK (public.teacher_teaches_class((SELECT auth.uid()), class_id));

COMMENT ON POLICY "homework teacher manage" ON public.homework IS
  'A teacher manages homework for the classes they teach. Authorship is NOT a '
  'second door: `created_by = auth.uid()` was an OR here, the client always '
  'sets it, so every teacher could assign into every class in the school '
  '(measured by probe43, 2026-09-11). Same shape ruled out for test reports in '
  '20260916030000.';

-- ── Proof, before this commits ────────────────────────────────────────────
-- Runs as `postgres`, so it cannot prove an RLS refusal — probe43 does that as
-- the caller. What it CAN do is assert the policy's shape and that the rows the
-- rule is meant to keep reachable are still matched by it. It writes nothing.
DO $verify$
DECLARE
  pol_using text; pol_check text;
  still_ok int; orphaned int;
BEGIN
  SELECT qual, with_check INTO pol_using, pol_check
    FROM pg_policies
   WHERE schemaname='public' AND tablename='homework' AND policyname='homework teacher manage';

  IF pol_using IS NULL THEN
    RAISE EXCEPTION 'verify: the policy is missing';
  END IF;

  -- The door is shut, on the write side as well as the read side.
  IF pol_using ILIKE '%created_by%' OR pol_check ILIKE '%created_by%' THEN
    RAISE EXCEPTION 'verify: created_by is still a branch (USING=%, CHECK=%)', pol_using, pol_check;
  END IF;

  -- The positive control: the rule it was replaced WITH is actually there.
  -- Without this, deleting the policy entirely would satisfy the check above.
  IF pol_using NOT ILIKE '%teacher_teaches_class%' OR pol_check NOT ILIKE '%teacher_teaches_class%' THEN
    RAISE EXCEPTION 'verify: teacher_teaches_class is not the rule (USING=%, CHECK=%)', pol_using, pol_check;
  END IF;

  -- And the homework that SHOULD stay reachable still matches the new rule.
  SELECT count(*) INTO still_ok
    FROM public.homework h
    JOIN public.teachers t ON t.user_id = h.created_by
   WHERE h.deleted_at IS NULL
     AND (EXISTS (SELECT 1 FROM public.teacher_classes tc
                   WHERE tc.teacher_id = t.id AND tc.class_id = h.class_id)
          OR t.class_teacher_of = h.class_id);

  IF still_ok < 1 THEN
    RAISE EXCEPTION 'verify: no homework is reachable by a teacher of its class — too tight';
  END IF;

  SELECT count(*) INTO orphaned
    FROM public.homework h
    JOIN public.teachers t ON t.user_id = h.created_by
   WHERE h.deleted_at IS NULL
     AND NOT (EXISTS (SELECT 1 FROM public.teacher_classes tc
                       WHERE tc.teacher_id = t.id AND tc.class_id = h.class_id)
              OR t.class_teacher_of = h.class_id);

  RAISE NOTICE 'verify OK: authorship door shut; % row(s) still reachable by a teacher of their class; % row(s) re-scoped away from their author',
    still_ok, orphaned;
END
$verify$;
