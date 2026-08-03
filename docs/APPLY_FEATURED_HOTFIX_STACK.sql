-- =============================================================================
-- APPLY_FEATURED_HOTFIX_STACK.sql
-- Paste into Supabase SQL Editor (UTF-8). Idempotent Critical stack:
--   1) _pick_featured_subject (fixes missing-function Join/refresh failures)
--   2) rpc_ensure_featured_battles_all (warm Featured WITHOUT auto-join)
-- =============================================================================

-- >>> 1. Subject picker
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

-- >>> 2. Warm ensure-all (no auto-join)
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

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_refresh_featured_battles') THEN
      PERFORM public.rpc_refresh_featured_battles();
    ELSIF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_rotate_featured_battles') THEN
      PERFORM public.rpc_rotate_featured_battles();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_seed_featured_battle_for_class') THEN
    BEGIN
      PERFORM public._seed_featured_battle_for_class(_cid, 'daily');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      PERFORM public._seed_featured_battle_for_class(_cid, 'weekly');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      PERFORM public._seed_featured_battle_for_class(_cid, 'ncert');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

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

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_peek_teacher_featured_battle') THEN
    _teacher := public._peek_teacher_featured_battle(_cid);
  ELSE
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
  END IF;

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
