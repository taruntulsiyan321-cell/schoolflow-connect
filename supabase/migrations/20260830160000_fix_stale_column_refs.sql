-- ═══════════════════════════════════════════════════════════════════════════
-- Two live breakages, found by scripts/lint-stale-columns.mjs on its first run
--
-- Both are the class G15 now names: plpgsql (and, here, a SQL function created
-- while check_function_bodies was off) resolves column references at EXECUTION.
-- The bodies compile, CREATE OR REPLACE succeeds, every gate passes, and the
-- failure waits for a real user. Confirmed by CALLING each with a real identity
-- and getting SQLSTATE 42703, not by reading the bodies.
--
-- ── 1. get_chat_groups() — chat is broken for every signed-in student ─────
--
--   column c.name does not exist
--
-- public.chat_conversations has `title`. It has never had `name`. The function
-- returns a column NAMED name, which is what makes this easy to misread: the
-- RETURNS TABLE signature is right and the SELECT list is wrong.
--
-- Worth noting how it hid: called with no JWT it returns early on
-- `IF _uid IS NULL THEN RETURN`, so the first probe reported "ran with no
-- error". Not entering a function is not the same as the function being fine.
--
-- ── 2. match_question_bank(...) — and the tenant fix that never ran ───────
--
--   column qb.school_id does not exist
--
-- public.question_bank has no school_id column. It is a SHARED bank across
-- schools by design (§4.2a: a variant generated because one student failed a
-- question is there for the next student who fails it), and the scoping that
-- actually applies is the board filter in the RLS policy
-- qb_select_approved_board — which does apply, because this function is
-- SECURITY INVOKER.
--
-- The predicate `(qb.school_id IS NULL OR qb.school_id = p_school_id)` was added
-- as the fix for the match_question_bank cross-school leak. Because the column
-- does not exist, that fix has never executed once: every call has thrown 42703
-- instead. The leak was not closed by a filter, it was "closed" by the function
-- being dead. Removing the predicate is therefore not a loosening — it restores
-- a function to the behaviour RLS already governs.
--
-- p_school_id is kept in the signature: callers pass it positionally, and
-- changing the signature would break them for a parameter that was never doing
-- anything. It is documented as unused rather than silently dropped.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Guard: fail loudly if the schema is not what this migration assumes ───
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='chat_conversations' AND column_name='name') THEN
    RAISE EXCEPTION 'chat_conversations.name EXISTS — the premise of this migration is wrong, refusing to "fix" a working function';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='chat_conversations' AND column_name='title') THEN
    RAISE EXCEPTION 'chat_conversations.title does not exist either — do not guess at the replacement';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='question_bank' AND column_name='school_id') THEN
    RAISE EXCEPTION 'question_bank.school_id EXISTS — the predicate is valid and must not be removed';
  END IF;
END
$guard$;

-- ── 1. get_chat_groups: c.name -> c.title ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_chat_groups()
 RETURNS TABLE(conversation_id uuid, name text, kind text, unread integer, last_message text, last_time timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    -- chat_conversations.title. The RETURNS TABLE column is still called `name`
    -- so no caller changes; it was the SELECT list that was wrong, not the shape.
    c.title,
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
$function$;

-- ── 2. match_question_bank: drop the reference to a column that never existed ─
CREATE OR REPLACE FUNCTION public.match_question_bank(
  p_query_embedding vector,
  p_class_level integer,
  p_school_id uuid DEFAULT NULL::uuid,
  p_subjects text[] DEFAULT NULL::text[],
  p_match_threshold double precision DEFAULT 0.82,
  p_match_count integer DEFAULT 3)
 RETURNS TABLE(id uuid, question text, options jsonb, correct_index integer, explanation text, subject text, concept text, chapter text, topic text, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  -- p_school_id is accepted and UNUSED. question_bank has no school_id column;
  -- the bank is shared across schools and the scoping that applies is the board
  -- filter in the RLS policy qb_select_approved_board, which reaches this
  -- function because it is SECURITY INVOKER. The parameter is retained because
  -- callers pass it positionally.
  SELECT
    qb.id, qb.question, qb.options, qb.correct_index, qb.explanation,
    qb.subject, qb.concept, qb.chapter, qb.topic,
    1 - (qb.embedding <=> p_query_embedding) AS similarity
  FROM public.question_bank qb
  WHERE qb.embed_status = 'embedded'
    AND qb.is_active = true
    AND qb.is_approved = true
    AND qb.class_level = p_class_level
    AND (p_subjects IS NULL OR qb.subject = ANY(p_subjects))
    AND (1 - (qb.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY qb.embedding <=> p_query_embedding
  LIMIT p_match_count;
$function$;

COMMIT;
