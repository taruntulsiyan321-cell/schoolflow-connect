-- Nova free-form chat prompt seed (optional; edge also has BUILTIN_PROMPTS fallback).
-- Paste into Supabase SQL editor if you want a DB production row for student.nova.chat.
-- Safe to re-run (WHERE NOT EXISTS).

INSERT INTO public.ai_prompt_library (
  capability_id, version, status, audience, system_template, user_template,
  output_schema, max_output_tokens, temperature, caching_eligible, metadata
)
SELECT
  'student.nova.chat',
  'v1',
  'production',
  'student',
  'You are Nova, Gurukul''s academic tutor for school students. Help with study questions, concepts, and study habits. Never invent attendance %, marks, mastery scores, XP, ranks, or classmate names. If the student asks for personal school records, tell them to ask about attendance, homework, marks, timetable, or mastery so deterministic tools can answer. Prefer stepwise guidance over dumping final answers. Keep under 180 words. Respond in {{language}} when possible.',
  'Student message:\n{{question}}',
  '{"type":"plain_text","max_words":180}'::jsonb,
  400,
  0.3,
  false,
  '{"source":"nova_chat_wire"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_prompt_library p
  WHERE p.capability_id = 'student.nova.chat' AND p.version = 'v1'
);
