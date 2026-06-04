-- Shared, DB-backed application settings (school identity + module toggles).
-- Singleton row enforced via a boolean primary key fixed to true.

CREATE TABLE IF NOT EXISTS public.app_settings (
  id              boolean PRIMARY KEY DEFAULT true,
  school_name     text    NOT NULL DEFAULT 'Vidyalaya Public School',
  locale          text    NOT NULL DEFAULT 'en-IN',
  currency        text    NOT NULL DEFAULT 'INR',
  enable_notices  boolean NOT NULL DEFAULT true,
  enable_fees     boolean NOT NULL DEFAULT true,
  enable_leaves   boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  CONSTRAINT app_settings_singleton CHECK (id)
);

-- Seed the single row.
INSERT INTO public.app_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can read settings (needed for branding/module gating).
DROP POLICY IF EXISTS "app settings read" ON public.app_settings;
CREATE POLICY "app settings read" ON public.app_settings
  FOR SELECT TO authenticated
  USING (true);

-- Only admins can change settings.
DROP POLICY IF EXISTS "app settings write" ON public.app_settings;
CREATE POLICY "app settings write" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
