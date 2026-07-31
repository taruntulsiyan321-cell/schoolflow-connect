-- Class-level exam groups: one logical exam per class, one exams row per subject.
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS exam_group_id uuid,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date;

CREATE INDEX IF NOT EXISTS exams_exam_group_id_idx ON public.exams (exam_group_id);
CREATE INDEX IF NOT EXISTS exams_class_group_idx ON public.exams (class_id, exam_group_id);

-- Backfill: each existing exam is its own group
UPDATE public.exams
SET exam_group_id = id
WHERE exam_group_id IS NULL;

COMMENT ON COLUMN public.exams.exam_group_id IS
  'Shared id for class-level exam; one row per subject under the same group';
