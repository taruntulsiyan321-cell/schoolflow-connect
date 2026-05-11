ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'class',
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.classes ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.classes ALTER COLUMN section DROP NOT NULL;

ALTER TABLE public.classes
  ADD CONSTRAINT classes_kind_check CHECK (kind IN ('class','batch'));