-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — message_attachments loses its tenant column again
--
-- Drops the fence, the composite foreign key, the index and the column, and
-- restores rpc_send_chat_message to the body that does not supply school_id.
--
-- ORDER MATTERS AND IS NOT THE REVERSE OF THE FORWARD FILE. The function must
-- be restored BEFORE the column is dropped: between those two statements any
-- concurrent send would insert a school_id into a column about to disappear, or
-- omit one from a column that still demands NOT NULL. The forward migration had
-- the same hazard in mirror image, which is why it is one transaction and so is
-- this.
--
-- `messages_id_school_id_key` is dropped too. It exists only as the target of
-- the composite foreign key — `id` is already the primary key — so leaving it
-- behind would be a constraint with no purpose and no explanation.
--
-- Attachment rows created while the column existed KEEP their data; only the
-- school_id is lost, and it remains derivable from the message the row points
-- at. That is the property that made the column safe to add and safe to remove.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_send_chat_message(
  _conversation_id uuid DEFAULT NULL::uuid,
  _receiver_id uuid DEFAULT NULL::uuid,
  _content text DEFAULT ''::text,
  _reply_to_id uuid DEFAULT NULL::uuid,
  _attachment_name text DEFAULT NULL::text,
  _attachment_url text DEFAULT NULL::text,
  _attachment_mime text DEFAULT NULL::text,
  _attachment_size bigint DEFAULT NULL::bigint)
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sender uuid := auth.uid();
  _school uuid;
  _body text := trim(COALESCE(_content, ''));
  _conv public.chat_conversations;
  _row public.messages;
  _has_att boolean := (_attachment_url IS NOT NULL AND length(trim(_attachment_url)) > 0);
BEGIN
  IF _sender IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  _school := public.get_my_school_id();
  IF _school IS NULL THEN
    RAISE EXCEPTION 'school required';
  END IF;
  IF length(_body) = 0 AND NOT _has_att THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;
  IF length(_body) > 8000 THEN
    RAISE EXCEPTION 'Message too long';
  END IF;
  IF _has_att AND NOT public.chat_attachment_url_allowed(trim(_attachment_url), _sender) THEN
    RAISE EXCEPTION 'chat_forbidden: attachment path not allowed';
  END IF;

  IF _conversation_id IS NULL AND _receiver_id IS NOT NULL THEN
    IF NOT public.chat_can_dm(_sender, _receiver_id) THEN
      RAISE EXCEPTION 'chat_forbidden: cannot DM this user';
    END IF;
    _conv := public.rpc_ensure_dm(_receiver_id);
    _conversation_id := _conv.id;
  ELSIF _conversation_id IS NOT NULL THEN
    SELECT * INTO _conv FROM public.chat_conversations WHERE id = _conversation_id;
    IF _conv.id IS NULL OR _conv.school_id <> _school THEN
      RAISE EXCEPTION 'conversation not found';
    END IF;
    IF NOT public.is_chat_participant(_conversation_id, _sender) THEN
      RAISE EXCEPTION 'not a participant';
    END IF;
  ELSE
    RAISE EXCEPTION 'conversation or receiver required';
  END IF;

  IF _reply_to_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = _reply_to_id AND m.conversation_id = _conversation_id
  ) THEN
    RAISE EXCEPTION 'invalid reply target';
  END IF;

  IF _conv.kind = 'dm' THEN
    SELECT cp.user_id INTO _receiver_id
    FROM public.chat_participants cp
    WHERE cp.conversation_id = _conversation_id AND cp.user_id <> _sender
    LIMIT 1;
    IF _receiver_id IS NULL OR NOT public.chat_can_dm(_sender, _receiver_id) THEN
      RAISE EXCEPTION 'chat_forbidden: cannot DM this user';
    END IF;
  ELSE
    _receiver_id := NULL;
  END IF;

  INSERT INTO public.messages (
    sender_id, receiver_id, content, is_read, school_id,
    conversation_id, reply_to_id, has_attachment
  )
  VALUES (
    _sender, _receiver_id,
    CASE WHEN length(_body) = 0 THEN CASE
      WHEN _attachment_mime ILIKE 'image/%' THEN '[Image]'
      ELSE COALESCE(_attachment_name, '[Attachment]')
    END ELSE _body END,
    false, _school, _conversation_id, _reply_to_id, _has_att
  )
  RETURNING * INTO _row;

  IF _has_att THEN
    INSERT INTO public.message_attachments (message_id, name, url, mime_type, size_bytes)
    VALUES (
      _row.id,
      COALESCE(NULLIF(trim(_attachment_name), ''), 'file'),
      trim(_attachment_url),
      _attachment_mime,
      _attachment_size
    );
  END IF;

  UPDATE public.chat_conversations
  SET updated_at = now()
  WHERE id = _conversation_id;

  UPDATE public.chat_participants
  SET last_read_at = now()
  WHERE conversation_id = _conversation_id AND user_id = _sender;

  RETURN _row;
END;
$function$;

DROP POLICY IF EXISTS message_attachments_tenant_fence ON public.message_attachments;

ALTER TABLE public.message_attachments
  DROP CONSTRAINT IF EXISTS message_attachments_message_school_fkey;

DROP INDEX IF EXISTS public.message_attachments_school_id_idx;

ALTER TABLE public.message_attachments
  DROP COLUMN IF EXISTS school_id;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_id_school_id_key;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='message_attachments'
                AND column_name='school_id') THEN
    RAISE EXCEPTION 'ABORT: message_attachments.school_id survived the rollback';
  END IF;
END $$;

DELETE FROM public.schema_migrations
 WHERE version = '20260903110000_message_attachments_tenant_column';

COMMIT;
