-- =====================================================================
-- CHUNK 2.5 — CLOSE THE GAPS FOUND AUDITING CHUNKS 1.6 AND 2
--
-- Chunks 1.6 and 2 were both applied and both reported their verification
-- blocks passing. Re-running those verifications live found four defects the
-- original checks were not shaped to catch. Each is proven below by a query
-- run against the live database, not inferred from migration source.
--
-- 1.6-A (CRITICAL, live privacy leak). Chunk 1.6 verification 3 says "no RPC,
--   view, or function anywhere exposes practice data to another role — search
--   exhaustively". It was not searched: CHUNK16_VERIFY.sql enumerates zero
--   functions. rpc_get_student_progression is SECURITY DEFINER (so RLS never
--   applies), is granted to authenticated, and deliberately authorises admin,
--   principal, any linked parent and any teacher of the student's class — then
--   returns counts.practice_sessions from student_xp.practice_sessions_count.
--   Locked decision 10.16 draws the line in a single sentence: "Public: XP,
--   level, league, streak, homework completion. Private: practice session
--   counts, practice rate, mistakes, skipped, bookmarks, concept mastery,
--   revision queue, and every per-question record." A practice session count
--   is on the private side of that sentence.
--
-- 1.6-B (CRITICAL, live privacy leak). The same counter was readable straight
--   off the table. Policy "xp self read" was
--     (user_id = auth.uid()) OR (same_school(school_id) AND (admin|principal|teacher))
--   and RLS is row-level, not column-level, so the staff branch handed over
--   the whole row including practice_sessions_count and ai_sessions_count.
--
-- 2-A (CRITICAL, structural). Chunk 2 verification 4 claims that attaching
--   homework to another institution's section_subject is "structurally
--   impossible". The composite FK is MATCH SIMPLE (confmatchtype = 's') and
--   homework.school_id was NULLABLE. Under MATCH SIMPLE a NULL in any
--   referencing column skips the check entirely. Proven live in a rolled-back
--   transaction: an INSERT with school_id = NULL and a section_subject_id that
--   exists nowhere at all was ACCEPTED; the identical insert with school_id
--   set was correctly REJECTED.
--
-- 2-B (HIGH, structural). teacher_assignments.teacher_id references
--   teachers(id) with no institution binding and no trigger, so one school can
--   assign another school's teacher to its own section-subject. The tenant
--   fence only constrains teacher_assignments.school_id, never the teacher's.
--
-- NOT CHANGED HERE — raised for decision rather than guessed at:
--   * Downstream practice tables (student_mistakes, concept_mastery,
--     question_attempts, revision_queue, recovery_assignments) still key on
--     free-text chapter/topic strings rather than chapter_id, so Chunk 2
--     verification 5's second half is false today. Those are the legacy tables
--     Chunk 7 replaces; bridging them here would build it twice.
--   * student_xp still mixes public and private columns in one row, so a
--     student cannot read a classmate's public XP without also being handed
--     the private counters. The structurally correct fix is to move the
--     private counters into their own student-only table — Chunk 7 territory.
--
-- Reverse: supabase/migrations/rollback/20260826150000_chunk2_5_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- FIX 1.6-A — the private counters become self-only in the RPC.
--
-- Identical to the live definition except for _is_self and the 'counts'
-- object. homework_submitted stays visible to every authorised caller:
-- 10.16 names homework completion as public.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_get_student_progression(_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := COALESCE(_user_id, auth.uid());
  _x public.student_xp%ROWTYPE;
  _caller uuid := auth.uid();
  _ok boolean := false;
  _is_self boolean := false;
  _student uuid;
  _school uuid;
  _badges jsonb;
  _achievements jsonb;
  _league jsonb;
  _next_league jsonb;
  _xp_next int;
  _xp_cur int;
  _lvl_effective int;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  _is_self := (_uid = _caller);

  IF _is_self
     OR public.has_role(_caller, 'admin')
     OR public.has_role(_caller, 'principal') THEN
    _ok := true;
  END IF;

  -- Parent of student
  IF NOT _ok THEN
    SELECT s.id, s.school_id INTO _student, _school
    FROM public.students s
    WHERE s.user_id = _uid
    LIMIT 1;
    IF _student IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.students s2 WHERE s2.id = _student AND s2.parent_user_id = _caller)
      OR EXISTS (
        SELECT 1
        FROM public.parents p
        JOIN public.parent_students ps ON ps.parent_id = p.id
        WHERE p.user_id = _caller AND ps.student_id = _student
      )
    ) THEN
      _ok := true;
    END IF;
  END IF;

  -- Teacher of student's class
  IF NOT _ok THEN
    IF public.has_role(_caller, 'teacher') AND EXISTS (
      SELECT 1 FROM public.teacher_classes tc
      JOIN public.teachers t ON t.id = tc.teacher_id
      JOIN public.students s ON s.class_id = tc.class_id
      WHERE t.user_id = _caller AND s.user_id = _uid
    ) THEN
      _ok := true;
    END IF;
  END IF;

  IF NOT _ok THEN
    RAISE EXCEPTION 'Not authorized to view progression';
  END IF;

  _x := public._ensure_student_xp(_uid);
  -- XP-06 fix: recompute the effective level from xp rather than trusting the
  -- stored column, so this snapshot can never diverge from the XP formula.
  _lvl_effective := public.progression_level_for_xp(COALESCE(_x.xp, 0));
  _xp_cur := public.progression_xp_for_level(_lvl_effective);
  _xp_next := public.progression_xp_for_level(_lvl_effective + 1);

  SELECT jsonb_build_object(
    'code', l.code, 'label', l.label, 'tier', l.tier, 'min_xp', l.min_xp,
    'demote_below_xp', l.demote_below_xp, 'color_token', l.color_token
  ) INTO _league
  FROM public.progression_leagues l
  WHERE l.code = COALESCE(_x.league_code, 'bronze');

  SELECT jsonb_build_object(
    'code', l.code, 'label', l.label, 'tier', l.tier, 'min_xp', l.min_xp, 'remaining', GREATEST(0, l.min_xp - _x.xp)
  ) INTO _next_league
  FROM public.progression_leagues l
  WHERE l.tier = (SELECT tier + 1 FROM public.progression_leagues WHERE code = COALESCE(_x.league_code, 'bronze'))
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'badge_code', b.badge_code, 'tier', b.tier, 'earned_at', b.earned_at
  ) ORDER BY b.earned_at DESC), '[]'::jsonb)
  INTO _badges
  FROM public.student_badges b
  WHERE b.user_id = _uid;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', a.achievement_code, 'earned_at', a.earned_at,
    'label', c.label, 'description', c.description, 'rarity', c.rarity
  ) ORDER BY a.earned_at DESC), '[]'::jsonb)
  INTO _achievements
  FROM public.student_achievements a
  JOIN public.progression_achievements c ON c.code = a.achievement_code
  WHERE a.user_id = _uid;

  RETURN jsonb_build_object(
    'user_id', _uid,
    'xp', COALESCE(_x.xp, 0),
    'level', COALESCE(_x.level, 1),
    'xp_into_level', GREATEST(0, COALESCE(_x.xp, 0) - _xp_cur),
    'xp_to_next_level', GREATEST(0, _xp_next - COALESCE(_x.xp, 0)),
    'level_progress_pct', CASE
      WHEN _xp_next <= _xp_cur THEN 100
      ELSE LEAST(100, ROUND(100.0 * (COALESCE(_x.xp, 0) - _xp_cur) / NULLIF(_xp_next - _xp_cur, 0))::int)
    END,
    'league', _league,
    'next_league', _next_league,
    'highest_league', COALESCE(_x.highest_league_code, 'bronze'),
    'demotion_warning_at', _x.demotion_warning_at,
    'reputation', COALESCE(_x.reputation, 0),
    'study_streak', COALESCE(_x.study_streak, 0),
    'study_longest_streak', COALESCE(_x.study_longest_streak, 0),
    'study_week_streak', COALESCE(_x.study_week_streak, 0),
    'study_month_streak', COALESCE(_x.study_month_streak, 0),
    'streak_protection_tokens', COALESCE(_x.streak_protection_tokens, 0),
    'featured_badges', COALESCE(to_jsonb(_x.featured_badges), '[]'::jsonb),
    'equipped_badge', _x.equipped_badge,
    'badges', _badges,
    'achievements', _achievements,
    'battleground', jsonb_build_object(
      'total_battles', COALESCE(_x.total_battles, 0),
      'wins', COALESCE(_x.wins, 0),
      'win_streak', COALESCE(_x.win_streak, 0),
      'best_win_streak', COALESCE(_x.best_win_streak, 0),
      'best_score', COALESCE(_x.best_score, 0),
      'total_correct', COALESCE(_x.total_correct, 0),
      'total_answered', COALESCE(_x.total_answered, 0)
    ),
    -- 10.16: practice session counts and AI session counts are PRIVATE.
    -- Only the student themselves ever receives them. The keys are omitted
    -- entirely for anyone else rather than zeroed, because a 0 would read as
    -- "did no practice", which is a different and false statement (G4).
    'counts', CASE
      WHEN _is_self THEN jsonb_build_object(
        'practice_sessions', COALESCE(_x.practice_sessions_count, 0),
        'homework_submitted', COALESCE(_x.homework_submitted_count, 0),
        'ai_sessions', COALESCE(_x.ai_sessions_count, 0)
      )
      ELSE jsonb_build_object(
        'homework_submitted', COALESCE(_x.homework_submitted_count, 0)
      )
    END
  );
