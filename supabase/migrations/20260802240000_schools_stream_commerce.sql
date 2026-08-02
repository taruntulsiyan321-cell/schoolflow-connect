-- ============================================================================
-- schools.stream + tag Wisdom Campus as RBSE Commerce
-- Enables Practice / Battleground to filter question_bank by stream.
-- ============================================================================

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

-- Wisdom Campus / default demo tenant → RBSE Commerce
UPDATE public.schools
SET
  board = coalesce(nullif(trim(board), ''), 'rbse'),
  stream = coalesce(nullif(trim(stream), ''), 'commerce'),
  updated_at = now()
WHERE id = '00000000-0000-4000-8000-000000000001'
   OR lower(coalesce(slug, '')) = 'wisdom-campus'
   OR lower(coalesce(name, '')) LIKE '%wisdom campus%';

-- Ensure Class 11 Commerce exists for demo (idempotent)
INSERT INTO public.classes (id, name, section, academic_year, kind, display_name, category, school_id)
VALUES (
  'c1000000-0011-4000-8000-0000000000a1',
  '11',
  'A',
  COALESCE(
    (SELECT academic_year FROM public.classes WHERE school_id = '00000000-0000-4000-8000-000000000001' LIMIT 1),
    to_char(now(), 'YYYY') || '-' || to_char(now() + interval '1 year', 'YYYY')
  ),
  'class',
  'Class 11-A Commerce',
  'Commerce',
  '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  section = EXCLUDED.section,
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  school_id = EXCLUDED.school_id;

CREATE INDEX IF NOT EXISTS idx_schools_stream ON public.schools (stream)
  WHERE stream IS NOT NULL;

NOTIFY pgrst, 'reload schema';
