-- =====================================================================
-- CHUNK 1.6 — CLOSE THE PRACTICE PRIVACY BREACH
--
-- Locked decision 10.8: practice is "self-directed only and completely private
-- to the student. No teacher, no parent, no principal, no aggregate, no
-- school-side AI use." Production violated this.
--
-- The build doc named three violations. An exhaustive search (verification 3)
-- found EIGHT offending policies across FIVE tables and THREE analytics RPCs,
-- not one:
--
--   concept_mastery        "mastery parent"        parent SELECT
--   concept_mastery        "mastery teacher"       teacher/admin/principal SELECT
--   student_mistakes       "mistakes parent child" parent SELECT
--   student_mistakes       "mistakes teacher class" teacher/admin/principal SELECT
--   question_records       "qrec parent"           parent SELECT   <-- not in the doc
--   question_records       "qrec teacher"          teacher/admin/principal SELECT   <-- not in the doc
--   revision_queue         "revision parent"       parent SELECT   <-- not in the doc
--   student_academic_brain "brain teacher"         teacher/admin/principal SELECT  <-- not in the doc
--
-- question_records is the worst of the additions: it holds the per-question
-- wrong / skipped / bookmarked rows — the mistake book itself — and it was
-- readable by both the parent and the class teacher.
--
-- RPCs gutted (they raise rather than being dropped, so a broken screen says
-- WHY instead of "function does not exist"):
--   rpc_teacher_concept_analytics(_class_id)    -- named in the doc
--   rpc_parent_concept_analytics()              -- not named; same breach
--   rpc_principal_concept_analytics()           -- not named; same breach
--
-- DELIBERATELY KEPT — the one exception verification 4 preserves: XP, level,
-- league and streaks stay readable, because locked decision 10.16 treats
-- effort as public even though the content of mistakes is private.
--
-- INTERPRETATION, flagged for review: rpc_teacher_class_progression_insights()
-- mixed both. It returned XP/level/league/streak/homework (effort — keep) AND
-- practice session counts plus a practice_rate (a school-side practice
-- aggregate — 10.8 forbids). The practice-derived fields are removed and the
-- effort fields kept. If you read 10.8's "no aggregate" as covering XP too,
-- say so and the whole function goes.
--
-- NOT SUBSTITUTED: no screen is quietly repointed at another data source.
-- The dependent screens are listed in the report and left broken on purpose.
--
-- Reverse: supabase/migrations/rollback/20260826130000_chunk16_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — practice tables become student-only
--
-- Each table keeps its "self" policy (user_id = auth.uid()) and its tenant
-- fence. Everything that granted another human a view of this student's
-- practice is dropped.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "mastery parent"         ON public.concept_mastery;
DROP POLICY IF EXISTS "mastery teacher"        ON public.concept_mastery;
DROP POLICY IF EXISTS "mistakes parent child"  ON public.student_mistakes;
DROP POLICY IF EXISTS "mistakes teacher class" ON public.student_mistakes;
DROP POLICY IF EXISTS "qrec parent"            ON public.question_records;
DROP POLICY IF EXISTS "qrec teacher"           ON public.question_records;
DROP POLICY IF EXISTS "revision parent"        ON public.revision_queue;
DROP POLICY IF EXISTS "brain teacher"          ON public.student_academic_brain;


