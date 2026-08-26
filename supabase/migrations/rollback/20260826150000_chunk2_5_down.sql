-- =====================================================================
-- ROLLBACK — Chunk 2.5 gap closure (20260826150000)
--
-- Restores the pre-Chunk-2.5 state exactly. Note that doing so REOPENS two
-- live privacy leaks (10.16 practice session counts readable by teacher,
-- parent, principal and admin) and two cross-institution holes. Only run this
-- if the forward migration itself is the problem.
--
-- The NOT NULL constraints are dropped rather than left in place, because
-- leaving them would make this a partial rollback that silently diverges from
-- the schema the forward migration is documented to have produced.
-- =====================================================================

-- --- FIX 2-B reversed ------------------------------------------------
ALTER TABLE public.teacher_assignments
  DROP CONSTRAINT IF EXISTS teacher_assignments_teacher_school_fk;

ALTER TABLE public.teacher_assignments
  ADD CONSTRAINT teacher_assignments_teacher_id_fkey
  FOREIGN KEY (teacher_id) REFERENCES public.teachers (id) ON DELETE CASCADE;

ALTER TABLE public.teachers
  DROP CONSTRAINT IF EXISTS teachers_id_school_key;

ALTER TABLE public.teachers ALTER COLUMN school_id DROP NOT NULL;

-- --- FIX 2-A reversed ------------------------------------------------
ALTER TABLE public.homework ALTER COLUMN school_id DROP NOT NULL;

-- --- FIX 1.6-B reversed ----------------------------------------------
-- Reinstates the staff read of the whole student_xp row.
DROP POLICY IF EXISTS "xp self read" ON public.student_xp;
CREATE POLICY "xp self read" ON public.student_xp
  FOR SELECT TO authenticated
  USING (
    (user_id = auth.uid())
    OR (
      public.same_school(school_id)
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
        OR public.has_role(auth.uid(), 'teacher'::public.app_role)
      )
    )
  );

-- --- FIX 1.6-A reversed ----------------------------------------------
-- Restores the unconditional 'counts' object. Everything else in the function
-- body is unchanged by the forward migration, so only the CASE is reverted.
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

  IF _uid = _caller
     OR public.has_role(_caller, 'admin')
     OR public.has_role(_caller, 'principal') THEN
    _ok := true;
  END IF;

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
    'counts', jsonb_build_object(
      'practice_sessions', COALESCE(_x.practice_sessions_count, 0),
      'homework_submitted', COALESCE(_x.homework_submitted_count, 0),
      'ai_sessions', COALESCE(_x.ai_sessions_count, 0)
    )
  );
END;
$function$;
