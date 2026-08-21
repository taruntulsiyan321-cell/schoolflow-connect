-- ROOT CAUSE FIX (schema-level, not an RLS patch): app_settings was designed
-- as a global singleton -- `id boolean PRIMARY KEY CHECK (id)` means the
-- ENTIRE APPLICATION can only ever hold exactly one row, no matter how many
-- schools exist. But its columns (school_name, currency, locale,
-- enable_fees/enable_leaves/enable_notices) are genuinely PER-SCHOOL
-- configuration -- confirmed via school_id being present (added like every
-- other table in the Aug-2026 backfill) and via the FK to public.schools.
--
-- Confirmed via the sole consumer (src/pages/shared/SchoolFeatures.tsx,
-- fixed alongside this migration): read was `.eq("id", true).maybeSingle()`,
-- write was `.upsert({id: true, ...})` -- both completely oblivious to
-- school_id. With exactly one school in the database today this hasn't
-- visibly broken anything, but the moment a second school onboards, any
-- admin saving "their" settings silently overwrites every other school's
-- settings in the same single row -- a genuine "different panels
-- maintaining competing versions of the same information" /
-- "records overwritten incorrectly" bug, not just a missing-RLS-scope one.
-- The RLS-only sweep that found the "app settings write" gap would have
-- masked this: adding same_school() to a table with one permanent
-- id=true row does nothing, since same_school() only matters once rows
-- are actually keyed per school.
--
-- Fix: re-key the table by school_id instead of the boolean singleton.
-- Existing data preserved (single UPDATE-free re-key, no data loss).

ALTER TABLE public.app_settings DROP CONSTRAINT app_settings_singleton;
ALTER TABLE public.app_settings DROP CONSTRAINT app_settings_pkey;
ALTER TABLE public.app_settings ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.app_settings ADD PRIMARY KEY (school_id);
-- Safe to drop: confirmed via repo-wide grep this column has exactly one
-- consumer (SchoolFeatures.tsx), updated in the same change as this
-- migration, and nothing else in the schema references it as a FK target.
ALTER TABLE public.app_settings DROP COLUMN id;

DROP POLICY IF EXISTS "app settings read" ON public.app_settings;
CREATE POLICY "app settings read" ON public.app_settings FOR SELECT TO authenticated
  USING (public.same_school(school_id));

DROP POLICY IF EXISTS "app settings write" ON public.app_settings;
CREATE POLICY "app settings write" ON public.app_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND public.same_school(school_id));

CREATE TRIGGER trg_app_settings_set_school
  BEFORE INSERT ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();
