-- §7.1 / §8 — questions written FROM notes must be distinguishable from
-- questions extracted FROM the file. practise_from_notes filters on this;
-- without it, that mode silently behaved like practise_all on mixed uploads.
--
-- NULL = extracted from the upload (or legacy). Non-null = generated from
-- that note row. ON DELETE SET NULL keeps the question if the note is removed.

ALTER TABLE public.student_upload_questions
  ADD COLUMN IF NOT EXISTS derived_from_note_id uuid
    REFERENCES public.student_upload_notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS student_upload_questions_from_note_idx
  ON public.student_upload_questions (owner_id, upload_id)
  WHERE derived_from_note_id IS NOT NULL;

COMMENT ON COLUMN public.student_upload_questions.derived_from_note_id IS
  '§7.1: note this question was written from. NULL = file-extracted / unset. practise_from_notes requires non-null.';

-- Verify: column present and FK targets student_upload_notes.
DO $$
DECLARE
  _att regtype;
  _fk  text;
BEGIN
  SELECT a.atttypid::regtype INTO _att
  FROM pg_attribute a
  WHERE a.attrelid = 'public.student_upload_questions'::regclass
    AND a.attname = 'derived_from_note_id'
    AND NOT a.attisdropped;
  IF _att IS DISTINCT FROM 'uuid'::regtype THEN
    RAISE EXCEPTION 'VERIFY FAILED: derived_from_note_id missing or not uuid';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO _fk
  FROM pg_constraint c
  WHERE c.conrelid = 'public.student_upload_questions'::regclass
    AND c.contype = 'f'
    AND pg_get_constraintdef(c.oid) ILIKE '%derived_from_note_id%'
    AND pg_get_constraintdef(c.oid) ILIKE '%student_upload_notes%'
  LIMIT 1;
  IF _fk IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: derived_from_note_id FK to student_upload_notes missing';
  END IF;
END $$;