-- ---------------------------------------------------------------------
-- SECTION 2 — the three concept-analytics RPCs are gutted
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_teacher_concept_analytics(_class_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION
    'Practice data is private to the student (locked decision 10.8). Teacher-facing practice analytics no longer exist.';
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_parent_concept_analytics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION
    'Practice data is private to the student (locked decision 10.8). Parents see school data — homework, marks, attendance — never practice.';
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_principal_concept_analytics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION
    'Practice data is private to the student (locked decision 10.8). The principal cannot see student practice data.';
END;
$$;


-- ---------------------------------------------------------------------
-- SECTION 3 — strip the practice aggregate out of the class insights RPC,
-- keeping the effort metrics 10.16 makes public.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_teacher_class_progression_insights(_class_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _ok boolean := false;
  _class_school uuid;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT school_id INTO _class_school FROM public.classes WHERE id = _class_id;
  IF _class_school IS NULL THEN RAISE EXCEPTION 'Class not found'; END IF;
  IF (public.has_role(_caller, 'admin') OR public.has_role(_caller, 'principal'))
     AND public.same_school(_class_school) THEN
    _ok := true;
  ELSIF public.has_role(_caller, 'teacher') THEN
    _ok := public.teacher_teaches_class(_caller, _class_id);
  END IF;
  IF NOT _ok THEN RAISE EXCEPTION 'Not authorized for class insights'; END IF;

  RETURN jsonb_build_object(
    'top_xp', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT s.id AS student_id, s.full_name, COALESCE(x.xp, 0) AS xp,
               COALESCE(x.level, 1) AS level, COALESCE(x.league_code, 'bronze') AS league
        FROM public.students s
        LEFT JOIN public.student_xp x ON x.user_id = s.user_id
        WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
        ORDER BY COALESCE(x.xp, 0) DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'improvers', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT s.id AS student_id, s.full_name,
               COALESCE(SUM(CASE WHEN h.xp_delta > 0 THEN h.xp_delta ELSE 0 END), 0) AS xp_gained_7d
        FROM public.students s
        LEFT JOIN public.progression_history h
          ON h.user_id = s.user_id AND h.created_at >= now() - interval '7 days'
        WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
        GROUP BY s.id, s.full_name
        HAVING COALESCE(SUM(CASE WHEN h.xp_delta > 0 THEN h.xp_delta ELSE 0 END), 0) > 0
        ORDER BY xp_gained_7d DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'inactive', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT s.id AS student_id, s.full_name, x.last_activity_at
        FROM public.students s
        LEFT JOIN public.student_xp x ON x.user_id = s.user_id
        WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
          AND (x.last_activity_at IS NULL OR x.last_activity_at < now() - interval '7 days')
        ORDER BY x.last_activity_at NULLS FIRST
        LIMIT 15
      ) t
    ), '[]'::jsonb),
    -- 'consistent_practicers' and the practice_rate / practice_sessions counts
    -- are gone: they were a school-side aggregate of practice activity, which
    -- locked decision 10.8 forbids outright.
    'class_engagement', (
      SELECT jsonb_build_object(
        'students', COUNT(*),
        'with_xp', COUNT(x.user_id),
        'avg_xp', COALESCE(ROUND(AVG(COALESCE(x.xp, 0))), 0),
        'avg_streak', COALESCE(ROUND(AVG(COALESCE(x.study_streak, 0))), 0),
        'avg_reputation', COALESCE(ROUND(AVG(COALESCE(x.reputation, 0))), 0),
        'homework_rate', CASE WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE COALESCE(x.homework_submitted_count, 0) > 0) / COUNT(*)) END
      )
      FROM public.students s
      LEFT JOIN public.student_xp x ON x.user_id = s.user_id
      WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
    )
  );
END;
$$;


-- ---------------------------------------------------------------------
-- SECTION 4 — assertions
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _d text;
BEGIN
  -- No permissive policy on a practice table may grant via a role check or a
  -- parent/teacher path. Only "self" and the tenant fence may remain.
  SELECT count(*), string_agg(tablename || '.' || policyname, ', ') INTO _n, _d
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('student_mistakes','concept_mastery','question_records',
                       'revision_queue','student_academic_brain','practice_sessions',
                       'question_attempts')
     AND permissive = 'PERMISSIVE'
     AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
         ~ '(has_role|teacher_teaches_class|parent_user_id|parent_students)';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1.6: % practice policy/policies still grant another role: %', _n, _d;
  END IF;

  -- Every practice table must still have its student-self policy, or the
  -- student loses their own mistake book.
  SELECT count(*) INTO _n
    FROM (VALUES ('student_mistakes'), ('concept_mastery'), ('question_records'),
                 ('revision_queue'), ('student_academic_brain')) AS t(tbl)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.tbl
        AND p.permissive = 'PERMISSIVE'
        AND coalesce(p.qual, '') LIKE '%user_id = auth.uid()%'
   );
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1.6: % practice table(s) lost their student-self policy', _n;
  END IF;

  -- XP stays readable — the one deliberate exception (verification 4).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_xp'
  ) THEN
    RAISE EXCEPTION 'Chunk 1.6: student_xp has no policies; the section leaderboard would break';
  END IF;
END $$;
