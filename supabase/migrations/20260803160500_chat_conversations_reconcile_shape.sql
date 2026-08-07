-- Migration 20260803161000_gurukul_chat_mvp.sql declares chat_conversations
-- via CREATE TABLE IF NOT EXISTS with columns/constraints (title instead of
-- name, dm_key, updated_at, a widened kind CHECK including 'dm', a nullable
-- created_by with ON DELETE SET NULL, plus two new CHECK constraints) that
-- assume a fresh table. But chat_conversations was already created one
-- migration earlier by 20260803160000_gurukul_chat_mvp_features.sql without
-- those columns, so 20260803161000's own CREATE TABLE is a silent no-op and
-- its subsequent CREATE UNIQUE INDEX / CHECK-dependent statements fail
-- (column "dm_key" does not exist). Reconciling the real table to the shape
-- 20260803161000 assumes, here, so that file's remaining statements succeed
-- unmodified. No rows exist in chat_conversations at this point in the
-- sequence and nothing else in the repo references the old "name" column.
ALTER TABLE public.chat_conversations RENAME COLUMN name TO title;
ALTER TABLE public.chat_conversations ADD COLUMN IF NOT EXISTS dm_key text;
ALTER TABLE public.chat_conversations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE public.chat_conversations ALTER COLUMN created_by DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.chat_conversations DROP CONSTRAINT chat_conversations_created_by_fkey;
  ALTER TABLE public.chat_conversations
    ADD CONSTRAINT chat_conversations_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.chat_conversations DROP CONSTRAINT chat_conversations_kind_check;
  ALTER TABLE public.chat_conversations
    ADD CONSTRAINT chat_conversations_kind_check CHECK (kind IN ('dm', 'class_group', 'teacher_group'));
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.chat_conversations
    ADD CONSTRAINT chat_conversations_class_group_needs_class
    CHECK (kind <> 'class_group' OR class_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.chat_conversations
    ADD CONSTRAINT chat_conversations_dm_needs_key
    CHECK (kind <> 'dm' OR dm_key IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
