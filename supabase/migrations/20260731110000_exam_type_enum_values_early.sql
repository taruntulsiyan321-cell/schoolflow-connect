-- Migration 20260731120000_teacher_academic_workspace.sql adds 7 exam_type enum
-- values and then, in the same file/transaction, updates rows to use one of
-- them ('annual'). PostgreSQL does not allow a newly added enum value to be
-- used in the same transaction that added it (unsafe use of new enum value),
-- so that later UPDATE can never succeed as originally written on a fresh
-- replay. Adding the enum values here, in their own earlier migration/
-- transaction, so they are already committed by the time 20260731120000 runs.
-- 20260731120000 itself is untouched: its own ADD VALUE IF NOT EXISTS /
-- EXCEPTION WHEN duplicate_object guards make it a safe no-op once these
-- values already exist.
DO $$ BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'monthly_test';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'mid_term';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'annual';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'practical';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'viva';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'internal';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'surprise_test';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
