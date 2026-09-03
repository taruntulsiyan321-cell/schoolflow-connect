-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — recreate message_read_receipts and put the INSERT back
--
-- Restores the table, both indexes, all three policies, the realtime
-- publication membership, and the pre-drop body of rpc_mark_conversation_read
-- (including `_prev` and the ROW_COUNT-after-INSERT return value).
--
-- IT DOES NOT RESTORE THE ROWS, and there is nothing to restore: the table was
-- dropped holding zero, and the forward migration refuses to run if that is
-- ever untrue. A rollback that recreates an empty table is a complete rollback
-- ONLY because of that guard.
--
-- Receipts for messages read while the table was absent are gone for good. No
-- reader existed then and none exists now, so nothing observes the gap — but it
-- is a gap, and it is the reason this drop was worth doing before the feature
-- acquired a reader rather than after.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

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

CREATE OR REPLACE FUNCTION public.rpc_mark_conversation_read(_conversation_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

DELETE FROM public.schema_migrations
 WHERE version = '20260903120000_drop_message_read_receipts';

COMMIT;
