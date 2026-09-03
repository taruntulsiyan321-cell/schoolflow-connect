-- ═══════════════════════════════════════════════════════════════════════════
-- message_attachments gets its tenant column — while it is still empty
--
-- G1: "Row Level Security on institution_id, present on every single table."
-- message_attachments has seven columns and none of them is the tenant. It has
-- a SECURITY DEFINER writer (rpc_send_chat_message), three readers, and ZERO
-- ROWS.
--
-- Zero rows is the whole reason this is being done now rather than later. Every
-- part below — NOT NULL with no default, a composite foreign key, a backfill
-- that does not exist — is free today and is a migration with a data phase, a
-- verification phase and a rollback risk the first day somebody sends a file.
-- The column is not more correct next month; it is only more expensive.
--
-- ── HOW TENANCY IS REACHED TODAY, AND WHY THAT IS NOT ENOUGH ──────────────
--
-- The read policy joins its way there:
--
--   EXISTS (SELECT 1 FROM messages m
--            WHERE m.id = message_attachments.message_id
--              AND m.school_id = get_my_school_id() AND ...)
--
-- That is not wrong, and it is not a fence. It is a permissive policy that
-- happens to mention tenancy. G1 asks for a RESTRICTIVE fence AND-ed with every
-- policy on the table, which is what stops the NEXT policy — written by someone
-- adding a feature, in a hurry — from serving a row across schools. A fence
-- cannot be built on a column that does not exist, so this table has been
-- outside the pattern the rest of the schema uses.
--
-- ── WHY A COMPOSITE FOREIGN KEY AND NOT A TRIGGER ─────────────────────────
--
-- Adding school_id creates a second home for a fact messages already holds:
-- G9's exact shape. Two copies of one school id drift, and the drift is
-- invisible until an attachment is served to the wrong school.
--
--   FOREIGN KEY (message_id, school_id) REFERENCES messages (id, school_id)
--
-- makes them unable to disagree. Not "kept in sync by a trigger" — a trigger is
-- code that can be dropped, disabled, or bypassed by a definer function, and
-- this table's only writer IS a definer function. The constraint holds
-- regardless of who writes and regardless of what they remember.
--
-- The cost, stated plainly: an attachment on a message whose school_id is NULL
-- becomes impossible. `messages.school_id` IS nullable, so that is reachable in
-- principle. It is not reachable in practice — rpc_send_chat_message raises
-- 'school required' before inserting, and all 3 live messages carry a school —
-- and the assertion below refuses to create the constraint if that stops being
-- true. If it ever does happen, the insert fails loudly instead of quietly
-- landing an attachment in the wrong tenant, which is the right direction for
-- this failure to point.
--
-- `messages.school_id` being nullable at all is a separate G1 gap. It is
-- reported, not fixed here: widening this migration into the messages table is
-- how a scoped change becomes an unreviewed one.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Guard: everything below assumes the table is still empty ──────────────
DO $$
DECLARE
  _rows int;
  _null_school int;
BEGIN
  SELECT count(*) INTO _rows FROM public.message_attachments;
  IF _rows <> 0 THEN
    RAISE EXCEPTION
      'ABORT: message_attachments has % row(s). This migration adds a NOT NULL column with no default and no backfill; write the backfill first.', _rows;
  END IF;

  SELECT count(*) INTO _null_school FROM public.messages WHERE school_id IS NULL;
  IF _null_school <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % message(s) have a NULL school_id, so the composite foreign key would make attachments on them impossible', _null_school;
  END IF;
END $$;

ALTER TABLE public.message_attachments
  ADD COLUMN IF NOT EXISTS school_id uuid NOT NULL;

-- The FK target. `id` is already the primary key, so this unique constraint is
-- logically redundant — Postgres requires it anyway, because a composite
-- foreign key must reference a declared unique set of columns.
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_id_school_id_key;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_id_school_id_key UNIQUE (id, school_id);

ALTER TABLE public.message_attachments
  DROP CONSTRAINT IF EXISTS message_attachments_message_school_fkey;
ALTER TABLE public.message_attachments
  ADD CONSTRAINT message_attachments_message_school_fkey
  FOREIGN KEY (message_id, school_id)
  REFERENCES public.messages (id, school_id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS message_attachments_school_id_idx
  ON public.message_attachments (school_id);

-- ── The fence ─────────────────────────────────────────────────────────────
-- RESTRICTIVE, so it is AND-ed with every policy on the table including any
-- written later. `same_school` is the idiom the most recent migration
-- (20260902140000, leave_decisions) used.
--
-- WITH CHECK is included even though client INSERT is denied outright by
-- "message_attachments insert deny". A restrictive USING clause does not
-- constrain INSERT at all, so a future migration relaxing that deny would land
-- an unfenced write path; the check costs nothing today and closes that.
DROP POLICY IF EXISTS message_attachments_tenant_fence ON public.message_attachments;
CREATE POLICY message_attachments_tenant_fence ON public.message_attachments
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (public.same_school(school_id))
  WITH CHECK (public.same_school(school_id));

-- ── The writer supplies it ────────────────────────────────────────────────
-- `_school` is already in scope: the function raises 'school required' when it
-- is NULL and writes it to messages three lines above. The only change in this
-- body is school_id in the attachment INSERT.
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
    INSERT INTO public.message_attachments (message_id, school_id, name, url, mime_type, size_bytes)
    VALUES (
      _row.id,
      _school,
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

-- ── Verification ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='message_attachments'
                    AND column_name='school_id' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'ABORT: message_attachments.school_id is missing or nullable';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.message_attachments'::regclass
                    AND conname='message_attachments_message_school_fkey') THEN
    RAISE EXCEPTION 'ABORT: the composite foreign key was not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid='public.message_attachments'::regclass
                    AND polname='message_attachments_tenant_fence'
                    AND polpermissive = false) THEN
    RAISE EXCEPTION 'ABORT: the tenant fence is missing or is not RESTRICTIVE';
  END IF;

  -- G11: prove the writer actually carries the column, rather than trusting
  -- that this file replaced the function it meant to.
  IF (SELECT pg_get_functiondef(oid) FROM pg_proc
       WHERE proname='rpc_send_chat_message' AND pronamespace='public'::regnamespace)
     NOT LIKE '%message_attachments (message_id, school_id,%' THEN
    RAISE EXCEPTION
      'ABORT: rpc_send_chat_message does not insert school_id — every attachment would violate NOT NULL';
  END IF;
END $$;

COMMIT;
