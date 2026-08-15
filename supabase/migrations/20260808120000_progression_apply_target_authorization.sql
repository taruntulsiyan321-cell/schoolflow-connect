-- Phase M / Infra: rpc_apply_progression accepts an arbitrary _target_user_id
-- with NO server-side check that the caller is actually allowed to touch that
-- user's XP. The only gate on this path was client-side (progressionService.ts),
-- which is trivially bypassable by calling the RPC directly. Add the missing
-- authorization check inside the RPC itself. Self-application (_target_user_id
-- IS NULL or equal to auth.uid()) is completely unaffected — this only gates
-- the cross-user path. Admin/principal check mirrors the existing convention
-- already used for the same roles elsewhere in this file
-- (rpc_teacher_class_progression_insights); the teacher branch is new and adds
-- the class-ownership check that was missing entirely, using the same
-- teacher_teaches_class/student_class_id helpers the attendance RLS policies
-- already rely on.

CREATE OR REPLACE FUNCTION public.rpc_apply_progression(
  _rule_code text,
  _source_type text DEFAULT NULL,
  _source_id text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL,
  _amount_override int DEFAULT NULL,
  _meta jsonb DEFAULT '{}'::jsonb,
  _target_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := COALESCE(_target_user_id, auth.uid());
  _rule public.progression_xp_rules%ROWTYPE;
  _x public.student_xp%ROWTYPE;
  _delta int;
  _rep int;
  _xp_before int;
  _xp_after int;
  _lvl_before int;
  _lvl_after int;
  _league_before text;
  _league_after text;
  _school uuid;
  _student uuid;
  _hist uuid;
  _dir text;
  _highest text;
  _warn boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authorization: only self-application is unconditionally allowed. Applying
  -- progression FOR another user requires admin/principal, or a teacher who
  -- actually teaches that student's current class.
  IF _target_user_id IS NOT NULL AND _target_user_id <> auth.uid() THEN
    IF NOT (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'principal')
      OR (
        public.has_role(auth.uid(), 'teacher')
        AND public.teacher_teaches_class(auth.uid(), public.student_class_id(_target_user_id))
      )
    ) THEN
      RAISE EXCEPTION 'Not authorized to apply progression for another user';
    END IF;
  END IF;

  -- Idempotency short-circuit
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _hist
    FROM public.progression_history
    WHERE user_id = _uid AND idempotency_key = _idempotency_key
    LIMIT 1;
    IF _hist IS NOT NULL THEN
      SELECT * INTO _x FROM public.student_xp WHERE user_id = _uid;
      RETURN jsonb_build_object(
        'applied', false,
        'duplicate', true,
        'xp', COALESCE(_x.xp, 0),
        'level', COALESCE(_x.level, 1),
        'league', COALESCE(_x.league_code, 'bronze'),
        'reputation', COALESCE(_x.reputation, 0)
      );
    END IF;
  END IF;

  SELECT * INTO _rule FROM public.progression_xp_rules WHERE code = _rule_code AND enabled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or disabled progression rule: %', _rule_code;
  END IF;

  -- Safety: never award for wrong answers / Nova questions (no such rules seeded).
  -- Controlled deductions only via direction = deduct rules.

  _dir := _rule.direction;
  _delta := COALESCE(_amount_override, _rule.amount);
  IF _dir = 'deduct' THEN
    _delta := -ABS(_delta);
  ELSE
    _delta := ABS(_delta);
  END IF;
  _rep := COALESCE(_rule.reputation_delta, 0);

  _x := public._ensure_student_xp(_uid);
  _xp_before := COALESCE(_x.xp, 0);
  _lvl_before := COALESCE(_x.level, 1);
  _league_before := COALESCE(_x.league_code, 'bronze');
  _xp_after := GREATEST(0, _xp_before + _delta);
  _lvl_after := public.progression_level_for_xp(_xp_after);
  _league_after := public.progression_league_for_xp(_xp_after);

  SELECT s.id, s.school_id INTO _student, _school
  FROM public.students s
  WHERE s.user_id = _uid
  LIMIT 1;
  _school := coalesce(_school, _x.school_id, public.get_my_school_id(), public.default_school_id());

  _highest := COALESCE(_x.highest_league_code, _league_before, 'bronze');
  IF (
    SELECT tier FROM public.progression_leagues WHERE code = _league_after
  ) > (
    SELECT tier FROM public.progression_leagues WHERE code = _highest
  ) THEN
    _highest := _league_after;
  END IF;

  UPDATE public.student_xp SET
    xp = _xp_after,
    level = _lvl_after,
    league_code = _league_after,
    highest_league_code = _highest,
    reputation = GREATEST(0, COALESCE(reputation, 0) + _rep),
    school_id = COALESCE(school_id, _school),
    last_activity_at = now(),
    demotion_warning_at = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.progression_leagues l
        WHERE l.code = _league_after
          AND l.demote_below_xp IS NOT NULL
          AND _xp_after <= l.demote_below_xp + GREATEST(50, (l.min_xp - COALESCE(l.demote_below_xp, 0)) / 5)
          AND _xp_after >= COALESCE(l.demote_below_xp, 0)
      ) THEN now()
      ELSE NULL
    END,
    updated_at = now()
  WHERE user_id = _uid;

  INSERT INTO public.progression_history (
    user_id, school_id, rule_code, direction, xp_delta, reputation_delta,
    xp_before, xp_after, level_before, level_after, league_before, league_after,
    source_type, source_id, idempotency_key, reason, meta
  ) VALUES (
    _uid, _school, _rule_code, _dir, _delta, _rep,
    _xp_before, _xp_after, _lvl_before, _lvl_after, _league_before, _league_after,
    _source_type, _source_id, _idempotency_key, _rule.label, COALESCE(_meta, '{}'::jsonb)
  )
  RETURNING id INTO _hist;

  IF _league_after IS DISTINCT FROM _league_before THEN
    INSERT INTO public.progression_league_history (
      user_id, school_id, from_league, to_league, change_type, xp_at_change
    ) VALUES (
      _uid, _school, _league_before, _league_after,
      CASE
        WHEN (SELECT tier FROM public.progression_leagues WHERE code = _league_after)
           > (SELECT tier FROM public.progression_leagues WHERE code = _league_before)
        THEN 'promotion' ELSE 'demotion'
      END,
      _xp_after
    );

    IF _school IS NOT NULL THEN
      PERFORM public.emit_academic_event(
        CASE
          WHEN (SELECT tier FROM public.progression_leagues WHERE code = _league_after)
             > (SELECT tier FROM public.progression_leagues WHERE code = _league_before)
          THEN 'league.promoted' ELSE 'league.demoted'
        END,
        'student_xp',
        NULL,
        _school,
        _student,
        NULL,
        NULL,
        jsonb_build_object(
          'from', _league_before, 'to', _league_after,
          'xp', _xp_after, 'user_id', _uid
        )
      );
    END IF;
  END IF;

  PERFORM public._progression_check_milestones(_uid);

  IF _school IS NOT NULL THEN
    PERFORM public.emit_academic_event(
      'xp.updated',
      'student_xp',
      NULL,
      _school,
      _student,
      NULL,
      NULL,
      jsonb_build_object(
        'user_id', _uid,
        'rule_code', _rule_code,
        'xp_delta', _delta,
        'xp_after', _xp_after,
        'level_after', _lvl_after,
        'league_after', _league_after,
        'history_id', _hist
      )
    );
  END IF;

  SELECT * INTO _x FROM public.student_xp WHERE user_id = _uid;

  RETURN jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'history_id', _hist,
    'xp_delta', _delta,
    'xp', _x.xp,
    'level', _x.level,
    'league', _x.league_code,
    'reputation', _x.reputation,
    'xp_to_next_level', public.progression_xp_for_level(_x.level + 1) - _x.xp,
    'progress_pct', CASE
      WHEN public.progression_xp_for_level(_x.level + 1) = public.progression_xp_for_level(_x.level) THEN 100
      ELSE ROUND(
        100.0 * (_x.xp - public.progression_xp_for_level(_x.level))
        / NULLIF(public.progression_xp_for_level(_x.level + 1) - public.progression_xp_for_level(_x.level), 0)
      )::int
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_apply_progression(text, text, text, text, int, jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.rpc_apply_progression(text, text, text, text, int, jsonb, uuid) IS
  'Applies a progression XP rule. Cross-user (_target_user_id) calls require admin/principal or a teacher who teaches the target student''s class — added 2026-08-15, previously unchecked server-side.';
