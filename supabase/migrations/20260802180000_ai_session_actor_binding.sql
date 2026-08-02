-- Bind session memory to real end-users (no synthetic service_role actor).
-- Return actor_user_id for gateway/router ownership checks.
-- Scope × role gates; same_school for JWT callers.

CREATE OR REPLACE FUNCTION public.ai_session_memory_open(
  p_school_id uuid,
  p_workflow_scope text,
  p_capability_id text DEFAULT NULL,
  p_workflow_id text DEFAULT NULL,
  p_target_student_id uuid DEFAULT NULL,
  p_ttl_minutes int DEFAULT 120,
  p_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_id uuid;
  v_ttl int := greatest(5, least(coalesce(p_ttl_minutes, 120), 24 * 60));
  v_is_service boolean := (
    current_user = 'service_role' OR coalesce(auth.role(), '') = 'service_role'
  );
BEGIN
  -- Must have a real JWT user — never invent a shared synthetic actor.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated — session open requires user JWT (not bare service_role)';
  END IF;

  IF p_workflow_scope NOT IN ('tutoring', 'paper_gen', 'parent_guidance', 'principal_analytics') THEN
    RAISE EXCEPTION 'invalid workflow_scope';
  END IF;

  IF public.has_role(v_uid, 'admin'::public.app_role) THEN v_role := 'admin';
  ELSIF public.has_role(v_uid, 'principal'::public.app_role) THEN v_role := 'principal';
  ELSIF public.has_role(v_uid, 'teacher'::public.app_role) THEN v_role := 'teacher';
  ELSIF public.has_role(v_uid, 'student'::public.app_role) THEN v_role := 'student';
  ELSIF public.has_role(v_uid, 'parent'::public.app_role) THEN v_role := 'parent';
  ELSE
    RAISE EXCEPTION 'not authorised';
  END IF;

  IF p_workflow_scope = 'paper_gen' AND v_role NOT IN ('teacher', 'admin') THEN
    RAISE EXCEPTION 'paper_gen requires teacher or admin';
  END IF;
  IF p_workflow_scope = 'principal_analytics' AND v_role NOT IN ('principal', 'admin') THEN
    RAISE EXCEPTION 'principal_analytics requires principal or admin';
  END IF;
  IF p_workflow_scope = 'parent_guidance' AND v_role NOT IN ('parent', 'principal', 'admin') THEN
    RAISE EXCEPTION 'parent_guidance requires parent, principal, or admin';
  END IF;

  -- JWT callers must stay in-tenant (service_role with user JWT still has auth.uid()).
  IF NOT v_is_service OR auth.uid() IS NOT NULL THEN
    IF NOT public.same_school(p_school_id) THEN
      RAISE EXCEPTION 'not authorised for school';
    END IF;
  END IF;

  IF p_target_student_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.students s
       WHERE s.id = p_target_student_id
         AND s.school_id = p_school_id
    ) THEN
      RAISE EXCEPTION 'target student not in school';
    END IF;
  END IF;

  UPDATE public.ai_session_memory
     SET status = 'closed',
         closed_at = now(),
         updated_at = now()
   WHERE actor_user_id = v_uid
     AND workflow_scope = p_workflow_scope
     AND status = 'active';

  INSERT INTO public.ai_session_memory (
    school_id, actor_user_id, actor_role, workflow_scope,
    capability_id, workflow_id, target_student_id, summary, expires_at
  ) VALUES (
    p_school_id, v_uid, v_role, p_workflow_scope,
    p_capability_id, p_workflow_id, p_target_student_id,
    coalesce(p_summary, '{}'::jsonb),
    now() + make_interval(mins => v_ttl)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'session_id', v_id,
    'workflow_scope', p_workflow_scope,
    'status', 'active',
    'actor_user_id', v_uid,
    'expires_at', (now() + make_interval(mins => v_ttl))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_session_memory_open(uuid, text, text, text, uuid, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_open(uuid, text, text, text, uuid, int, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_open(uuid, text, text, text, uuid, int, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_session_memory_read(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.ai_session_memory%ROWTYPE;
  v_is_service boolean := (
    current_user = 'service_role' OR coalesce(auth.role(), '') = 'service_role'
  );
BEGIN
  IF v_uid IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO r FROM public.ai_session_memory WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT v_is_service THEN
    IF r.actor_user_id IS DISTINCT FROM v_uid
       AND NOT (
         (public.has_role(v_uid, 'admin'::public.app_role)
          OR public.has_role(v_uid, 'principal'::public.app_role))
         AND public.same_school(r.school_id)
       ) THEN
      RAISE EXCEPTION 'not authorised';
    END IF;
  END IF;

  IF r.status = 'active' AND r.expires_at IS NOT NULL AND r.expires_at < now() THEN
    UPDATE public.ai_session_memory
       SET status = 'expired', updated_at = now()
     WHERE id = p_session_id;
    r.status := 'expired';
  END IF;

  RETURN jsonb_build_object(
    'session_id', r.id,
    'school_id', r.school_id,
    'actor_user_id', r.actor_user_id,
    'workflow_scope', r.workflow_scope,
    'capability_id', r.capability_id,
    'workflow_id', r.workflow_id,
    'target_student_id', r.target_student_id,
    'status', r.status,
    'summary', r.summary,
    'turn_count', r.turn_count,
    'expires_at', r.expires_at,
    'updated_at', r.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_session_memory_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_read(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_session_memory_append(
  p_session_id uuid,
  p_summary_patch jsonb DEFAULT '{}'::jsonb,
  p_increment_turn boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.ai_session_memory%ROWTYPE;
  v_is_service boolean := (
    current_user = 'service_role' OR coalesce(auth.role(), '') = 'service_role'
  );
BEGIN
  IF v_uid IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO r FROM public.ai_session_memory WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found'; END IF;

  IF NOT v_is_service THEN
    IF r.actor_user_id IS DISTINCT FROM v_uid
       AND NOT (
         public.has_role(v_uid, 'admin'::public.app_role)
         AND public.same_school(r.school_id)
       ) THEN
      RAISE EXCEPTION 'not authorised';
    END IF;
  ELSIF v_uid IS NOT NULL AND r.actor_user_id IS DISTINCT FROM v_uid THEN
    IF NOT (
      public.has_role(v_uid, 'admin'::public.app_role)
      AND public.same_school(r.school_id)
    ) THEN
      RAISE EXCEPTION 'not authorised';
    END IF;
  END IF;

  IF r.status <> 'active' OR r.expires_at < now() THEN
    RAISE EXCEPTION 'session not active';
  END IF;

  UPDATE public.ai_session_memory
     SET summary = coalesce(summary, '{}'::jsonb) || coalesce(p_summary_patch, '{}'::jsonb),
         turn_count = turn_count + CASE WHEN p_increment_turn THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE id = p_session_id
  RETURNING * INTO r;

  RETURN jsonb_build_object(
    'session_id', r.id,
    'status', r.status,
    'turn_count', r.turn_count,
    'summary', r.summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_session_memory_append(uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_append(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_session_memory_append(uuid, jsonb, boolean) TO service_role;
