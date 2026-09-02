-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — stale column refs
-- Undoes 20260830160000_fix_stale_column_refs.sql
--
-- ⚠ This rollback RE-BREAKS two live functions, deliberately.
--
-- The migration it undoes fixed match_question_bank() and get_chat_groups(),
-- both of which were throwing in production because an earlier tenant fix left
-- them referencing a column that does not exist. Restoring the prior bodies
-- restores those errors. That is what rolling this back MEANS, and it is stated
-- here so nobody runs it expecting a harmless revert.
--
-- match_question_bank was replaced again by 20260831100000 (the board fence).
-- Roll that back FIRST or this file will discard the fence.
--
-- ── Order matters ─────────────────────────────────────────────────────────
--
-- These rollbacks unwind a CHAIN. Several of these migrations replaced a
-- function that a later one replaced again, so restoring an older body out of
-- order silently discards the newer fix. Apply rollbacks in reverse timestamp
-- order, newest first.
--
-- ── What this file can and cannot promise ─────────────────────────────────
--
-- It restores the definition recorded in the migration named below, which is
-- the last one in this repository before the migration being undone. If some
-- session had replaced that function directly against the database without
-- writing a migration, that out-of-band body is not in the repo and is not
-- recoverable here. Nothing in the repo suggests that happened for these.

-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- get_chat_groups() — body extracted verbatim from 20260803160000_gurukul_chat_mvp_features.sql
CREATE OR REPLACE FUNCTION public.get_chat_groups()
RETURNS TABLE(
  conversation_id uuid,
  name text,
  kind text,
  unread integer,
  last_message text,
  last_time timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.kind,
    COALESCE((
      SELECT COUNT(*)::integer
      FROM public.messages m
      WHERE m.conversation_id = c.id
        AND m.sender_id <> _uid
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(p.last_read_at, 'epoch'::timestamptz)
    ), 0) AS unread,
    (
      SELECT CASE
        WHEN lm.deleted_at IS NOT NULL THEN 'This message was deleted'
        WHEN COALESCE(lm.attachment_name, '') <> '' AND trim(lm.content) = '' THEN '📎 ' || lm.attachment_name
        ELSE lm.content
      END
      FROM public.messages lm
      WHERE lm.conversation_id = c.id
      ORDER BY lm.created_at DESC
      LIMIT 1
    ) AS last_message,
    (
      SELECT lm.created_at
      FROM public.messages lm
      WHERE lm.conversation_id = c.id
      ORDER BY lm.created_at DESC
      LIMIT 1
    ) AS last_time
  FROM public.chat_conversations c
  JOIN public.chat_participants p ON p.conversation_id = c.id AND p.user_id = _uid
  WHERE c.school_id = public.get_my_school_id();
END;
$$;

-- match_question_bank() — body extracted verbatim from 20260821180000_tenant_scope_semantic_search_rpcs.sql
CREATE OR REPLACE FUNCTION public.match_question_bank(
  p_query_embedding vector(1536),
  p_class_level int,
  p_school_id uuid DEFAULT NULL,
  p_subjects text[] DEFAULT NULL,
  p_match_threshold float DEFAULT 0.82,
  p_match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  question text,
  options jsonb,
  correct_index int,
  explanation text,
  subject text,
  concept text,
  chapter text,
  topic text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    qb.id, qb.question, qb.options, qb.correct_index, qb.explanation,
    qb.subject, qb.concept, qb.chapter, qb.topic,
    1 - (qb.embedding <=> p_query_embedding) AS similarity
  FROM public.question_bank qb
  WHERE qb.embed_status = 'embedded'
    AND qb.is_active = true
    AND qb.is_approved = true
    AND qb.class_level = p_class_level
    AND (qb.school_id IS NULL OR qb.school_id = p_school_id)
    AND (p_subjects IS NULL OR qb.subject = ANY(p_subjects))
    AND (1 - (qb.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY qb.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;


DO $guard$
DECLARE _missing text;
BEGIN
  SELECT string_agg(x, ', ') INTO _missing
    FROM unnest(ARRAY['get_chat_groups', 'match_question_bank']) AS x
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = x);
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'rollback did not leave these defined: %', _missing;
  END IF;
END
$guard$;

COMMIT;