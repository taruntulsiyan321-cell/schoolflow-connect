-- =====================================================================
-- REVERSE OF: 20260825120000_chunk1_tenancy_and_identity.sql
--
-- Not picked up by `npm run db:migrate`: scripts/apply-pending-migrations.mjs
-- reads supabase/migrations/ non-recursively, so this subdirectory is skipped.
-- Run it deliberately, by hand, against the same project.
--
-- Restores has_role(), get_my_school_id() and default_school_id() to the exact
-- bodies read live from the database on 2026-08-25 before the chunk was
-- applied, then drops everything the chunk created.
-- =====================================================================

-- 1. Restore the three rewired predicates FIRST, so that dropping memberships
--    below can never leave a policy pointing at a table that is going away.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.same_school(_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _school_id IS NOT NULL
    AND _school_id = public.get_my_school_id()
$$;

CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT s.school_id
       FROM public.students s
      WHERE s.user_id = auth.uid()
        AND s.school_id IS NOT NULL
      LIMIT 1),
    (SELECT t.school_id
       FROM public.teachers t
      WHERE t.user_id = auth.uid()
        AND t.school_id IS NOT NULL
      LIMIT 1),
    (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
  );
$$;

-- Back to the hardcoded literal it was before the chunk. Restoring this
-- re-opens the G1 hole the chunk closed; that is what "reverse" means here.
--
-- CREATE OR REPLACE, never DROP: this function is the column DEFAULT for
-- school_id on 14 tables, so a DROP would fail on the dependency. REPLACE
-- restores the body, the IMMUTABLE volatility and the non-SECURITY-DEFINER
-- form in one statement, and leaves every default intact.
CREATE OR REPLACE FUNCTION public.default_school_id()
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;

-- Institution-table policies, as they were before the chunk.
DROP POLICY IF EXISTS schools_select_own   ON public.schools;
CREATE POLICY schools_select_own ON public.schools
  FOR SELECT
  USING (id = (SELECT profiles.school_id FROM public.profiles WHERE profiles.id = auth.uid()));

DROP POLICY IF EXISTS schools_admin_update ON public.schools;
CREATE POLICY schools_admin_update ON public.schools
  FOR UPDATE
  USING (
    id = (SELECT profiles.school_id FROM public.profiles WHERE profiles.id = auth.uid())
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role))
  );

-- Restore the direct user_roles read this policy had before the chunk.
DROP POLICY IF EXISTS "Admins can manage all submissions" ON public.homework_submissions;
CREATE POLICY "Admins can manage all submissions" ON public.homework_submissions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_roles.user_id = auth.uid()
         AND user_roles.role = ANY (ARRAY['admin'::public.app_role, 'principal'::public.app_role])
    )
    AND public.same_school(school_id)
  );

-- 2. Triggers and RPCs added by the chunk.

DROP TRIGGER IF EXISTS on_auth_user_created_account ON auth.users;
DROP FUNCTION IF EXISTS public.tg_auth_user_sync_account();

DROP FUNCTION IF EXISTS public.rpc_super_admin_open_access(uuid, text, text, int);
DROP FUNCTION IF EXISTS public.rpc_respond_to_invitation(uuid, boolean);
DROP FUNCTION IF EXISTS public.rpc_invite_member(public.identifier_type, text, public.app_role, uuid);
DROP FUNCTION IF EXISTS public.rpc_switch_membership(uuid);
DROP FUNCTION IF EXISTS public.rpc_start_session();

-- 3. Tables, in dependency order.

DROP TABLE IF EXISTS public.super_admin_access_log;
DROP TABLE IF EXISTS public.super_admins;
DROP TABLE IF EXISTS public.invitations;
DROP TABLE IF EXISTS public.sessions;

DROP TRIGGER IF EXISTS trg_memberships_validate_local_person ON public.memberships;
DROP FUNCTION IF EXISTS public.tg_memberships_validate_local_person();
DROP TABLE IF EXISTS public.memberships;

DROP TABLE IF EXISTS public.account_identifiers;
DROP TABLE IF EXISTS public.accounts;

-- 4. Resolvers (dropped after the tables they read).

DROP FUNCTION IF EXISTS public.super_admin_has_any_access();
DROP FUNCTION IF EXISTS public.super_admin_has_access(uuid);
DROP FUNCTION IF EXISTS public.is_super_admin();
DROP FUNCTION IF EXISTS public.active_membership_role();
DROP FUNCTION IF EXISTS public.active_membership_school_id();
DROP FUNCTION IF EXISTS public.active_membership_id();
DROP FUNCTION IF EXISTS public.current_auth_session_id();

-- 5. Institution columns added to public.schools.
--    Dropping these DISCARDS the per-institution session dates. Export them
--    first if the forward migration is to be re-applied with edits.

ALTER TABLE public.schools DROP CONSTRAINT IF EXISTS schools_suspended_at_check;
ALTER TABLE public.schools DROP CONSTRAINT IF EXISTS schools_session_window_check;
ALTER TABLE public.schools
  DROP COLUMN IF EXISTS suspended_at,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS session_end_date,
  DROP COLUMN IF EXISTS session_start_date;

-- 6. Enumerated types (last — every column using them is gone by now).

DROP TYPE IF EXISTS public.invitation_status;
DROP TYPE IF EXISTS public.identifier_type;
DROP TYPE IF EXISTS public.membership_status;
DROP TYPE IF EXISTS public.account_status;
DROP TYPE IF EXISTS public.institution_status;

-- 7. Ledger.
DELETE FROM public.schema_migrations
 WHERE version = '20260825120000_chunk1_tenancy_and_identity';
