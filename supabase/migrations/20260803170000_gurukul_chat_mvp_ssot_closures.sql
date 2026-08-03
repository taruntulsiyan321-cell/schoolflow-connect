-- =============================================================================
-- Gurukul Chat MVP — SSOT closures (read receipts + list/open/search RPCs)
-- Apply after 20260803161000_gurukul_chat_mvp.sql (+ security hardening if used)
-- Idempotent.
-- =============================================================================

-- ── 1. Read receipts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_read_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_read_receipts_conv_user
  ON public.message_read_receipts (conversation_id, user_id, read_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_read_receipts_message
  ON public.message_read_receipts (message_id);

ALTER TABLE public.message_read_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_read_receipts select" ON public.message_read_receipts;
CREATE POLICY "message_read_receipts select" ON public.message_read_receipts
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND (
      user_id = auth.uid()
      OR (
        conversation_id IS NOT NULL
        AND public.is_chat_participant(conversation_id, auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "message_read_receipts insert self" ON public.message_read_receipts;
CREATE POLICY "message_read_receipts insert self" ON public.message_read_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND school_id = public.get_my_school_id()
  );

DROP POLICY IF EXISTS "message_read_receipts update self" ON public.message_read_receipts;
CREATE POLICY "message_read_receipts update self" ON public.message_read_receipts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND school_id = public.get_my_school_id())
  WITH CHECK (user_id = auth.uid());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'message_read_receipts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_read_receipts;
  END IF;
END $$;

-- Participants: tenant + unread cache columns
ALTER TABLE public.chat_participants
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);

UPDATE public.chat_participants cp
SET school_id = c.school_id
FROM public.chat_conversations c
WHERE c.id = cp.conversation_id
  AND cp.school_id IS NULL;

ALTER TABLE public.chat_participants
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0;

-- ── 2. Mark read writes receipts ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_mark_conversation_read(_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _prev timestamptz;
  _n integer := 0;
  _peer uuid;
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.is_chat_participant(_conversation_id, _uid) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  SELECT cp.last_read_at INTO _prev
  FROM public.chat_participants cp
  WHERE cp.conversation_id = _conversation_id AND cp.user_id = _uid;

  INSERT INTO public.message_read_receipts (message_id, conversation_id, school_id, user_id, read_at)
  SELECT m.id, m.conversation_id, COALESCE(m.school_id, _school), _uid, now()
  FROM public.messages m
  WHERE m.conversation_id = _conversation_id
    AND m.school_id = _school
    AND m.sender_id <> _uid
    AND m.deleted_at IS NULL
    AND (_prev IS NULL OR m.created_at > _prev)
  ON CONFLICT (message_id, user_id) DO UPDATE
  SET read_at = EXCLUDED.read_at;

  GET DIAGNOSTICS _n = ROW_COUNT;

  UPDATE public.chat_participants
  SET last_read_at = now(), unread_count = 0, school_id = COALESCE(school_id, _school)
  WHERE conversation_id = _conversation_id AND user_id = _uid;

  SELECT cp.user_id INTO _peer
  FROM public.chat_participants cp
  JOIN public.chat_conversations c ON c.id = cp.conversation_id
  WHERE cp.conversation_id = _conversation_id
    AND cp.user_id <> _uid
    AND c.kind = 'dm'
  LIMIT 1;

  IF _peer IS NOT NULL THEN
    UPDATE public.messages
    SET is_read = true, read_at = COALESCE(read_at, now())
    WHERE conversation_id = _conversation_id
      AND sender_id = _peer
      AND receiver_id = _uid
      AND is_read = false;
  END IF;

  RETURN _n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_mark_conversation_read(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_mark_conversation_read(uuid) TO authenticated;

-- ── 3. List conversations (searchable inbox) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_list_conversations(
  _search text DEFAULT NULL,
  _limit int DEFAULT 50
)
RETURNS TABLE (
  conversation_id uuid,
  kind text,
  title text,
  class_id uuid,
  peer_user_id uuid,
  peer_role text,
  unread integer,
  last_message text,
  last_time timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _q text := lower(nullif(btrim(coalesce(_search, '')), ''));
  _lim int := least(greatest(coalesce(_limit, 50), 1), 100);
BEGIN
  RETURN QUERY
  SELECT i.*
  FROM public.get_chat_inbox() i
  WHERE (
    _q IS NULL
    OR lower(COALESCE(i.title, '')) LIKE '%' || _q || '%'
    OR lower(COALESCE(i.last_message, '')) LIKE '%' || _q || '%'
  )
  ORDER BY COALESCE(i.last_time, '-infinity'::timestamptz) DESC
  LIMIT _lim;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_list_conversations(text, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_list_conversations(text, int) TO authenticated;

-- ── 4. Open thread (messages + mark read) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_open_conversation(
  _conversation_id uuid,
  _before timestamptz DEFAULT NULL,
  _limit int DEFAULT 80
)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  sender_name text,
  receiver_id uuid,
  content text,
  message_type text,
  reply_to_id uuid,
  reply_preview text,
  deleted_at timestamptz,
  created_at timestamptz,
  is_read boolean,
  attachment_id uuid,
  attachment_url text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _lim int := least(greatest(coalesce(_limit, 80), 1), 200);
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.is_chat_participant(_conversation_id, _uid) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  PERFORM public.rpc_mark_conversation_read(_conversation_id);

  RETURN QUERY
  SELECT
    m.id AS message_id,
    m.conversation_id,
    m.sender_id,
    COALESCE(p.full_name, 'User') AS sender_name,
    m.receiver_id,
    CASE WHEN m.deleted_at IS NOT NULL THEN 'Message deleted' ELSE m.content END AS content,
    CASE
      WHEN m.deleted_at IS NOT NULL THEN 'text'
      WHEN EXISTS (
        SELECT 1 FROM public.message_attachments a
        WHERE a.message_id = m.id AND a.mime_type ILIKE 'image/%'
      ) THEN 'image'
      WHEN EXISTS (
        SELECT 1 FROM public.message_attachments a
        WHERE a.message_id = m.id AND a.mime_type = 'application/pdf'
      ) THEN 'pdf'
      ELSE 'text'
    END AS message_type,
    m.reply_to_id,
    CASE
      WHEN rm.id IS NULL THEN NULL
      WHEN rm.deleted_at IS NOT NULL THEN 'Deleted message'
      ELSE left(rm.content, 120)
    END AS reply_preview,
    m.deleted_at,
    m.created_at,
    m.is_read,
    a.id AS attachment_id,
    a.url AS attachment_url,
    a.name AS attachment_name,
    a.mime_type AS attachment_mime,
    a.size_bytes AS attachment_size
  FROM public.messages m
  LEFT JOIN public.profiles p ON p.id = m.sender_id
  LEFT JOIN public.messages rm ON rm.id = m.reply_to_id
  LEFT JOIN LATERAL (
    SELECT * FROM public.message_attachments ma
    WHERE ma.message_id = m.id
    ORDER BY ma.created_at
    LIMIT 1
  ) a ON true
  WHERE m.conversation_id = _conversation_id
    AND m.school_id = _school
    AND (_before IS NULL OR m.created_at < _before)
  ORDER BY m.created_at DESC
  LIMIT _lim;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_open_conversation(uuid, timestamptz, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_open_conversation(uuid, timestamptz, int) TO authenticated;

-- ── 5. Search chats ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_search_chat(
  _query text,
  _limit int DEFAULT 40
)
RETURNS TABLE (
  result_kind text,
  conversation_id uuid,
  message_id uuid,
  title text,
  snippet text,
  rank_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _q text := lower(nullif(btrim(coalesce(_query, '')), ''));
  _lim int := least(greatest(coalesce(_limit, 40), 1), 80);
BEGIN
  IF _uid IS NULL OR _school IS NULL OR _q IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT * FROM (
    SELECT
      'conversation'::text AS result_kind,
      i.conversation_id,
      NULL::uuid AS message_id,
      i.title,
      COALESCE(i.last_message, '') AS snippet,
      COALESCE(i.last_time, now()) AS rank_at
    FROM public.rpc_list_conversations(_q, _lim) i
    UNION ALL
    SELECT
      'message'::text,
      m.conversation_id,
      m.id,
      COALESCE(c.title, 'Chat'),
      left(m.content, 160),
      m.created_at
    FROM public.messages m
    JOIN public.chat_conversations c ON c.id = m.conversation_id
    JOIN public.chat_participants cp
      ON cp.conversation_id = m.conversation_id AND cp.user_id = _uid
    WHERE m.school_id = _school
      AND m.deleted_at IS NULL
      AND m.conversation_id IS NOT NULL
      AND lower(m.content) LIKE '%' || _q || '%'
  ) s
  ORDER BY s.rank_at DESC NULLS LAST
  LIMIT _lim;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_search_chat(text, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_search_chat(text, int) TO authenticated;

-- ── 6. Create-group aliases (product naming) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_class_group(
  _class_id uuid,
  _title text DEFAULT NULL
)
RETURNS public.chat_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.chat_conversations;
BEGIN
  _row := public.rpc_ensure_class_group(_class_id);
  IF nullif(btrim(coalesce(_title, '')), '') IS NOT NULL THEN
    UPDATE public.chat_conversations
    SET title = btrim(_title), updated_at = now()
    WHERE id = _row.id
    RETURNING * INTO _row;
  END IF;
  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_class_group(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_create_class_group(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_create_teacher_group(_title text DEFAULT NULL)
RETURNS public.chat_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.chat_conversations;
BEGIN
  _row := public.rpc_ensure_teacher_group();
  IF nullif(btrim(coalesce(_title, '')), '') IS NOT NULL THEN
    UPDATE public.chat_conversations
    SET title = btrim(_title), updated_at = now()
    WHERE id = _row.id
    RETURNING * INTO _row;
  END IF;
  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_teacher_group(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_create_teacher_group(text) TO authenticated;

COMMENT ON TABLE public.message_read_receipts IS
  'Per-message read receipts for Gurukul Chat MVP';
COMMENT ON FUNCTION public.rpc_list_conversations(text, int) IS
  'List conversations (inbox) with optional title/preview search';
COMMENT ON FUNCTION public.rpc_open_conversation(uuid, timestamptz, int) IS
  'Open conversation thread (newest-first page) and mark read';
COMMENT ON FUNCTION public.rpc_search_chat(text, int) IS
  'Search conversations and message bodies the caller can access';