-- HIGH-tier fixes, independently re-verified against live psqxykzqfvxgsvkmgurn on
-- 2026-08-21 (solo, no subagents) before writing this file. Of ~17 HIGH findings
-- checked this round, 6 were refuted (PS-01, CM-02, MK-01, W-07, F-02, AI-03,
-- AI-04 -- all either already-correct code or claims that didn't reproduce
-- against the live/current definition), 1 is pure feature-absence rather than a
-- bug (L-04 -- library has zero application code at all, nothing to patch), and
-- 2 are real but deliberately deferred (RV-01 revision due_date timezone --
-- would need a DATE->TIMESTAMPTZ schema change, out of scope for this pass;
-- QB-08 taxonomy registry gap for Science -- confirmed zero functional impact,
-- since listBankTopics reads question_bank.concept directly, not the registry).
-- See chat summary for the full verification trail on every item.

-- ============================================================================
-- QB-03 (CONFIRMED live: 57 duplicate groups, 62 extra rows out of 21758 --
-- e.g. "Bhasha?" appears 6 times identically for Hindi Class 12). Same
-- dedup-then-unique-index pattern already used for recovery_assignments.
-- ============================================================================
DELETE FROM public.question_bank dup
USING public.question_bank keep
WHERE dup.id > keep.id
  AND dup.question = keep.question
  AND dup.class_level = keep.class_level
  AND dup.subject = keep.subject
  AND dup.is_active = true
  AND keep.is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS question_bank_unique_active
  ON public.question_bank (question, class_level, subject)
  WHERE is_active = true;

-- ============================================================================
-- XP-02 + XP-03 (CONFIRMED live): progression_leagues.demote_below_xp has real
-- per-tier values (e.g. silver min_xp=300, demote_below_xp=200) but nothing
-- ever reads it to gate a league change -- rpc_apply_progression only uses it
-- to set a cosmetic demotion_warning_at timestamp (confirmed by reading its
-- live body), while the actual league is computed by
-- progression_league_for_xp(xp), a pure "which tier's min_xp does this xp
-- clear" lookup with no memory of the student's current league. A student
-- oscillating a few XP around 300 flips silver/bronze on every change instead
-- of being held in silver until dropping below 200.
--
-- Fix: give progression_league_for_xp an optional current-league parameter.
-- With no current league (fresh/first assignment), behavior is identical to
-- today. With a current league supplied: promotions to a strictly higher tier
-- still happen immediately; a drop that doesn't clear the CURRENT league's own
-- demote_below_xp is held at the current league instead of recomputing fresh.
-- ============================================================================
-- Postgres resolves overloads by exact arity, so CREATE OR REPLACE with a
-- different parameter list would leave the old 1-arg function callable
-- alongside this one rather than replacing it -- drop it explicitly first so
-- every existing 1-arg call site (which still compiles fine against the new
-- function's DEFAULT NULL) actually reaches this version.
DROP FUNCTION IF EXISTS public.progression_league_for_xp(integer);

CREATE OR REPLACE FUNCTION public.progression_league_for_xp(_xp integer, _current_league text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _natural text;
  _natural_tier int;
  _current_tier int;
  _current_demote_below int;
BEGIN
  SELECT code INTO _natural
  FROM public.progression_leagues
  WHERE min_xp <= GREATEST(_xp, 0)
  ORDER BY tier DESC
  LIMIT 1;
  _natural := COALESCE(_natural, 'bronze');

  IF _current_league IS NULL THEN
    RETURN _natural;
  END IF;

  SELECT tier INTO _natural_tier FROM public.progression_leagues WHERE code = _natural;
  SELECT tier, demote_below_xp INTO _current_tier, _current_demote_below
    FROM public.progression_leagues WHERE code = _current_league;

  IF _current_tier IS NULL THEN
    -- Unknown current league code (shouldn't happen) -- fall back to natural.
    RETURN _natural;
  END IF;

  IF _natural_tier >= _current_tier THEN
    -- Promotion (or staying put) is never held back by hysteresis.
    RETURN _natural;
  END IF;

  IF _current_demote_below IS NOT NULL AND _xp >= _current_demote_below THEN
    -- Below the current league's min_xp but still above its demote buffer:
    -- stay put rather than bouncing down.
    RETURN _current_league;
  END IF;

  RETURN _natural;
END;
$$;

GRANT EXECUTE ON FUNCTION public.progression_league_for_xp(integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_apply_progression(_rule_code text, _source_type text DEFAULT NULL::text, _source_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text, _amount_override integer DEFAULT NULL::integer, _meta jsonb DEFAULT '{}'::jsonb, _target_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  -- XP-02/XP-03 fix: pass the current league so hysteresis can hold a
  -- borderline student in place instead of recomputing from xp alone.
  _league_after := public.progression_league_for_xp(_xp_after, _league_before);

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

-- ============================================================================
-- XP-06 (CONFIRMED live, currently latent -- not actively wrong today since
-- this session already fixed the one-time drift that would have exposed it,
-- but the underlying fragility is real): rpc_get_student_progression's
-- xp_into_level/progress_pct used progression_xp_for_level(stored level)
-- instead of recomputing the level fresh from xp, so the exact same drift
-- class as XP-01 would silently break the progress bar again if student_xp.level
-- and .xp ever disagree in the future (e.g. a future direct insert bypassing
-- rpc_apply_progression, same root cause as the original XP-01 seed bug).
-- Fix: derive the level used for the snapshot from xp, not from the stored
-- column, so this calculation is self-correcting regardless of level's state.
-- ============================================================================
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
  -- stored column, so this snapshot can never diverge from the XP formula
  -- even if student_xp.level and .xp ever disagree again in the future.
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

-- ============================================================================
-- F-01 (CONFIRMED live: fees.status has no trigger at all, only trg_fees_upd
-- which sets updated_at -- status is computed and written exclusively by
-- FeesAdmin.tsx's client-side statusFor(), so any write that doesn't go
-- through that exact React code path leaves stale status). Fix: enforce the
-- same statusFor() logic (paid >= amount -> paid; paid > 0 -> partial; else
-- unpaid) server-side, so status can never drift from paid_amount/amount
-- regardless of what wrote them.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_fees_compute_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.status := CASE
    WHEN COALESCE(NEW.paid_amount, 0) >= COALESCE(NEW.amount, 0) AND COALESCE(NEW.amount, 0) > 0 THEN 'paid'
    WHEN COALESCE(NEW.paid_amount, 0) > 0 THEN 'partial'
    ELSE 'unpaid'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fees_compute_status ON public.fees;
CREATE TRIGGER trg_fees_compute_status
  BEFORE INSERT OR UPDATE OF paid_amount, amount ON public.fees
  FOR EACH ROW EXECUTE FUNCTION public.tg_fees_compute_status();

-- ============================================================================
-- Re-verify after applying:
--   dup questions:  select count(*) from (select 1 from question_bank where is_active=true group by question,class_level,subject having count(*)>1) x;  -- expect 0
--   league hysteresis:  select progression_league_for_xp(295, 'silver');  -- expect 'silver' (was 'bronze' before fix)
--   fees status:  update fees set paid_amount=amount where id=<any id>; select status from fees where id=<same id>;  -- expect 'paid'
-- ============================================================================