END;
$function$;


-- ---------------------------------------------------------------------
-- FIX 1.6-B — student_xp becomes self-only at the table level.
--
-- Staff had a direct read of the whole row. Nothing in the application reads
-- student_xp as staff (verified by grep across src/ and supabase/functions/);
-- the 19 SECURITY DEFINER functions that read it are unaffected by RLS, so
-- every legitimate teacher/principal/admin figure keeps working.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "xp self read" ON public.student_xp;
CREATE POLICY "xp self read" ON public.student_xp
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());


-- ---------------------------------------------------------------------
-- FIX 2-A — close the MATCH SIMPLE null-skip on homework.
--
-- Backfill first from the section the row already names, then make the column
-- NOT NULL so no referencing column of the composite FK can ever be NULL.
-- ---------------------------------------------------------------------

UPDATE public.homework h
   SET school_id = c.school_id
  FROM public.classes c
 WHERE h.school_id IS NULL
   AND c.id = h.class_id;

DO $$
DECLARE _orphan int;
BEGIN
  SELECT count(*) INTO _orphan FROM public.homework WHERE school_id IS NULL;
  IF _orphan > 0 THEN
    RAISE EXCEPTION
      'Chunk 2.5: % homework row(s) still have no school_id and none can be derived from their class; refusing to set NOT NULL', _orphan;
  END IF;
