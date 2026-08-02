-- Phase 3 close-out (SSOT gaps):
-- Embedding batch RPC (cron-friendly), outline/prompt seeds, image-doubt submit +
-- principal health brief workflows. Roles: admin|teacher|student|parent|principal only.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ai_embedding_jobs_process_batch — claim or defer
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_embedding_jobs_process_batch(
  p_limit int DEFAULT 10,
  p_provider_configured boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := greatest(1, least(coalesce(p_limit, 10), 50));
  v_deferred int := 0;
  v_jobs jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND NOT public.has_role(auth.uid(), 'principal'::public.app_role)
  THEN
    RAISE EXCEPTION 'not authorised to process embedding jobs';
  END IF;

  -- Provider unset → safe degrade (no fake vectors)
  IF NOT coalesce(p_provider_configured, false) THEN
    WITH picked AS (
      SELECT id
        FROM public.ai_embedding_jobs
       WHERE status IN ('pending_embed', 'failed', 'processing')
       ORDER BY created_at ASC
       LIMIT v_limit
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.ai_embedding_jobs j
       SET status = 'deferred',
           last_error = 'embedding provider unset — safe degrade',
           updated_at = now(),
           completed_at = now()
      FROM picked
     WHERE j.id = picked.id;

    GET DIAGNOSTICS v_deferred = ROW_COUNT;

    UPDATE public.ai_kms_chunks c
       SET embed_status = 'deferred',
           embedding_stub = jsonb_build_object(
             'status', 'deferred',
             'dims', 0,
             'reason', 'provider_unset'
           )
     WHERE c.id IN (
       SELECT chunk_id FROM public.ai_embedding_jobs
        WHERE status = 'deferred'
          AND updated_at >= now() - interval '2 seconds'
     );

    RETURN jsonb_build_object(
      'action', 'deferred',
      'provider_configured', false,
      'deferred_count', v_deferred,
      'jobs', '[]'::jsonb,
      'note', 'No external embedding call — set OPENROUTER_API_KEY or AI_EMBEDDING_API_KEY'
    );
  END IF;

  -- Claim pending jobs for worker
  WITH picked AS (
    SELECT j.id
      FROM public.ai_embedding_jobs j
     WHERE j.status IN ('pending_embed', 'failed')
     ORDER BY j.created_at ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.ai_embedding_jobs j
       SET status = 'processing',
           attempts = j.attempts + 1,
           updated_at = now(),
           provider_hint = CASE
             WHEN j.provider_hint = 'unset' THEN 'openrouter'
             ELSE j.provider_hint
           END
      FROM picked
     WHERE j.id = picked.id
     RETURNING j.id, j.chunk_id, j.school_id, j.document_id, j.version_id
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'job_id', c.id,
        'chunk_id', c.chunk_id,
        'school_id', c.school_id,
        'document_id', c.document_id,
        'version_id', c.version_id,
        'chunk_text', left(coalesce(ch.chunk_text, ''), 8000)
      )
      ORDER BY c.id
    ),
    '[]'::jsonb
  )
  INTO v_jobs
  FROM claimed c
  JOIN public.ai_kms_chunks ch ON ch.id = c.chunk_id;

  RETURN jsonb_build_object(
    'action', 'claim',
    'provider_configured', true,
    'job_count', coalesce(jsonb_array_length(v_jobs), 0),
    'jobs', v_jobs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_embedding_jobs_process_batch(int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_embedding_jobs_process_batch(int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_embedding_jobs_process_batch(int, boolean) TO service_role;

COMMENT ON FUNCTION public.ai_embedding_jobs_process_batch(int, boolean) IS
  'Cron-friendly: defer embedding jobs when provider unset, else claim a batch for the edge worker.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Prompt seed — teacher outline
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.ai_prompt_library (
  capability_id, version, status, audience,
  system_template, user_template, output_schema,
  max_output_tokens, temperature, caching_eligible, metadata
)
VALUES (
  'teacher.question_paper.generate_outline',
  'v1',
  'production',
  'teacher',
  'You draft a short question-paper section outline from the provided curriculum weight plan only. Never change chapter marks totals or invent chapters. Do not produce a full marking scheme or answer key. Keep under 200 words. Use the facts JSON as the only source of marks and chapters.',
  'Paper plan facts JSON:\n{{facts}}\n\nTeacher notes: {{question}}\n\nWrite a brief outline of section question stems aligned to each chapter''s marks. No marking scheme.',
  '{"type":"plain_text","max_words":200}'::jsonb,
  450,
  0.2,
  true,
  '{"source":"migration","note":"step1 outline only"}'::jsonb
)
ON CONFLICT (capability_id, version) DO UPDATE
  SET status = EXCLUDED.status,
      system_template = EXCLUDED.system_template,
      user_template = EXCLUDED.user_template,
      output_schema = EXCLUDED.output_schema,
      max_output_tokens = EXCLUDED.max_output_tokens,
      temperature = EXCLUDED.temperature,
      metadata = EXCLUDED.metadata,
      updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Workflow registry seeds
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.ai_workflow_registry (workflow_id, version, capability_id, enabled, metadata)
VALUES (
  'student.image_doubt.submit.v1',
  'v1',
  'student.image_doubt.submit',
  true,
  jsonb_build_object(
    'note', 'Submit gate — stops at clarify/OCR-missing; never invents problem text',
    'steps', jsonb_build_array('validate_media', 'safety_screen', 'ocr_extract', 'confidence_gate')
  )
)
ON CONFLICT (workflow_id) DO UPDATE
  SET capability_id = EXCLUDED.capability_id,
      enabled = EXCLUDED.enabled,
      metadata = EXCLUDED.metadata,
      updated_at = now();

INSERT INTO public.ai_workflow_registry (workflow_id, version, capability_id, enabled, metadata)
VALUES (
  'teacher.question_paper.outline.v1',
  'v1',
  'teacher.question_paper.generate_outline',
  true,
  jsonb_build_object(
    'note', 'Step-1 outline via plan + Qwen; no marking scheme; kill-switch → plan-only',
    'steps', jsonb_build_array(
      'permission_purpose', 'compute_plan', 'assemble_context', 'generate_outline', 'validate_outline'
    )
  )
)
ON CONFLICT (workflow_id) DO UPDATE
  SET capability_id = EXCLUDED.capability_id,
      enabled = EXCLUDED.enabled,
      metadata = EXCLUDED.metadata,
      updated_at = now();

INSERT INTO public.ai_workflow_registry (workflow_id, version, capability_id, enabled, metadata)
VALUES (
  'principal.school.health_brief.v1',
  'v1',
  'principal.school.health_brief',
  true,
  jsonb_build_object(
    'note', 'Deterministic AE/EIE school health brief — no LLM',
    'steps', jsonb_build_array('permission_purpose', 'assemble_aggregates', 'emit_brief')
  )
)
ON CONFLICT (workflow_id) DO UPDATE
  SET capability_id = EXCLUDED.capability_id,
      enabled = EXCLUDED.enabled,
      metadata = EXCLUDED.metadata,
      updated_at = now();

-- Keep full image-doubt tutoring disabled (multi-agent / full OCR path reserved)
UPDATE public.ai_workflow_registry
   SET enabled = false,
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'related_submit_workflow', 'student.image_doubt.submit.v1',
         'note', 'Full tutoring after OCR remains deferred — use submit gate'
       ),
       updated_at = now()
 WHERE workflow_id = 'student.image_doubt.v1';
