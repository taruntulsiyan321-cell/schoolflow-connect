-- Phase 1 remainder + Phase 2 foundations:
-- Prompt Library v1, AI Feedback Loop signals, optional workflow registry seed.

-- ── Prompt Library (versioned contracts) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_prompt_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_id text NOT NULL,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'shadow', 'production', 'retired')),
  audience text NOT NULL DEFAULT 'student'
    CHECK (audience IN ('student', 'teacher', 'parent', 'principal', 'admin', 'platform')),
  system_template text NOT NULL,
  user_template text NOT NULL DEFAULT '',
  output_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_output_tokens int NOT NULL DEFAULT 250 CHECK (max_output_tokens > 0 AND max_output_tokens <= 8000),
  temperature numeric NOT NULL DEFAULT 0.2,
  caching_eligible boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_prompt_library_cap_ver UNIQUE (capability_id, version)
);

CREATE INDEX IF NOT EXISTS ai_prompt_library_cap_status
  ON public.ai_prompt_library (capability_id, status);

ALTER TABLE public.ai_prompt_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_prompt_library read admin" ON public.ai_prompt_library;
CREATE POLICY "ai_prompt_library read admin" ON public.ai_prompt_library
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'super_admin')
  );

DROP POLICY IF EXISTS "ai_prompt_library write admin" ON public.ai_prompt_library;
CREATE POLICY "ai_prompt_library write admin" ON public.ai_prompt_library
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT ON public.ai_prompt_library TO authenticated;
GRANT ALL ON public.ai_prompt_library TO service_role;

-- Seed production prompts (idempotent)
INSERT INTO public.ai_prompt_library (
  capability_id, version, status, audience, system_template, user_template,
  output_schema, max_output_tokens, temperature, caching_eligible, metadata
)
SELECT v.capability_id, v.version, v.status, v.audience, v.system_template, v.user_template,
       v.output_schema::jsonb, v.max_output_tokens, v.temperature, v.caching_eligible, v.metadata::jsonb
FROM (VALUES
  (
    'student.performance.explain',
    'v1',
    'production',
    'student',
    'You explain Gurukul Academic Engine and Educational Intelligence facts only. Never invent numbers, mastery scores, attendance, or marks. If a figure is missing, say it is unavailable. Keep under 120 words. Encourage without shaming.',
    'Facts JSON:\n{{facts}}\n\nWrite a short plain-language performance summary.',
    '{"type":"plain_text","max_words":120}',
    250,
    0.1,
    true,
    '{"source":"ssot_phase1"}'
  ),
  (
    'student.concept.explain',
    'v1',
    'production',
    'student',
    'You explain one school concept using only the provided Educational Intelligence and Academic Engine facts. Never invent mastery percentages or exam scores. Prefer stepwise guidance over answer dumping. Keep under 150 words.',
    'Concept facts JSON:\n{{facts}}\n\nStudent question: {{question}}\n\nExplain the concept briefly using only these facts.',
    '{"type":"plain_text","max_words":150}',
    300,
    0.15,
    true,
    '{"source":"ssot_phase1"}'
  ),
  (
    'student.recommendation.explain',
    'v1',
    'production',
    'student',
    'You rephrase a deterministic recommendation package. Never change the recommended concept, priority order, or invent new metrics. Keep under 80 words. Task-focused, no shaming.',
    'Recommendation package JSON:\n{{facts}}\n\nWrite a short encouraging rationale for why this next step makes sense.',
    '{"type":"plain_text","max_words":80}',
    200,
    0.1,
    true,
    '{"source":"ssot_phase2"}'
  )
) AS v(capability_id, version, status, audience, system_template, user_template, output_schema, max_output_tokens, temperature, caching_eligible, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_prompt_library p
  WHERE p.capability_id = v.capability_id AND p.version = v.version
);

-- Loader helper for gateway / modelRouter (service_role)
CREATE OR REPLACE FUNCTION public.ai_prompt_load_production(p_capability_id text)
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
  WHERE capability_id = p_capability_id AND status = 'production'
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

REVOKE ALL ON FUNCTION public.ai_prompt_load_production(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_prompt_load_production(text) TO service_role;

-- ── AI Feedback Loop signals ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_feedback_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text,
  school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  actor_user_id uuid,
  actor_role text,
  feature_id text,
  signal_type text NOT NULL
    CHECK (signal_type IN (
      'like', 'dislike', 'useful', 'not_useful', 'accept', 'reject',
      'edit', 'retry', 'dismiss', 'complete', 'show_full_solution', 'correction'
    )),
  target_kind text NOT NULL DEFAULT 'response'
    CHECK (target_kind IN ('response', 'recommendation', 'artifact', 'prompt')),
  target_ref text,
  rating smallint CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  comment_redacted text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_feedback_signals_school_created
  ON public.ai_feedback_signals (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_feedback_signals_feature_type
  ON public.ai_feedback_signals (feature_id, signal_type, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_feedback_signals_request
  ON public.ai_feedback_signals (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.ai_feedback_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_feedback insert own" ON public.ai_feedback_signals;
CREATE POLICY "ai_feedback insert own" ON public.ai_feedback_signals
  FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

DROP POLICY IF EXISTS "ai_feedback read own or admin" ON public.ai_feedback_signals;
CREATE POLICY "ai_feedback read own or admin" ON public.ai_feedback_signals
  FOR SELECT TO authenticated
  USING (
    actor_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'super_admin')
  );

GRANT SELECT, INSERT ON public.ai_feedback_signals TO authenticated;
GRANT ALL ON public.ai_feedback_signals TO service_role;

-- ── Workflow registry (definitions live in code; DB holds activation flags) ───
CREATE TABLE IF NOT EXISTS public.ai_workflow_registry (
  workflow_id text PRIMARY KEY,
  version text NOT NULL,
  capability_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_workflow_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_workflow_registry read admin" ON public.ai_workflow_registry;
CREATE POLICY "ai_workflow_registry read admin" ON public.ai_workflow_registry
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'super_admin')
  );

GRANT SELECT ON public.ai_workflow_registry TO authenticated;
GRANT ALL ON public.ai_workflow_registry TO service_role;

INSERT INTO public.ai_workflow_registry (workflow_id, version, capability_id, enabled, metadata)
VALUES (
  'teacher.question_paper.v1',
  'v1',
  'teacher.question_paper.generate',
  false,
  '{"note":"Skeleton only — full pipeline deferred","steps":["spec","cache_lookup","generate","validate","teacher_review"]}'::jsonb
)
ON CONFLICT (workflow_id) DO NOTHING;
