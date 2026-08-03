-- =============================================================================
-- Prerequisite: _pick_featured_subject (required by ensure/seed/refresh)
-- =============================================================================
-- =============================================================================
-- APPLY_FEATURED_PICK_SUBJECT.sql
-- Hotfix: refresh APPLY called this helper but it was never created on live DB.
-- Paste into Supabase SQL Editor (UTF-8). Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._pick_featured_subject(_class_id uuid, _grade int)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _stream text;
  _subj text;
BEGIN
  SELECT lower(nullif(trim(s.stream), '')) INTO _stream
  FROM public.classes c
  JOIN public.schools s ON s.id = c.school_id
  WHERE c.id = _class_id;

  IF _stream = 'commerce' THEN
    SELECT q.subject INTO _subj
    FROM public.question_bank q
    WHERE q.is_approved
      AND lower(q.subject) IN ('accountancy', 'business studies', 'economics', 'mathematics', 'english', 'hindi')
      AND (_grade IS NULL OR q.class_level IS NULL OR q.class_level = _grade)
    GROUP BY q.subject
    ORDER BY
      CASE lower(q.subject)
        WHEN 'accountancy' THEN 1
        WHEN 'business studies' THEN 2
        WHEN 'economics' THEN 3
        WHEN 'mathematics' THEN 4
        WHEN 'english' THEN 5
        ELSE 6
      END,
      count(*) DESC
    LIMIT 1;
  ELSIF _stream = 'science' THEN
    SELECT q.subject INTO _subj
    FROM public.question_bank q
    WHERE q.is_approved
      AND lower(q.subject) IN ('physics', 'chemistry', 'biology', 'mathematics', 'english', 'hindi')
      AND (_grade IS NULL OR q.class_level IS NULL OR q.class_level = _grade)
    GROUP BY q.subject
    ORDER BY
      CASE lower(q.subject)
        WHEN 'physics' THEN 1
        WHEN 'chemistry' THEN 2
        WHEN 'mathematics' THEN 3
        WHEN 'biology' THEN 4
        ELSE 5
      END,
      count(*) DESC
    LIMIT 1;
  END IF;

  IF _subj IS NOT NULL THEN
    RETURN _subj;
  END IF;

  SELECT q.subject INTO _subj
  FROM public.question_bank q
  WHERE q.is_approved
    AND (_grade IS NULL OR q.class_level IS NULL OR q.class_level = _grade)
  GROUP BY q.subject
  ORDER BY count(*) DESC
  LIMIT 1;

  RETURN COALESCE(_subj, 'Mathematics');
END;
$$;

REVOKE ALL ON FUNCTION public._pick_featured_subject(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._pick_featured_subject(uuid, int) TO authenticated;

-- Class-scoped featured warm for Battleground load (no auto-join).
-- Depends on rpc_refresh_featured_battles / _seed_featured_battle_for_class
-- from 20260803220000_featured_battles_refresh.sql.

CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battles_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid;
  _daily uuid;
  _weekly uuid;
  _ncert uuid;
  _teacher uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(_uid);
  IF _cid IS NULL THEN
    RETURN jsonb_build_object(
      'daily', null, 'weekly', null, 'ncert', null, 'teacher', null,
      'ok', false, 'reason', 'no_class'
    );
  END IF;

  -- Expire + seed current windows for all classes (idempotent)
  BEGIN
    PERFORM public.rpc_refresh_featured_battles();
  EXCEPTION WHEN OTHERS THEN
    -- Fallback: seed only this class when global refresh unavailable
    BEGIN
      _daily := public._seed_featured_battle_for_class(_cid, 'daily');
      _weekly := public._seed_featured_battle_for_class(_cid, 'weekly');
      _ncert := public._seed_featured_battle_for_class(_cid, 'ncert');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;

  SELECT id INTO _daily FROM public.battles
  WHERE source = 'featured_daily' AND class_id = _cid
    AND starts_at::date = current_date AND status IN ('live', 'scheduled')
  ORDER BY created_at LIMIT 1;

  SELECT id INTO _weekly FROM public.battles
  WHERE source = 'featured_weekly' AND class_id = _cid
    AND date_trunc('week', starts_at) = date_trunc('week', now())
    AND status IN ('live', 'scheduled')
  ORDER BY created_at LIMIT 1;

  SELECT id INTO _ncert FROM public.battles
  WHERE source = 'featured_ncert' AND class_id = _cid
    AND starts_at::date = current_date AND status IN ('live', 'scheduled')
  ORDER BY created_at LIMIT 1;

  -- Teacher featured: live public battle hosted by a teacher (manual/custom/bank)
  SELECT b.id INTO _teacher
  FROM public.battles b
  WHERE b.class_id = _cid
    AND b.is_public = true
    AND b.status IN ('live', 'scheduled')
    AND coalesce(b.source, 'manual') IN ('manual', 'custom', 'bank')
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = b.creator_user_id AND ur.role = 'teacher'
    )
  ORDER BY b.starts_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'daily', _daily,
    'weekly', _weekly,
    'ncert', _ncert,
    'teacher', _teacher,
    'ok', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_ensure_featured_battles_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_ensure_featured_battles_all() TO authenticated;

