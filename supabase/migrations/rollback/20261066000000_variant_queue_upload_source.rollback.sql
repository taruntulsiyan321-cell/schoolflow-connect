-- Rollback: 20261066000000_variant_queue_upload_source
--
-- Restores source_question_id NOT NULL and drops the upload source column.
-- Refuses if any pending/done row is upload-sourced (would lose provenance).

BEGIN;

DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM public.variant_generation_queue
   WHERE source_upload_question_id IS NOT NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION
      'rollback refused: % variant_generation_queue row(s) reference source_upload_question_id',
      _n;
  END IF;
END $$;

DROP INDEX IF EXISTS public.variant_generation_queue_pending_upload_uniq;
DROP INDEX IF EXISTS public.variant_generation_queue_upload_source_idx;

ALTER TABLE public.variant_generation_queue
  DROP CONSTRAINT IF EXISTS variant_generation_queue_one_source;

ALTER TABLE public.variant_generation_queue
  DROP COLUMN IF EXISTS source_upload_question_id;

-- Restore NOT NULL on the bank source and the original pending unique index.
ALTER TABLE public.variant_generation_queue
  ALTER COLUMN source_question_id SET NOT NULL;

DROP INDEX IF EXISTS public.variant_generation_queue_pending_bank_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS variant_generation_queue_pending_uniq
  ON public.variant_generation_queue (source_question_id, tier)
  WHERE status = 'pending';

COMMIT;
