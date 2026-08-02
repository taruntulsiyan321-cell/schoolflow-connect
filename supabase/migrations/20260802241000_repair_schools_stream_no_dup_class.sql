-- Repair: apply stream/board without inserting duplicate classes.
-- Safe if 20260802240000 partially failed on classes unique constraint.

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS stream text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'schools_stream_check'
      AND conrelid = 'public.schools'::regclass
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_stream_check
      CHECK (
        stream IS NULL OR stream IN (
          'commerce', 'science', 'arts', 'agriculture', 'other'
        )
      );
  END IF;
END $$;

UPDATE public.schools
SET
  board = coalesce(nullif(trim(board), ''), 'rbse'),
  stream = coalesce(nullif(trim(stream), ''), 'commerce'),
  updated_at = now()
WHERE id = '00000000-0000-4000-8000-000000000001'
   OR lower(coalesce(slug, '')) = 'wisdom-campus'
   OR lower(coalesce(name, '')) LIKE '%wisdom campus%';

UPDATE public.classes c
SET
  category = coalesce(nullif(trim(c.category), ''), 'Commerce'),
  display_name = CASE
    WHEN c.display_name IS NULL OR trim(c.display_name) = '' OR c.display_name !~* 'commerce'
      THEN concat('Class ', coalesce(c.name, ''), coalesce('-' || nullif(c.section, ''), ''), ' Commerce')
    ELSE c.display_name
  END
WHERE c.school_id IN (
    SELECT id FROM public.schools
    WHERE id = '00000000-0000-4000-8000-000000000001'
       OR lower(coalesce(slug, '')) = 'wisdom-campus'
       OR lower(coalesce(name, '')) LIKE '%wisdom campus%'
  )
  AND (
    c.name ~ '^(11|12)$'
    OR c.name ~* 'class\s*11'
    OR c.name ~* 'class\s*12'
    OR c.display_name ~* '\b(11|12)\b'
  );

CREATE INDEX IF NOT EXISTS idx_schools_stream ON public.schools (stream)
  WHERE stream IS NOT NULL;

NOTIFY pgrst, 'reload schema';