END $$;

ALTER TABLE public.homework ALTER COLUMN school_id SET NOT NULL;


-- ---------------------------------------------------------------------
-- FIX 2-B — bind a teacher assignment to the teacher's own institution.
--
-- The same composite-FK technique Chunk 2 used for section_subjects, applied
-- to the half it missed. teachers.school_id must be NOT NULL for the
-- composite key to be usable, and for the same MATCH SIMPLE reason as 2-A.
-- ---------------------------------------------------------------------

DO $$
DECLARE _orphan int;
BEGIN
  SELECT count(*) INTO _orphan FROM public.teachers WHERE school_id IS NULL;
  IF _orphan > 0 THEN
    RAISE EXCEPTION
      'Chunk 2.5: % teacher(s) have no school_id; refusing to set NOT NULL', _orphan;
  END IF;
END $$;

ALTER TABLE public.teachers ALTER COLUMN school_id SET NOT NULL;

ALTER TABLE public.teachers
  DROP CONSTRAINT IF EXISTS teachers_id_school_key;
ALTER TABLE public.teachers
  ADD CONSTRAINT teachers_id_school_key UNIQUE (id, school_id);

ALTER TABLE public.teacher_assignments
  DROP CONSTRAINT IF EXISTS teacher_assignments_teacher_id_fkey;
ALTER TABLE public.teacher_assignments
  DROP CONSTRAINT IF EXISTS teacher_assignments_teacher_school_fk;
ALTER TABLE public.teacher_assignments
  ADD CONSTRAINT teacher_assignments_teacher_school_fk
  FOREIGN KEY (teacher_id, school_id)
  REFERENCES public.teachers (id, school_id) ON DELETE CASCADE;


-- ---------------------------------------------------------------------
-- ASSERTIONS
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int;
BEGIN
  -- 1.6-A: the RPC must no longer name practice_sessions unconditionally.
  IF (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'rpc_get_student_progression')
     NOT LIKE '%WHEN _is_self THEN%' THEN
    RAISE EXCEPTION 'Chunk 2.5: rpc_get_student_progression is not self-gated';
  END IF;

  -- 1.6-B: no policy on student_xp may grant a role-based read.
  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'student_xp'
     AND permissive = 'PERMISSIVE'
     AND coalesce(qual, '') ~ 'has_role';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 2.5: % student_xp policy/policies still grant by role', _n;
  END IF;

  -- 2-A: no referencing column of the homework composite FK may be nullable.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'homework'
                AND column_name = 'school_id' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'Chunk 2.5: homework.school_id is still nullable — the FK stays bypassable';
  END IF;

  -- 2-B: the teacher must now be bound to the assignment's institution.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.teacher_assignments'::regclass
                    AND conname = 'teacher_assignments_teacher_school_fk') THEN
    RAISE EXCEPTION 'Chunk 2.5: teacher_assignments is not institution-bound to its teacher';
  END IF;
END $$;
