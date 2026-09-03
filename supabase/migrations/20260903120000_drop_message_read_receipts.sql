-- ═══════════════════════════════════════════════════════════════════════════
-- message_read_receipts is deleted, and so is the INSERT that filled it
--
-- ── THE THREE PREDICATES, EACH CHECKED SEPARATELY ─────────────────────────
--
-- 1. NOT IN THE LOCKED DECISIONS. §10.12 and §10.15 list what messaging owes:
--    who may message whom, that student-to-student messages are "private but
--    reportable", that reported messages go to the class teacher. No read
--    receipt, no seen state, no delivered state, anywhere in the document.
--
-- 2. ZERO ROWS. Asserted below rather than remembered.
--
-- 3. NO READER — and this was checked properly, because "I could not find one"
--    is not the same claim. Across the whole database: one function mentions
--    the table (rpc_mark_conversation_read) and it only ever INSERTs; no view
--    selects from it; no policy on any other table references it; it has no
--    triggers. In the client: `message_read_receipts` appears in exactly two
--    places, an alias list in entities.ts and the generated types file. Neither
--    is a read.
--
-- ── WHAT IT WAS THE THIRD COPY OF ─────────────────────────────────────────
--
-- rpc_mark_conversation_read maintains THREE homes for "has this been read":
--
--   message_read_receipts          per message, per user   0 rows, no reader
--   chat_participants.last_read_at + unread_count          read by the UI
--   messages.is_read + read_at                             read by the UI
--
-- G9, twice over. The two that survive are both genuinely read, so this drops
-- the one that is not and leaves the remaining duplication reported rather than
-- quietly restructured — collapsing last_read_at and is_read into one home is a
-- design change, not a deletion, and it belongs in its own batch.
--
-- ── THE RETURN VALUE IS THE TRAP IN THIS MIGRATION ────────────────────────
--
-- The function is `RETURNS integer`, and `_n` was
-- `GET DIAGNOSTICS ROW_COUNT` taken IMMEDIATELY AFTER the receipts INSERT. Its
-- return value is therefore "how many receipt rows were written". Delete the
-- INSERT and leave the rest alone, and the function returns whatever ROW_COUNT
-- happens to hold from the preceding statement — a number that means nothing,
-- with the same type and no error.
--
-- `_n` is now taken from the UPDATE that marks the peer's messages read, which
-- is a true count of what the call did. Safe to change: messageService.ts:475
-- destructures `{ error }` only and never looks at the value.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  _rows int;
  _readers int;
BEGIN
  IF to_regclass('public.message_read_receipts') IS NULL THEN
    RAISE NOTICE 'message_read_receipts already dropped';
    RETURN;
  END IF;

  SELECT count(*) INTO _rows FROM public.message_read_receipts;
  IF _rows <> 0 THEN
    RAISE EXCEPTION
      'ABORT: message_read_receipts has % row(s); it was dropped on the premise that it holds none', _rows;
  END IF;

  -- Re-prove predicate 3 at apply time, not just at authoring time. A reader
  -- added between writing this file and running it must stop the drop.
  SELECT count(*) INTO _readers
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND p.proname <> 'rpc_mark_conversation_read'
    AND pg_get_functiondef(p.oid) ILIKE '%message_read_receipts%';

  IF _readers <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % function(s) other than rpc_mark_conversation_read now reference message_read_receipts', _readers;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_views
              WHERE schemaname = 'public' AND definition ILIKE '%message_read_receipts%') THEN
    RAISE EXCEPTION 'ABORT: a view now selects from message_read_receipts';
  END IF;
END $$;

-- ── The writer, without the write ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_mark_conversation_read(_conversation_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _n integer := 0;
  _peer uuid;
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.is_chat_participant(_conversation_id, _uid) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  -- `_prev` is gone with the INSERT it existed for: it read
  -- chat_participants.last_read_at only to decide which messages still needed a
  -- receipt row. The UPDATE below sets last_read_at unconditionally and never
  -- needed the old value.

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

    -- Taken here, where it means something: the number of messages this call
    -- actually moved to read. Previously it was the receipt-row count.
    GET DIAGNOSTICS _n = ROW_COUNT;
  END IF;

  RETURN _n;
END;
$function$;

-- Dropping the table removes its indexes, policies, foreign keys and its
-- membership of the supabase_realtime publication along with it.
DROP TABLE IF EXISTS public.message_read_receipts;

-- ── Verification ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.message_read_receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: public.message_read_receipts still exists';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime'
                AND schemaname = 'public'
                AND tablename = 'message_read_receipts') THEN
    RAISE EXCEPTION 'ABORT: the table is still in the supabase_realtime publication';
  END IF;

  -- The RPC must survive. It is the only thing that clears unread_count, and
  -- dropping it would leave every conversation permanently unread.
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE proname = 'rpc_mark_conversation_read'
                    AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'ABORT: rpc_mark_conversation_read was removed; unread counts would never clear';
  END IF;

  IF (SELECT pg_get_functiondef(oid) FROM pg_proc
       WHERE proname = 'rpc_mark_conversation_read'
         AND pronamespace = 'public'::regnamespace) ILIKE '%message_read_receipts%' THEN
    RAISE EXCEPTION 'ABORT: rpc_mark_conversation_read still references the dropped table';
  END IF;

  -- The two surviving homes must still be written, or this migration has
  -- broken read state instead of tidying it.
  IF (SELECT pg_get_functiondef(oid) FROM pg_proc
       WHERE proname = 'rpc_mark_conversation_read'
         AND pronamespace = 'public'::regnamespace) NOT ILIKE '%unread_count = 0%' THEN
    RAISE EXCEPTION 'ABORT: the rewritten RPC no longer clears unread_count';
  END IF;

  IF (SELECT pg_get_functiondef(oid) FROM pg_proc
       WHERE proname = 'rpc_mark_conversation_read'
         AND pronamespace = 'public'::regnamespace) NOT ILIKE '%is_read = true%' THEN
    RAISE EXCEPTION 'ABORT: the rewritten RPC no longer marks the peer''s messages read';
  END IF;
END $$;

COMMIT;
