-- Promote Nova chat prompt to v2 with {{facts}} grounding (matches edge/client BUILTIN_PROMPTS).
-- Retire v1 (no facts placeholder) so ai_prompt_load_production does not override builtin v2.

UPDATE public.ai_prompt_library
SET status = 'retired',
    updated_at = now()
WHERE capability_id = 'student.nova.chat'
  AND version = 'v1'
  AND status = 'production';

INSERT INTO public.ai_prompt_library (
  capability_id, version, status, audience, system_template, user_template,
  output_schema, max_output_tokens, temperature, caching_eligible, metadata
)
SELECT
  'student.nova.chat',
  'v2',
  'production',
  'student',
  'You are Nova, Gurukul''s academic tutor. Use ONLY the provided Academic Engine / EIE facts JSON for personal school metrics (attendance, homework, marks, mastery, weak/strong topics). Never invent attendance %, marks, mastery scores, XP, ranks, or classmate names. If a metric is missing or facts are empty, say school records are not available yet — do not guess. For general study questions unrelated to personal records, you may tutor stepwise without inventing metrics. Prefer stepwise guidance over dumping final answers. Keep under 180 words. Respond in {{language}} when possible.',
  E'Grounding facts JSON (Academic Engine + EIE):\n{{facts}}\n\nStudent message:\n{{question}}',
  '{"type":"plain_text","max_words":180}'::jsonb,
  400,
  0.3,
  false,
  '{"source":"nova_chat_wire","context_pack":"v1"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_prompt_library p
  WHERE p.capability_id = 'student.nova.chat' AND p.version = 'v2'
);

UPDATE public.ai_prompt_library
SET status = 'production',
    system_template = 'You are Nova, Gurukul''s academic tutor. Use ONLY the provided Academic Engine / EIE facts JSON for personal school metrics (attendance, homework, marks, mastery, weak/strong topics). Never invent attendance %, marks, mastery scores, XP, ranks, or classmate names. If a metric is missing or facts are empty, say school records are not available yet — do not guess. For general study questions unrelated to personal records, you may tutor stepwise without inventing metrics. Prefer stepwise guidance over dumping final answers. Keep under 180 words. Respond in {{language}} when possible.',
    user_template = E'Grounding facts JSON (Academic Engine + EIE):\n{{facts}}\n\nStudent message:\n{{question}}',
    output_schema = '{"type":"plain_text","max_words":180}'::jsonb,
    max_output_tokens = 400,
    temperature = 0.3,
    caching_eligible = false,
    metadata = coalesce(metadata, '{}'::jsonb) || '{"source":"nova_chat_wire","context_pack":"v1"}'::jsonb,
    updated_at = now()
WHERE capability_id = 'student.nova.chat'
  AND version = 'v2';
