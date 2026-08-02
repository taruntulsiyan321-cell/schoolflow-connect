-- Phase 3 remaining production paths:
-- image_doubt.solve, voice_doubt.submit, marking_scheme, prompt shadow traffic,
-- EIE school rollup enrichment seeds. Roles: admin|teacher|student|parent|principal only.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Prompt shadow loader + feature flag
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_prompt_load_shadow(p_capability_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  SELECT capability_id, version, status, audience, system_template, user_template,
         output_schema, max_output_tokens, temperature, caching_eligible, metadata
    INTO r
  FROM public.ai_prompt_library
  WHERE capability_id = p_capability_id AND status = 'shadow'
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'capability_id', r.capability_id,
    'version', r.version,
    'status', r.status,
    'audience', r.audience,
    'system_template', r.system_template,
    'user_template', r.user_template,
    'output_schema', r.output_schema,
    'max_output_tokens', r.max_output_tokens,
    'temperature', r.temperature,
    'caching_eligible', r.caching_eligible,
    'metadata', r.metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_prompt_load_shadow(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_prompt_load_shadow(text) TO service_role;

INSERT INTO public.ai_feature_flags (school_id, flag_key, enabled, metadata)
SELECT NULL, 'ai.prompt.shadow_traffic', false, '{"percent":0,"note":"Shadow prompt % of traffic; never auto-promotes"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_feature_flags f
  WHERE f.flag_key = 'ai.prompt.shadow_traffic' AND f.school_id IS NULL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Prompt library seeds (solve + marking scheme)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.ai_prompt_library (
  capability_id, version, status, audience, system_template, user_template,
  output_schema, max_output_tokens, temperature, caching_eligible, metadata
)
VALUES (
  'student.image_doubt.solve',
  'v1',
  'production',
  'student',
  'You tutor from reconstructed question text and approved retrieval snippets only. Never invent mastery, attendance, or marks percentages. Prefer stepwise guidance over answer dumping. Keep under 180 words.',
  'Grounding facts JSON:
{{facts}}

Student question: {{question}}

Explain briefly using only these facts.',
  '{"type":"plain_text","max_words":180}'::jsonb,
  400,
  0.15,
  true,
  '{"source":"migration","note":"post-OCR gated tutoring"}'::jsonb
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

INSERT INTO public.ai_prompt_library (
  capability_id, version, status, audience, system_template, user_template,
  output_schema, max_output_tokens, temperature, caching_eligible, metadata
)
VALUES (
  'teacher.question_paper.marking_scheme',
  'v1',
  'production',
  'teacher',
  'You draft a short marking scheme from the provided paper outline only. Never invent chapter lists or change total marks. Do not write a full paper body. Keep under 220 words. Use the facts JSON as the only source of totals.',
  'Outline/facts JSON:
{{facts}}

Teacher notes: {{question}}

Write a brief marking scheme aligned to the outline.',
  '{"type":"plain_text","max_words":220}'::jsonb,
  500,
  0.2,
  true,
  '{"source":"migration","note":"requires outline in session"}'::jsonb
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
  'student.image_doubt.solve.v1',
  'v1',
  'student.image_doubt.solve',
  true,
  jsonb_build_object(
    'note', 'Gated post-OCR tutoring — requires reconstructed_question + extraction_confidence',
    'steps', jsonb_build_array(
      'confidence_gate', 'cache_lookup', 'retrieve_kms', 'model_explain', 'validate_answer'
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
  'student.voice_doubt.submit.v1',
  'v1',
  'student.voice_doubt.submit',
  true,
  jsonb_build_object(
    'note', 'STT stub — clarifies when provider unset; never invents transcript',
    'steps', jsonb_build_array('validate_media', 'safety_screen', 'stt_extract', 'confidence_gate')
  )
)
ON CONFLICT (workflow_id) DO UPDATE
  SET capability_id = EXCLUDED.capability_id,
      enabled = EXCLUDED.enabled,
      metadata = EXCLUDED.metadata,
      updated_at = now();

INSERT INTO public.ai_workflow_registry (workflow_id, version, capability_id, enabled, metadata)
VALUES (
  'teacher.question_paper.marking_scheme.v1',
  'v1',
  'teacher.question_paper.marking_scheme',
  true,
  jsonb_build_object(
    'note', 'Requires outline in paper_gen session; Qwen + Validator; kill-switch safe',
    'steps', jsonb_build_array(
      'permission_purpose', 'session_outline_gate', 'generate_scheme', 'validate_scheme'
    )
  )
)
ON CONFLICT (workflow_id) DO UPDATE
  SET capability_id = EXCLUDED.capability_id,
      enabled = EXCLUDED.enabled,
      metadata = EXCLUDED.metadata,
      updated_at = now();

-- Keep full OCR→tutor image_doubt.v1 disabled; post-OCR uses solve workflow
UPDATE public.ai_workflow_registry
   SET enabled = false,
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'related_submit_workflow', 'student.image_doubt.submit.v1',
         'related_solve_workflow', 'student.image_doubt.solve.v1',
         'note', 'Full OCR→tutor reserved — use submit then gated solve'
       ),
       updated_at = now()
 WHERE workflow_id = 'student.image_doubt.v1';

-- Keep full paper generation disabled (no multi-agent activation)
UPDATE public.ai_workflow_registry
   SET enabled = false,
       updated_at = now()
 WHERE workflow_id = 'teacher.question_paper.v1';
