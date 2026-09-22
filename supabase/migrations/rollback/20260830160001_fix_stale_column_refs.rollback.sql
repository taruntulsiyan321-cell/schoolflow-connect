-- ROLLBACK 20260830160001_fix_stale_column_refs — written 2026-09-22; the migration shipped without one.
--
-- Puts back get_chat_groups (20260803160000) and match_question_bank (20260821180000) verbatim, as they were before
-- this migration repointed them at columns that exist. THIS RESTORES THE STALE REFERENCES: both then name columns
-- later migrations removed, and fail when called. Roll back only as part of undoing those later migrations, newest
-- first. If a later migration dropped either function, there is nothing here to restore it onto.
-- get_chat_groups: verbatim from 20260803160000_gurukul_chat_mvp_features.sql
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

-- match_question_bank: verbatim from 20260821180000_tenant_scope_semantic_search_rpcs.sql
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


DELETE FROM public.schema_migrations WHERE version = '20260830160001_fix_stale_column_refs';
