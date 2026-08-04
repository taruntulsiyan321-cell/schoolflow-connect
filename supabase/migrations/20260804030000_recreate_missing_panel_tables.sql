-- =============================================================================
-- Recreate school_calendar_events, learning_resources, approval_requests
--
-- Also discovered missing live on 2026-08-04 by probing the anon REST API for
-- every table this repo's migrations ever create. All three are defined in
-- 20260730010000_complete_panel_database.sql -- a migration that is PARTIALLY
-- live (other statements from the same file, e.g. schools.stream, are
-- confirmed present). This is not "one migration didn't run"; it's specific
-- statements within an applied migration that didn't land, consistent with
-- this repo's history of ad-hoc, hand-pasted SQL application rather than a
-- sequential migration runner.
--
-- Lower urgency than 20260804020000: neither table has a live client
-- consumer today (grep across src/ for resourceService, the only client code
-- touching learning_resources, shows it is exported from a barrel file but
-- never imported by any page or component; approval_requests and
-- school_calendar_events have no client references at all). Recreating them
-- now is precautionary -- closing a real gap before something gets built on
-- top of it -- not an active-incident fix.
--
-- Copied verbatim (tables + policies) from 20260730010000_complete_panel_database.sql.
-- Fully idempotent. Also recreates the two enum types these tables depend on
-- (calendar_event_type, resource_type), defined in the same source migration
-- and not independently confirmable live -- no other table references them,
-- so their presence can't be cross-checked the way a table can. Using this
-- codebase's own established idempotent pattern for optional type creation.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.calendar_event_type AS ENUM (
    'holiday', 'exam', 'meeting', 'sports', 'cultural', 'deadline', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.resource_type AS ENUM (
    'pdf', 'video', 'link', 'notes', 'worksheet', 'presentation', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.school_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  event_type public.calendar_event_type NOT NULL DEFAULT 'other',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  audience public.notice_audience NOT NULL DEFAULT 'all',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_calendar_events_school_starts_idx
  ON public.school_calendar_events (school_id, starts_at);
ALTER TABLE public.school_calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_select ON public.school_calendar_events;
CREATE POLICY calendar_select ON public.school_calendar_events FOR SELECT TO authenticated
  USING (public.same_school(school_id));
DROP POLICY IF EXISTS calendar_manage ON public.school_calendar_events;
CREATE POLICY calendar_manage ON public.school_calendar_events FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role))
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role))
  );

CREATE TABLE IF NOT EXISTS public.learning_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  subject text,
  title text NOT NULL,
  description text,
  resource_type public.resource_type NOT NULL DEFAULT 'link',
  url text,
  storage_path text,
  is_published boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_resources_school_idx ON public.learning_resources(school_id);
CREATE INDEX IF NOT EXISTS learning_resources_class_idx ON public.learning_resources(class_id);
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resources_select ON public.learning_resources;
CREATE POLICY resources_select ON public.learning_resources FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (is_published
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role))
  );
DROP POLICY IF EXISTS resources_manage ON public.learning_resources;
CREATE POLICY resources_manage ON public.learning_resources FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role))
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role))
  );

CREATE TABLE IF NOT EXISTS public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) DEFAULT public.default_school_id(),
  request_type text NOT NULL, -- leave | announcement | fee_waiver | other
  title text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  urgency text NOT NULL DEFAULT 'normal',
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  related_leave_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL,
  related_notice_id uuid REFERENCES public.notices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS approval_requests_school_status_idx
  ON public.approval_requests (school_id, status);
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approvals_select ON public.approval_requests;
CREATE POLICY approvals_select ON public.approval_requests FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      requested_by = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );
DROP POLICY IF EXISTS approvals_write ON public.approval_requests;
CREATE POLICY approvals_write ON public.approval_requests FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      requested_by = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (
      requested_by = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );
