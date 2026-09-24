-- ===========================================================================
-- VARIANT QUEUE: SECOND SOURCE FROM PRIVATE UPLOADS
--
-- Binding: docs/custom-practice-upload-spec.md §10.3
--
-- Measured: variant_generation_queue.source_question_id is a NOT NULL FK into
-- question_bank(id), so the existing variant pipeline cannot be fed by a
-- private student_upload_questions row. §10.3 asks for a second, nullable
-- source column pointing at student_upload_questions, with a CHECK that
-- exactly one of the two is set. Do not loosen the existing bank FK.
--
-- ROLLBACK: rollback/20261066000000_variant_queue_upload_source.rollback.sql
-- ===========================================================================

BEGIN;

-- ── 1. Make bank source nullable; add upload source FK ──────────────────────
ALTER TABLE public.variant_generation_queue
  ALTER COLUMN source_question_id DROP NOT NULL;

ALTER TABLE public.variant_generation_queue
  ADD COLUMN IF NOT EXISTS source_upload_question_id uuid
    REFERENCES public.student_upload_questions(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.variant_generation_queue.source_upload_question_id IS
  'Spec §10.3: private upload question that seeded this variant job. Exactly one of source_question_id / source_upload_question_id is set.';

-- Existing bank FK must still be present (do not loosen it).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'variant_generation_queue'
       AND c.contype = 'f'
       AND pg_get_constraintdef(c.oid) ILIKE '%source_question_id%question_bank%'
  ) THEN
    -- Recreate if a prior edit dropped it (should not happen).
    ALTER TABLE public.variant_generation_queue
      ADD CONSTRAINT variant_generation_queue_source_question_id_fkey
      FOREIGN KEY (source_question_id) REFERENCES public.question_bank(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 2. Exactly one source set ───────────────────────────────────────────────
ALTER TABLE public.variant_generation_queue
  DROP CONSTRAINT IF EXISTS variant_generation_queue_one_source;

ALTER TABLE public.variant_generation_queue
  ADD CONSTRAINT variant_generation_queue_one_source CHECK (
    num_nonnulls(source_question_id, source_upload_question_id) = 1
  );

-- ── 3. Pending uniqueness per source kind ───────────────────────────────────
-- Old index keyed only on source_question_id; NULLs would not collide under
-- UNIQUE, so two pending upload jobs at the same tier could stack. Split.
DROP INDEX IF EXISTS public.variant_generation_queue_pending_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS variant_generation_queue_pending_bank_uniq
  ON public.variant_generation_queue (source_question_id, tier)
  WHERE status = 'pending' AND source_question_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS variant_generation_queue_pending_upload_uniq
  ON public.variant_generation_queue (source_upload_question_id, tier)
  WHERE status = 'pending' AND source_upload_question_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS variant_generation_queue_upload_source_idx
  ON public.variant_generation_queue (source_upload_question_id)
  WHERE source_upload_question_id IS NOT NULL;

-- ── 4. VERIFY (must be able to fail) ────────────────────────────────────────
DO $prove$
DECLARE
  _col_nullable text;
  _check text;
  _bank_fk boolean;
  _upload_fk boolean;
  _qid uuid;
  _uqid uuid;
  _job uuid;
BEGIN
  SELECT is_nullable INTO _col_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'variant_generation_queue'
     AND column_name = 'source_question_id';
  IF _col_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'VERIFY FAILED: source_question_id is still NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'variant_generation_queue'
       AND column_name = 'source_upload_question_id'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: source_upload_question_id column missing';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO _check
    FROM pg_constraint
   WHERE conname = 'variant_generation_queue_one_source';
  IF _check IS NULL OR _check NOT ILIKE '%num_nonnulls%' THEN
    RAISE EXCEPTION 'VERIFY FAILED: one-source CHECK missing or wrong: %', _check;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'variant_generation_queue'
       AND c.contype = 'f'
       AND pg_get_constraintdef(c.oid) ILIKE '%source_question_id%'
       AND pg_get_constraintdef(c.oid) ILIKE '%question_bank%'
  ) INTO _bank_fk;
  IF NOT _bank_fk THEN
    RAISE EXCEPTION 'VERIFY FAILED: source_question_id FK to question_bank was loosened/dropped';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'variant_generation_queue'
       AND c.contype = 'f'
       AND pg_get_constraintdef(c.oid) ILIKE '%source_upload_question_id%'
       AND pg_get_constraintdef(c.oid) ILIKE '%student_upload_questions%'
  ) INTO _upload_fk;
  IF NOT _upload_fk THEN
    RAISE EXCEPTION 'VERIFY FAILED: source_upload_question_id FK to student_upload_questions missing';
  END IF;

  -- Positive controls against a real bank row and (if any) upload question.
  SELECT id INTO _qid FROM public.question_bank LIMIT 1;
  IF _qid IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: no question_bank row for positive control';
  END IF;

  -- Neither set → must fail.
  BEGIN
    INSERT INTO public.variant_generation_queue (
      source_question_id, source_upload_question_id, tier, status
    ) VALUES (NULL, NULL, 1, 'done');
    RAISE EXCEPTION 'VERIFY FAILED: CHECK allowed neither source set';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- Bank-only still works (existing path).
  INSERT INTO public.variant_generation_queue (source_question_id, tier, status)
  VALUES (_qid, 1, 'done')
  RETURNING id INTO _job;
  DELETE FROM public.variant_generation_queue WHERE id = _job;

  -- Upload-only + both-set need a real private question (FK).
  SELECT id INTO _uqid FROM public.student_upload_questions LIMIT 1;
  IF _uqid IS NOT NULL THEN
    INSERT INTO public.variant_generation_queue (
      source_upload_question_id, tier, status
    ) VALUES (_uqid, 1, 'done')
    RETURNING id INTO _job;
    DELETE FROM public.variant_generation_queue WHERE id = _job;

    -- Both set → must fail the CHECK (both FKs valid).
    BEGIN
      INSERT INTO public.variant_generation_queue (
        source_question_id, source_upload_question_id, tier, status
      ) VALUES (_qid, _uqid, 1, 'done');
      RAISE EXCEPTION 'VERIFY FAILED: CHECK allowed both sources set';
    EXCEPTION
      WHEN check_violation THEN NULL;
    END;
  ELSE
    RAISE NOTICE 'VERIFY: no student_upload_questions row yet — upload-only / both-set probes skipped';
  END IF;
END $prove$;

COMMIT;
