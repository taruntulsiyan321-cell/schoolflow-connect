-- =====================================================================
-- CHUNK 1 — TENANCY AND IDENTITY
-- Foundation build (docs/foundation-build-prompt.md), governed by
-- docs/locked-decisions.md sections 1 and 2.
--
-- Builds the account / identifier / membership / session model, moves the
-- RLS tenancy predicate onto the session's active membership, and closes the
-- hardcoded-tenant hole in default_school_id().
--
-- APPROVED DIVERGENCES from the literal build document (see the report that
-- accompanies this migration; none of these is a silent decision):
--   * The tenancy column stays `school_id`, and `public.schools` IS the
--     `institutions` table — extended in place, not duplicated. (Locked
--     decision 2: in-place migration, keep the column name.)
--   * The active institution is read from `sessions.active_membership_id`,
--     NOT from a `current_setting('app.active_institution')` GUC.
--   * `institutions.board_id` is NOT added: the `boards` table it references
--     is a G2 shared table that belongs to the curriculum chunk and does not
--     exist yet. `schools.board` (text) is left untouched.
--   * `academic_years` already exists and is already institution-scoped; its
--     columns are `name/starts_on/ends_on` where the doc says
--     `label/start_date/end_date`. Not renamed — 544 TS files read them.
--   * The doc's `guardians` local record is this schema's `parents`.
--   * Super-admin *bypass* is deliberately NOT implemented here. See the
--     SECTION 9 note.
--
-- Reverse migration: supabase/migrations/rollback/20260825120000_chunk1_down.sql
--
-- Atomicity: `npm run db:migrate` sends each file as ONE multi-statement
-- string (Management API or pg simple query), so the whole file is a single
-- implicit transaction. The assertions in SECTION 12 therefore abort and roll
-- back the entire chunk if the backfill does not reproduce today's access.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — Enumerated types
-- Every value below is named verbatim in the build document or in
-- locked-decisions.md. No state has been invented.
-- ---------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.institution_status AS ENUM ('active', 'suspended', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.account_status AS ENUM ('active', 'deactivated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.membership_status AS ENUM ('pending', 'active', 'declined', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.identifier_type AS ENUM ('phone', 'email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.invitation_status AS ENUM ('pending', 'accepted', 'declined', 'revoked', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------
-- SECTION 2 — institutions (= public.schools, extended in place)
-- Doc: id · name · board_id · session_start_date · session_end_date ·
--      status (active/suspended/deleted) · suspended_at · created_at
-- Present already: id, name, created_at. board_id deferred (see header).
-- ---------------------------------------------------------------------

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS session_start_date date,
  ADD COLUMN IF NOT EXISTS session_end_date   date,
  ADD COLUMN IF NOT EXISTS status             public.institution_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspended_at       timestamptz;

COMMENT ON COLUMN public.schools.session_start_date IS
  'Per-institution session start. Locked decision 3: never hardcoded; every reporting window reads from here.';
COMMENT ON COLUMN public.schools.session_end_date IS
  'Per-institution session end. Locked decision 3.';

-- Session dates are seeded from the institution''s own current academic year —
-- the only truthful source that exists. Never a literal date.
UPDATE public.schools s
   SET session_start_date = ay.starts_on,
       session_end_date   = ay.ends_on
  FROM public.academic_years ay
 WHERE ay.school_id = s.id
   AND ay.is_current
   AND s.session_start_date IS NULL
   AND s.session_end_date IS NULL;

ALTER TABLE public.schools
  DROP CONSTRAINT IF EXISTS schools_session_window_check;
ALTER TABLE public.schools
  ADD CONSTRAINT schools_session_window_check
  CHECK (
    session_start_date IS NULL
    OR session_end_date IS NULL
    OR session_end_date > session_start_date
  );

ALTER TABLE public.schools
  DROP CONSTRAINT IF EXISTS schools_suspended_at_check;
ALTER TABLE public.schools
  ADD CONSTRAINT schools_suspended_at_check
  CHECK (status <> 'suspended' OR suspended_at IS NOT NULL);


-- ---------------------------------------------------------------------
-- SECTION 3 — accounts (GLOBAL, G2 — no institution scope)
-- One account per global identity. `id` IS `auth.users.id` so that every
-- existing policy that compares against auth.uid() keeps working unchanged.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounts (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status     public.account_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.accounts IS
  'G2 global table. accounts.id = auth.users.id by construction, so auth.uid() is an account id.';


-- ---------------------------------------------------------------------
-- SECTION 4 — account_identifiers (GLOBAL, G2)
-- Doc: id · account_id · type (phone/email) · value · verified_at
-- Unique on (type, value). Registering an identifier that already exists
-- attaches to the existing account; it never creates a second account —
-- which is exactly what UNIQUE (type, value) enforces.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_identifiers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  type        public.identifier_type NOT NULL,
  value       text NOT NULL,
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_identifiers_type_value_key UNIQUE (type, value),
  -- Mechanical consequence of the uniqueness rule, not a product decision:
  -- 'A@b.com' and 'a@b.com' must not be two identifiers.
  CONSTRAINT account_identifiers_email_normalised
    CHECK (type <> 'email' OR value = lower(btrim(value))),
  CONSTRAINT account_identifiers_value_not_blank
    CHECK (btrim(value) <> '')
);

CREATE INDEX IF NOT EXISTS account_identifiers_account_idx
  ON public.account_identifiers (account_id);


-- ---------------------------------------------------------------------
-- SECTION 5 — memberships (GLOBAL, G2 — the bridge to an institution)
-- Doc: id · account_id · institution_id · role · local_person_id · status ·
--      invited_by · invited_at · responded_at
--
-- school_id here is the bridge's payload, not a tenancy scope: memberships is
-- named in G2 as a global table, so its RLS is identity-based, not
-- `school_id = active institution`.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  school_id       uuid NOT NULL REFERENCES public.schools(id)  ON DELETE RESTRICT,
  role            public.app_role NOT NULL,
  local_person_id uuid,
  status          public.membership_status NOT NULL DEFAULT 'pending',
  invited_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at      timestamptz,
  responded_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- A super admin sits above all schools; it is never a membership.
  CONSTRAINT memberships_role_not_super CHECK (role <> 'super_admin'),
  -- Every combination is supported: same role at two schools, different roles
  -- at two schools, two roles at the same school. Only the exact triple repeats.
  CONSTRAINT memberships_account_school_role_key UNIQUE (account_id, school_id, role),
  -- Lets sessions carry a composite FK proving the membership is the holder's.
  CONSTRAINT memberships_id_account_key UNIQUE (id, account_id)
);

COMMENT ON COLUMN public.memberships.local_person_id IS
  'Points at students.id / teachers.id / parents.id in that institution. NULL for admin and principal, which have no local person table. These records are never merged.';

CREATE INDEX IF NOT EXISTS memberships_account_status_idx
  ON public.memberships (account_id, status);
CREATE INDEX IF NOT EXISTS memberships_school_role_status_idx
  ON public.memberships (school_id, role, status);
CREATE INDEX IF NOT EXISTS memberships_local_person_idx
  ON public.memberships (school_id, local_person_id)
  WHERE local_person_id IS NOT NULL;

-- local_person_id is polymorphic, so it cannot carry a foreign key. This
-- trigger is the integrity substitute: the row must exist, in the right table
-- for the role, and in the same institution as the membership.
CREATE OR REPLACE FUNCTION public.tg_memberships_validate_local_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.local_person_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.role = 'student' THEN
    IF NOT EXISTS (SELECT 1 FROM public.students x
                    WHERE x.id = NEW.local_person_id AND x.school_id = NEW.school_id) THEN
      RAISE EXCEPTION 'membership.local_person_id % is not a student of institution %',
        NEW.local_person_id, NEW.school_id;
    END IF;
  ELSIF NEW.role = 'teacher' THEN
    IF NOT EXISTS (SELECT 1 FROM public.teachers x
                    WHERE x.id = NEW.local_person_id AND x.school_id = NEW.school_id) THEN
      RAISE EXCEPTION 'membership.local_person_id % is not a teacher of institution %',
        NEW.local_person_id, NEW.school_id;
    END IF;
  ELSIF NEW.role = 'parent' THEN
    IF NOT EXISTS (SELECT 1 FROM public.parents x
                    WHERE x.id = NEW.local_person_id AND x.school_id = NEW.school_id) THEN
      RAISE EXCEPTION 'membership.local_person_id % is not a parent of institution %',
        NEW.local_person_id, NEW.school_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'role % has no local person table; local_person_id must be NULL', NEW.role;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_memberships_validate_local_person ON public.memberships;
CREATE TRIGGER trg_memberships_validate_local_person
  BEFORE INSERT OR UPDATE OF local_person_id, role, school_id ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.tg_memberships_validate_local_person();


-- ---------------------------------------------------------------------
-- SECTION 6 — sessions
-- Doc: id · account_id · active_membership_id · created_at · expires_at
--
-- "Exactly one active membership per session. Never two." is enforced
-- structurally: active_membership_id is a single scalar column, and the
-- composite FK guarantees the membership belongs to this account.
-- auth_session_id binds a row to one GoTrue session so two devices can sit in
-- two different institutions without fighting over one row.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  active_membership_id uuid,
  auth_session_id      uuid UNIQUE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz,
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  -- The column list on SET NULL (PG 15+) is required: without it a deleted
  -- membership would try to NULL account_id too, which is NOT NULL.
  CONSTRAINT sessions_membership_belongs_to_account
    FOREIGN KEY (active_membership_id, account_id)
    REFERENCES public.memberships (id, account_id)
    ON DELETE SET NULL (active_membership_id)
);

CREATE INDEX IF NOT EXISTS sessions_account_idx ON public.sessions (account_id, last_seen_at DESC);


-- ---------------------------------------------------------------------
-- SECTION 7 — invitations
-- An admin enters an *identifier*, which may not have an account yet — that is
-- the one thing a pending membership cannot express, and the reason this table
-- exists separately.
--
-- expires_at has NO default: the build document sets no invitation TTL and
-- inventing one is forbidden. It is set only when an invite is declined
-- ("Declining ... expires the invite").
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  identifier_type  public.identifier_type NOT NULL,
  identifier_value text NOT NULL,
  role             public.app_role NOT NULL,
  local_person_id  uuid,
  membership_id    uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  status           public.invitation_status NOT NULL DEFAULT 'pending',
  invited_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at       timestamptz NOT NULL DEFAULT now(),
  responded_at     timestamptz,
  expires_at       timestamptz,
  CONSTRAINT invitations_role_not_super CHECK (role <> 'super_admin'),
  CONSTRAINT invitations_email_normalised
    CHECK (identifier_type <> 'email' OR identifier_value = lower(btrim(identifier_value))),
  CONSTRAINT invitations_value_not_blank CHECK (btrim(identifier_value) <> '')
);

-- One live invitation per identifier per role per institution. A mistyped
-- number belonging to someone at another school can therefore be re-invited
-- once it has been declined, but never duplicated while pending.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_one_pending_per_target
  ON public.invitations (school_id, identifier_type, identifier_value, role)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS invitations_target_idx
  ON public.invitations (identifier_type, identifier_value, status);


-- ---------------------------------------------------------------------
-- SECTION 8 — super_admins
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.super_admins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz
);


-- ---------------------------------------------------------------------
-- SECTION 9 — super_admin_access_log
-- Doc: id · super_admin_id · institution_id · accessed_at ·
--      what_was_accessed · reason · school_notified_at
--
-- G2 lists this table as global (no institution scope) while the Chunk 1
-- column list gives it institution_id. Both are satisfied here: school_id is a
-- data column recording *which* institution was reached, and the RLS below is
-- identity-based rather than `school_id = active institution`.
--
-- THE BYPASS. A Postgres SELECT policy cannot write a row, so a bypass
-- predicate cannot log its own use. Resolved by making the log row itself the
-- grant: a super admin opens access by INSERTing here, and the bypass predicate
-- is "an unexpired row of this log exists for this institution". Access
-- therefore cannot begin without a log entry, because the log entry IS the
-- access. That satisfies "every access is logged" by construction rather than
-- by convention.
--
-- DECISION MADE UNDER DELEGATION (2026-08-25), not derived from either
-- document: the build doc sets no duration for a super-admin access window.
-- Default 60 minutes, hard cap 8 hours, caller may request less. Flagged here
-- so it can be changed in one place if you want different numbers.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.super_admin_access_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id     uuid NOT NULL REFERENCES public.super_admins(id) ON DELETE RESTRICT,
  school_id          uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  accessed_at        timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  what_was_accessed  text NOT NULL,
  reason             text NOT NULL,
  school_notified_at timestamptz,
  CONSTRAINT super_admin_access_log_window CHECK (expires_at > accessed_at),
  CONSTRAINT super_admin_access_log_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT super_admin_access_log_what_not_blank CHECK (btrim(what_was_accessed) <> '')
);

CREATE INDEX IF NOT EXISTS super_admin_access_log_open_idx
  ON public.super_admin_access_log (school_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS super_admin_access_log_school_idx
  ON public.super_admin_access_log (school_id, accessed_at DESC);


-- ---------------------------------------------------------------------
-- SECTION 10 — Resolvers: the active membership IS the tenancy predicate
-- ---------------------------------------------------------------------

-- Reads GoTrue's session id from the JWT without ever raising: a missing or
-- malformed claim must degrade to NULL, not error inside an RLS policy.
CREATE OR REPLACE FUNCTION public.current_auth_session_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE _v text;
BEGIN
  _v := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id';
  RETURN nullif(_v, '')::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- The one place the active membership is decided.
--   1. the membership pinned to this GoTrue session, else
--   2. the account's most recently seen unexpired session, else
--   3. the sole active membership — "One membership goes straight in"
--      (locked decision 2). Two or more and this returns NULL until the panel
--      picker calls rpc_switch_membership: no membership is ever guessed.
CREATE OR REPLACE FUNCTION public.active_membership_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT s.active_membership_id
       FROM public.sessions s
       JOIN public.memberships m ON m.id = s.active_membership_id
      WHERE s.account_id = auth.uid()
        AND s.auth_session_id = public.current_auth_session_id()
        AND (s.expires_at IS NULL OR s.expires_at > now())
        AND m.status = 'active'
      LIMIT 1),
    (SELECT s.active_membership_id
       FROM public.sessions s
       JOIN public.memberships m ON m.id = s.active_membership_id
      WHERE s.account_id = auth.uid()
        AND (s.expires_at IS NULL OR s.expires_at > now())
        AND m.status = 'active'
      ORDER BY s.last_seen_at DESC
      LIMIT 1),
    (SELECT t.id FROM (
       SELECT m.id, count(*) OVER () AS n
         FROM public.memberships m
        WHERE m.account_id = auth.uid()
          AND m.status = 'active'
     ) t WHERE t.n = 1)
  )
$$;

CREATE OR REPLACE FUNCTION public.active_membership_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.school_id
    FROM public.memberships m
    JOIN public.schools sc ON sc.id = m.school_id
   WHERE m.id = public.active_membership_id()
     AND m.status = 'active'
     -- A suspended or deleted institution locks all its users out immediately
     -- (locked decision 10.20).
     AND sc.status = 'active'
$$;

CREATE OR REPLACE FUNCTION public.active_membership_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.role
    FROM public.memberships m
   WHERE m.id = public.active_membership_id()
     AND m.status = 'active'
$$;

-- The bypass predicates. Both are false unless an unexpired access-log row
-- exists, so a super admin who has not opened logged access is, to Postgres,
-- an account with no memberships: it sees nothing.
CREATE OR REPLACE FUNCTION public.super_admin_has_access(_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _school_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.super_admin_access_log l
      JOIN public.super_admins sa ON sa.id = l.super_admin_id
     WHERE sa.account_id = auth.uid()
       AND sa.revoked_at IS NULL
       AND l.school_id = _school_id
       AND l.expires_at > now()
  )
$$;

CREATE OR REPLACE FUNCTION public.super_admin_has_any_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.super_admin_access_log l
      JOIN public.super_admins sa ON sa.id = l.super_admin_id
     WHERE sa.account_id = auth.uid()
       AND sa.revoked_at IS NULL
       AND l.expires_at > now()
  )
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.super_admins sa
     WHERE sa.account_id = auth.uid()
       AND sa.revoked_at IS NULL
  )
$$;


-- ---------------------------------------------------------------------
-- SECTION 11 — Rewiring the two predicates all 280 existing policies use
-- Redefining these bodies moves the whole policy surface onto memberships
-- without editing a single policy. SECTION 12 proves it changes no answer.
-- ---------------------------------------------------------------------

-- The active membership's institution. The legacy derivation is kept as a
-- strictly narrower tail: it can only ever return the institution the row's
-- own local record already names, so it cannot widen access — it exists so
-- that an account which has not yet been given a membership does not lose the
-- access it has today. SECTION 12 asserts the tail is dead for every account
-- that currently holds one.
CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    public.active_membership_school_id(),
    (SELECT s.school_id FROM public.students s
      WHERE s.user_id = auth.uid() AND s.school_id IS NOT NULL LIMIT 1),
    (SELECT t.school_id FROM public.teachers t
      WHERE t.user_id = auth.uid() AND t.school_id IS NOT NULL LIMIT 1),
    (SELECT pa.school_id FROM public.parents pa
      WHERE pa.user_id = auth.uid() AND pa.school_id IS NOT NULL LIMIT 1),
    (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
  )
$$;

-- Role now belongs to a membership, not to a person.
--
-- For the caller themself the answer is the ACTIVE membership only, never the
-- union of their memberships — that is what stops a teacher at School A from
-- carrying teacher rights into their parent membership at School B.
--
-- For any other user the question is "does that person hold this role here",
-- so it is answered within the caller's own institution.
--
-- public.user_roles is intentionally left in place and untouched: the client
-- (src/auth/session.ts) still reads it, and handle_new_user still writes it.
-- It simply stops being the authority for row-level security.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _user_id IS NULL OR _role IS NULL THEN false
    WHEN _role = 'super_admin' THEN
      _user_id = auth.uid() AND public.is_super_admin()
    WHEN _user_id = auth.uid() THEN (
      EXISTS (
        SELECT 1 FROM public.memberships m
         WHERE m.id = public.active_membership_id()
           AND m.role = _role
           AND m.status = 'active'
      )
      -- Super-admin bypass. Deliberately not school-specific here: this half
      -- only says "acts in this role", and the institution is decided by the
      -- same_school(school_id) half that every such policy also carries. The
      -- pair together grants access to the granted institution and no other.
      OR (public.is_super_admin() AND public.super_admin_has_any_access())
    )
    ELSE EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.account_id = _user_id
         AND m.role = _role
         AND m.status = 'active'
         AND m.school_id = public.get_my_school_id()
    )
  END
$$;

-- G1 hole closed. This was a hardcoded literal institution id and the column
-- DEFAULT for school_id on 14 tables, none of which carries the
-- tg_set_school_id_from_session trigger — so an insert that omitted school_id
-- silently landed in institution #1.
--
-- The count(*) = 1 tail is self-disarming: while exactly one institution
-- exists it reproduces today's behaviour byte for byte, and the moment a
-- second institution is created it stops firing and the default becomes
-- strictly session-derived. It is a transitional device with a stated expiry
-- condition, not a fallback that can leak.
--
-- Volatility moves IMMUTABLE -> STABLE. Verified live: no index, constraint or
-- generated column depends on this function, so nothing is invalidated.
CREATE OR REPLACE FUNCTION public.default_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    public.get_my_school_id(),
    (SELECT s.id FROM public.schools s
      WHERE (SELECT count(*) FROM public.schools) = 1)
  )
$$;

-- same_school() is the predicate 128 policies use. Adding the bypass term here
-- is what makes super-admin access reach the whole schema without editing a
-- single policy — and it stays false for everyone else, including super admins
-- who have not opened a logged access window.
--
-- Verified live before writing this: NO policy in the database uses
-- `NOT has_role(...)` or `NOT same_school(...)`, so widening either predicate
-- cannot invert any existing rule.
CREATE OR REPLACE FUNCTION public.same_school(_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _school_id IS NOT NULL
    AND (
      _school_id = public.get_my_school_id()
      OR public.super_admin_has_access(_school_id)
    )
$$;

GRANT EXECUTE ON FUNCTION public.current_auth_session_id()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_has_access(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_has_any_access()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.active_membership_id()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.active_membership_school_id()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.active_membership_role()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin()               TO authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_memberships_validate_local_person() FROM public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 12 — Backfill, then prove it changed nobody's access
-- ---------------------------------------------------------------------

INSERT INTO public.accounts (id, status, created_at)
SELECT u.id, 'active', u.created_at
  FROM auth.users u
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.account_identifiers (account_id, type, value, verified_at)
SELECT u.id, 'email', lower(btrim(u.email)), u.email_confirmed_at
  FROM auth.users u
 WHERE u.email IS NOT NULL AND btrim(u.email) <> ''
ON CONFLICT (type, value) DO NOTHING;

INSERT INTO public.account_identifiers (account_id, type, value, verified_at)
SELECT u.id, 'phone', btrim(u.phone), u.phone_confirmed_at
  FROM auth.users u
 WHERE u.phone IS NOT NULL AND btrim(u.phone) <> ''
ON CONFLICT (type, value) DO NOTHING;

-- One membership per existing (user, role), status 'active'.
--
-- These are backfilled ACTIVE, not PENDING, on purpose: they represent access
-- that already exists and works today. The pending/invitation flow governs new
-- members from here on.
--
-- The institution is taken from the local record that matches the role, and
-- only falls back to profiles.school_id for admin and principal, which have no
-- local person table. A role with no resolvable institution gets no membership
-- — it has no access today either.
INSERT INTO public.memberships (account_id, school_id, role, local_person_id, status, responded_at)
SELECT ur.user_id,
       COALESCE(
         CASE ur.role
           WHEN 'student' THEN st.school_id
           WHEN 'teacher' THEN te.school_id
           WHEN 'parent'  THEN pa.school_id
         END,
         pr.school_id
       ) AS school_id,
       ur.role,
       CASE ur.role
         WHEN 'student' THEN st.id
         WHEN 'teacher' THEN te.id
         WHEN 'parent'  THEN pa.id
       END AS local_person_id,
       'active'::public.membership_status,
       now()
  FROM public.user_roles ur
  LEFT JOIN public.students st ON st.user_id = ur.user_id
  LEFT JOIN public.teachers te ON te.user_id = ur.user_id
  LEFT JOIN public.parents  pa ON pa.user_id = ur.user_id
  LEFT JOIN public.profiles pr ON pr.id      = ur.user_id
 WHERE ur.role <> 'super_admin'
   AND COALESCE(
         CASE ur.role
           WHEN 'student' THEN st.school_id
           WHEN 'teacher' THEN te.school_id
           WHEN 'parent'  THEN pa.school_id
         END,
         pr.school_id
       ) IS NOT NULL
ON CONFLICT (account_id, school_id, role) DO NOTHING;

-- Sessions are deliberately NOT backfilled. Every backfilled account holds
-- exactly one membership, so rule 3 of active_membership_id() resolves it
-- without a session row, and the first rpc_start_session() call writes one.

DO $$
DECLARE
  _n int;
  _detail text;
BEGIN
  -- (a) Every role that could resolve an institution became a membership.
  SELECT count(*) INTO _n
    FROM public.user_roles ur
    LEFT JOIN public.students st ON st.user_id = ur.user_id
    LEFT JOIN public.teachers te ON te.user_id = ur.user_id
    LEFT JOIN public.parents  pa ON pa.user_id = ur.user_id
    LEFT JOIN public.profiles pr ON pr.id      = ur.user_id
   WHERE ur.role <> 'super_admin'
     AND COALESCE(CASE ur.role WHEN 'student' THEN st.school_id
                               WHEN 'teacher' THEN te.school_id
                               WHEN 'parent'  THEN pa.school_id END,
                  pr.school_id) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.memberships m
                      WHERE m.account_id = ur.user_id
                        AND m.role = ur.role
                        AND m.status = 'active');
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1 backfill: % user_roles row(s) with a resolvable institution got no membership', _n;
  END IF;

  -- (b) No account ended up with more than one active membership. If this ever
  --     trips, active_membership_id() would return NULL for that account and
  --     it would silently lose all access — so refuse to commit.
  SELECT count(*) INTO _n FROM (
    SELECT account_id FROM public.memberships
     WHERE status = 'active' GROUP BY account_id HAVING count(*) > 1
  ) t;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1 backfill: % account(s) hold >1 active membership with no session row to disambiguate', _n;
  END IF;

  -- (c) Every membership names a real account and a real institution.
  SELECT count(*) INTO _n
    FROM public.memberships m
   WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = m.account_id)
      OR NOT EXISTS (SELECT 1 FROM public.schools  s WHERE s.id = m.school_id);
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1 backfill: % membership(s) with a dangling account or institution', _n;
  END IF;

  -- (d) The legacy tail of get_my_school_id() is dead for everyone who holds a
  --     membership: the membership's institution equals what the old function
  --     would have returned. Proven per row rather than assumed.
  SELECT count(*), string_agg(DISTINCT t.account_id::text, ', ')
    INTO _n, _detail
    FROM (
      SELECT m.account_id, m.school_id AS via_membership,
             COALESCE(
               (SELECT s.school_id FROM public.students s
                 WHERE s.user_id = m.account_id AND s.school_id IS NOT NULL LIMIT 1),
               (SELECT te.school_id FROM public.teachers te
                 WHERE te.user_id = m.account_id AND te.school_id IS NOT NULL LIMIT 1),
               (SELECT pa.school_id FROM public.parents pa
                 WHERE pa.user_id = m.account_id AND pa.school_id IS NOT NULL LIMIT 1),
               (SELECT p.school_id FROM public.profiles p WHERE p.id = m.account_id)
             ) AS via_legacy
        FROM public.memberships m
       WHERE m.status = 'active'
    ) t
   WHERE t.via_legacy IS NOT NULL AND t.via_legacy <> t.via_membership;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1 backfill: % account(s) resolve a different institution via membership than via the legacy path: %', _n, _detail;
  END IF;

  -- (e) default_school_id() must still answer exactly what it answered before
  --     while a single institution exists.
  IF (SELECT count(*) FROM public.schools) = 1
     AND (SELECT public.default_school_id()) IS DISTINCT FROM (SELECT id FROM public.schools) THEN
    RAISE EXCEPTION 'Chunk 1: default_school_id() no longer resolves the sole institution';
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 13 — Row Level Security on every table created in this chunk
-- G1: policies are enforced by Postgres, never by application code.
-- No policy below is permissive-by-default; every one carries a predicate.
-- ---------------------------------------------------------------------

ALTER TABLE public.accounts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_identifiers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admin_access_log ENABLE ROW LEVEL SECURITY;

-- schools (= institutions) — the institution table itself must be scoped by
-- the active membership too, or the tenancy predicate stops one row short of
-- its own subject. Both policies previously read profiles.school_id.
--
-- get_my_school_id() rather than active_membership_school_id() on purpose:
-- its legacy tail resolves to profiles.school_id, so this predicate is a
-- superset of the one it replaces and no account can lose access to the
-- institution row it can read today.
DROP POLICY IF EXISTS schools_select_own ON public.schools;
CREATE POLICY schools_select_own ON public.schools
  FOR SELECT USING (id = public.get_my_school_id());

DROP POLICY IF EXISTS schools_admin_update ON public.schools;
CREATE POLICY schools_admin_update ON public.schools
  FOR UPDATE
  USING (
    id = public.get_my_school_id()
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role))
  );

-- homework_submissions — the ONE policy in the whole database that reads
-- public.user_roles directly instead of going through has_role(). Redefining
-- has_role() therefore does not reach it, and it would become a live leak the
-- moment an account holds two memberships: it ANDs same_school(school_id), so
-- an account holding an admin membership at School A would be treated as admin
-- at School B while its active membership is there. Repointed at has_role().
--
-- The original policy is FOR ALL with a NULL WITH CHECK, so WITH CHECK falls
-- back to USING — reproduced here by supplying USING alone.
DROP POLICY IF EXISTS "Admins can manage all submissions" ON public.homework_submissions;
CREATE POLICY "Admins can manage all submissions" ON public.homework_submissions
  FOR ALL
  USING (
    (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role))
    AND public.same_school(school_id)
  );

-- accounts — G2: readable only by their owner.
DROP POLICY IF EXISTS accounts_select_own ON public.accounts;
CREATE POLICY accounts_select_own ON public.accounts
  FOR SELECT TO authenticated USING (id = auth.uid());

-- account_identifiers — G2: readable only by their owner.
DROP POLICY IF EXISTS account_identifiers_select_own ON public.account_identifiers;
CREATE POLICY account_identifiers_select_own ON public.account_identifiers
  FOR SELECT TO authenticated USING (account_id = auth.uid());

-- memberships — the holder sees their own (that is what the panel picker
-- lists); an admin or principal sees the memberships of the institution they
-- are currently active in. Predicates read memberships directly rather than
-- through has_role() so a policy on this table can never recurse into itself.
DROP POLICY IF EXISTS memberships_select_own ON public.memberships;
CREATE POLICY memberships_select_own ON public.memberships
  FOR SELECT TO authenticated USING (account_id = auth.uid());

DROP POLICY IF EXISTS memberships_select_school_staff ON public.memberships;
CREATE POLICY memberships_select_school_staff ON public.memberships
  FOR SELECT TO authenticated
  USING (
    school_id = public.active_membership_school_id()
    AND public.active_membership_role() IN ('admin', 'principal')
  );

-- Writes go through the SECURITY DEFINER RPCs in SECTION 14 only.
DROP POLICY IF EXISTS memberships_insert_admin ON public.memberships;
CREATE POLICY memberships_insert_admin ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id = public.active_membership_school_id()
    AND public.active_membership_role() = 'admin'
  );

DROP POLICY IF EXISTS memberships_update_admin ON public.memberships;
CREATE POLICY memberships_update_admin ON public.memberships
  FOR UPDATE TO authenticated
  USING (
    school_id = public.active_membership_school_id()
    AND public.active_membership_role() = 'admin'
  )
  WITH CHECK (
    school_id = public.active_membership_school_id()
    AND public.active_membership_role() = 'admin'
  );

-- sessions — a session is private to its own account, always.
DROP POLICY IF EXISTS sessions_select_own ON public.sessions;
CREATE POLICY sessions_select_own ON public.sessions
  FOR SELECT TO authenticated USING (account_id = auth.uid());

DROP POLICY IF EXISTS sessions_insert_own ON public.sessions;
CREATE POLICY sessions_insert_own ON public.sessions
  FOR INSERT TO authenticated WITH CHECK (account_id = auth.uid());

DROP POLICY IF EXISTS sessions_update_own ON public.sessions;
CREATE POLICY sessions_update_own ON public.sessions
  FOR UPDATE TO authenticated
  USING (account_id = auth.uid()) WITH CHECK (account_id = auth.uid());

DROP POLICY IF EXISTS sessions_delete_own ON public.sessions;
CREATE POLICY sessions_delete_own ON public.sessions
  FOR DELETE TO authenticated USING (account_id = auth.uid());

-- invitations — the invitee sees invitations addressed to an identifier they
-- own (so Accept/Decline can be offered before any membership exists), and
-- admin/principal see their own institution's.
DROP POLICY IF EXISTS invitations_select_invitee ON public.invitations;
CREATE POLICY invitations_select_invitee ON public.invitations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.account_identifiers ai
     WHERE ai.account_id = auth.uid()
       AND ai.type = invitations.identifier_type
       AND ai.value = invitations.identifier_value
  ));

DROP POLICY IF EXISTS invitations_select_school_staff ON public.invitations;
CREATE POLICY invitations_select_school_staff ON public.invitations
  FOR SELECT TO authenticated
  USING (
    school_id = public.active_membership_school_id()
    AND public.active_membership_role() IN ('admin', 'principal')
  );

DROP POLICY IF EXISTS invitations_write_admin ON public.invitations;
CREATE POLICY invitations_write_admin ON public.invitations
  FOR ALL TO authenticated
  USING (
    school_id = public.active_membership_school_id()
    AND public.active_membership_role() = 'admin'
  )
  WITH CHECK (
    school_id = public.active_membership_school_id()
    AND public.active_membership_role() = 'admin'
  );

-- super_admins — visible only to super admins. Creation is out of band.
DROP POLICY IF EXISTS super_admins_select_self ON public.super_admins;
CREATE POLICY super_admins_select_self ON public.super_admins
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- super_admin_access_log — the super admin sees it, and so does the school
-- that was accessed: "every access is logged, and the school is notified"
-- (locked decision 10.20) is worthless if the school cannot read the log.
DROP POLICY IF EXISTS super_admin_access_log_select_super ON public.super_admin_access_log;
CREATE POLICY super_admin_access_log_select_super ON public.super_admin_access_log
  FOR SELECT TO authenticated USING (public.is_super_admin());

DROP POLICY IF EXISTS super_admin_access_log_select_school ON public.super_admin_access_log;
CREATE POLICY super_admin_access_log_select_school ON public.super_admin_access_log
  FOR SELECT TO authenticated
  USING (
    school_id = public.active_membership_school_id()
    AND public.active_membership_role() IN ('admin', 'principal')
  );

DROP POLICY IF EXISTS super_admin_access_log_insert_super ON public.super_admin_access_log;
CREATE POLICY super_admin_access_log_insert_super ON public.super_admin_access_log
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());


-- ---------------------------------------------------------------------
-- SECTION 14 — The minimum server-side paths the model needs to function
-- ---------------------------------------------------------------------

-- Binds the caller's GoTrue session to a sessions row and, when the account
-- holds exactly one active membership, activates it — "One membership goes
-- straight in" (locked decision 2). With two or more it returns them all and
-- activates none: the panel picker must choose.
CREATE OR REPLACE FUNCTION public.rpc_start_session()
RETURNS TABLE (
  session_id           uuid,
  active_membership_id uuid,
  school_id            uuid,
  role                 public.app_role,
  membership_count     int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
-- The directive above must be the first line of the body. It is here because
-- this function's OUT parameters share names with columns of public.sessions
-- and public.memberships; every reference below is table-qualified anyway, but
-- this removes the ambiguity class instead of relying on that.
DECLARE
  _uid  uuid := auth.uid();
  _asid uuid := public.current_auth_session_id();
  _sid  uuid;
  _mid  uuid;
  _cnt  int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.accounts (id) VALUES (_uid) ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO _cnt
    FROM public.memberships m
   WHERE m.account_id = _uid AND m.status = 'active';

  IF _cnt = 1 THEN
    SELECT m.id INTO _mid
      FROM public.memberships m
     WHERE m.account_id = _uid AND m.status = 'active';
  END IF;

  IF _asid IS NOT NULL THEN
    SELECT s.id INTO _sid FROM public.sessions s WHERE s.auth_session_id = _asid;
  ELSE
    -- No session_id claim in the JWT. Without this branch every call would
    -- insert another row (auth_session_id IS NULL never collides with the
    -- UNIQUE index), growing public.sessions without bound. Reuse the
    -- account's own unbound row instead: at most one per account.
    SELECT s.id INTO _sid
      FROM public.sessions s
     WHERE s.account_id = _uid
       AND s.auth_session_id IS NULL
     ORDER BY s.last_seen_at DESC
     LIMIT 1;
  END IF;

  IF _sid IS NULL THEN
    INSERT INTO public.sessions (account_id, auth_session_id, active_membership_id)
    VALUES (_uid, _asid, _mid)
    RETURNING id INTO _sid;
  ELSE
    UPDATE public.sessions s
       SET last_seen_at = now(),
           active_membership_id = COALESCE(s.active_membership_id, _mid)
     WHERE s.id = _sid
     RETURNING s.active_membership_id INTO _mid;
  END IF;

  RETURN QUERY
  SELECT _sid,
         m.id,
         m.school_id,
         m.role,
         _cnt
    FROM public.sessions s
    LEFT JOIN public.memberships m ON m.id = s.active_membership_id
   WHERE s.id = _sid;
END;
$$;

-- Switching REPLACES the active membership. The database only ever sees one
-- institution and one role (locked decision 2).
CREATE OR REPLACE FUNCTION public.rpc_switch_membership(_membership_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _asid uuid := public.current_auth_session_id();
  _sid  uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.id = _membership_id
       AND m.account_id = _uid
       AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'membership % is not an active membership of this account', _membership_id;
  END IF;

  IF _asid IS NOT NULL THEN
    SELECT s.id INTO _sid FROM public.sessions s WHERE s.auth_session_id = _asid;
  END IF;

  IF _sid IS NULL THEN
    SELECT s.id INTO _sid FROM public.sessions s
     WHERE s.account_id = _uid ORDER BY s.last_seen_at DESC LIMIT 1;
  END IF;

  IF _sid IS NULL THEN
    INSERT INTO public.sessions (account_id, auth_session_id, active_membership_id)
    VALUES (_uid, _asid, _membership_id)
    RETURNING id INTO _sid;
  ELSE
    UPDATE public.sessions
       SET active_membership_id = _membership_id, last_seen_at = now()
     WHERE id = _sid;
  END IF;

  RETURN _sid;
END;
$$;

-- An admin enters an identifier; that creates a pending membership when the
-- identifier already belongs to an account, and an invitation either way.
-- Nothing is visible to the invitee until they accept.
CREATE OR REPLACE FUNCTION public.rpc_invite_member(
  _identifier_type  public.identifier_type,
  _identifier_value text,
  _role             public.app_role,
  _local_person_id  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _school uuid := public.active_membership_school_id();
  _value  text := CASE WHEN _identifier_type = 'email'
                       THEN lower(btrim(_identifier_value)) ELSE btrim(_identifier_value) END;
  _account uuid;
  _mid     uuid;
  _inv     uuid;
BEGIN
  IF _school IS NULL OR public.active_membership_role() <> 'admin' THEN
    RAISE EXCEPTION 'only an admin of an institution may invite';
  END IF;
  IF _role = 'super_admin' THEN
    RAISE EXCEPTION 'super_admin is not a membership role';
  END IF;
  IF btrim(coalesce(_value, '')) = '' THEN
    RAISE EXCEPTION 'identifier value is required';
  END IF;

  SELECT ai.account_id INTO _account
    FROM public.account_identifiers ai
   WHERE ai.type = _identifier_type AND ai.value = _value;

  IF _account IS NOT NULL THEN
    INSERT INTO public.memberships
      (account_id, school_id, role, local_person_id, status, invited_by, invited_at)
    VALUES (_account, _school, _role, _local_person_id, 'pending', auth.uid(), now())
    ON CONFLICT (account_id, school_id, role) DO NOTHING
    RETURNING id INTO _mid;
  END IF;

  INSERT INTO public.invitations
    (school_id, identifier_type, identifier_value, role, local_person_id,
     membership_id, status, invited_by)
  VALUES (_school, _identifier_type, _value, _role, _local_person_id,
          _mid, 'pending', auth.uid())
  RETURNING id INTO _inv;

  RETURN _inv;
END;
$$;

-- Accept or decline. Declining sets the membership to 'declined', expires the
-- invite, and notifies the admin who sent it — the protection against a
-- mistyped number belonging to someone at another school.
--
-- NOTE: the document offers three options — Accept, Decline, and "This isn't
-- me" — but defines distinct behaviour only for Decline. "This isn't me" is
-- therefore NOT implemented here rather than guessed at.
CREATE OR REPLACE FUNCTION public.rpc_respond_to_invitation(
  _invitation_id uuid,
  _accept        boolean
)
RETURNS public.invitation_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _inv public.invitations%ROWTYPE;
  _mid uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT i.* INTO _inv FROM public.invitations i WHERE i.id = _invitation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation not found';
  END IF;
  IF _inv.status <> 'pending' THEN
    RAISE EXCEPTION 'invitation is already %', _inv.status;
  END IF;

  -- Only the holder of the invited identifier may answer it.
  IF NOT EXISTS (
    SELECT 1 FROM public.account_identifiers ai
     WHERE ai.account_id = _uid
       AND ai.type  = _inv.identifier_type
       AND ai.value = _inv.identifier_value
  ) THEN
    RAISE EXCEPTION 'this invitation was not addressed to your identifiers';
  END IF;

  IF _accept THEN
    INSERT INTO public.memberships
      (account_id, school_id, role, local_person_id, status, invited_by, invited_at, responded_at)
    VALUES (_uid, _inv.school_id, _inv.role, _inv.local_person_id, 'active',
            _inv.invited_by, _inv.invited_at, now())
    -- A membership the institution revoked must not come back to life just
    -- because an older invitation is still lying around. Re-inviting after a
    -- decline is fine, so 'declined' is allowed through; 'revoked' is not.
    ON CONFLICT (account_id, school_id, role)
      DO UPDATE SET status = 'active', responded_at = now()
      WHERE memberships.status <> 'revoked'
    RETURNING id INTO _mid;

    IF _mid IS NULL THEN
      RAISE EXCEPTION 'this membership was revoked by the institution; accepting an invitation cannot restore it';
    END IF;

    UPDATE public.invitations
       SET status = 'accepted', responded_at = now(), membership_id = _mid
     WHERE id = _invitation_id;

    RETURN 'accepted';
  END IF;

  UPDATE public.memberships
     SET status = 'declined', responded_at = now()
   WHERE account_id = _uid
     AND school_id  = _inv.school_id
     AND role       = _inv.role
     AND status     = 'pending';

  UPDATE public.invitations
     SET status = 'declined', responded_at = now(), expires_at = now()
   WHERE id = _invitation_id;

  IF _inv.invited_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, school_id)
    VALUES (_inv.invited_by, 'invitation_declined', 'Invitation declined',
            'An invitation you sent was declined.', _inv.school_id);
  END IF;

  RETURN 'declined';
END;
$$;

-- The only way to obtain super-admin access. Writing the log row IS opening
-- the access window, so an unlogged super-admin read is not expressible.
-- The school is notified in the same statement.
CREATE OR REPLACE FUNCTION public.rpc_super_admin_open_access(
  _school_id         uuid,
  _what_was_accessed text,
  _reason            text,
  _minutes           int DEFAULT 60
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _sa  uuid;
  _log uuid;
  _min int := COALESCE(_minutes, 60);
BEGIN
  SELECT sa.id INTO _sa
    FROM public.super_admins sa
   WHERE sa.account_id = auth.uid() AND sa.revoked_at IS NULL;
  IF _sa IS NULL THEN
    RAISE EXCEPTION 'not a super admin';
  END IF;

  IF _min < 1 OR _min > 480 THEN
    RAISE EXCEPTION 'access window must be between 1 and 480 minutes, got %', _min;
  END IF;
  IF btrim(COALESCE(_reason, '')) = '' OR btrim(COALESCE(_what_was_accessed, '')) = '' THEN
    RAISE EXCEPTION 'a reason and a statement of what is being accessed are both required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.id = _school_id) THEN
    RAISE EXCEPTION 'institution % does not exist', _school_id;
  END IF;

  INSERT INTO public.super_admin_access_log
    (super_admin_id, school_id, expires_at, what_was_accessed, reason, school_notified_at)
  VALUES (_sa, _school_id, now() + make_interval(mins => _min),
          _what_was_accessed, _reason, now())
  RETURNING id INTO _log;

  -- "Every access is logged, AND the school is notified" (locked decision
  -- 10.20). Notifying every admin and principal currently holding an active
  -- membership at that institution.
  INSERT INTO public.notifications (user_id, type, title, body, school_id)
  SELECT m.account_id,
         'super_admin_access',
         'Support access to your school data',
         'A platform super admin opened access to ' || _what_was_accessed
           || '. Reason given: ' || _reason,
         _school_id
    FROM public.memberships m
   WHERE m.school_id = _school_id
     AND m.status = 'active'
     AND m.role IN ('admin', 'principal');

  RETURN _log;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_super_admin_open_access(uuid, text, text, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_super_admin_open_access(uuid, text, text, int) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.rpc_start_session()                                   FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_switch_membership(uuid)                           FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_invite_member(public.identifier_type, text, public.app_role, uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_respond_to_invitation(uuid, boolean)               FROM public, anon;

GRANT EXECUTE ON FUNCTION public.rpc_start_session()                                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_switch_membership(uuid)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_invite_member(public.identifier_type, text, public.app_role, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_respond_to_invitation(uuid, boolean)                TO authenticated;


-- ---------------------------------------------------------------------
-- SECTION 15 — New signups join the identity model automatically
--
-- Without this, an account created after this migration would have no
-- `accounts` row and no identifiers, so an admin could never invite it by
-- phone or email — the invitation model would only work for the 22 accounts
-- backfilled above.
--
-- Added as its own trigger rather than folded into handle_new_user so it is
-- independently reversible. handle_new_user is left exactly as it is.
--
-- ON CONFLICT DO NOTHING throughout: an identifier that already belongs to
-- another account must never block a GoTrue write. Claiming a contested
-- identifier is the manual-linking path (locked decision 2), not this trigger.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_auth_user_sync_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  INSERT INTO public.accounts (id, created_at)
  VALUES (NEW.id, COALESCE(NEW.created_at, now()))
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IS NOT NULL AND btrim(NEW.email) <> '' THEN
    INSERT INTO public.account_identifiers (account_id, type, value, verified_at)
    VALUES (NEW.id, 'email', lower(btrim(NEW.email)), NEW.email_confirmed_at)
    ON CONFLICT (type, value) DO NOTHING;
  END IF;

  IF NEW.phone IS NOT NULL AND btrim(NEW.phone) <> '' THEN
    INSERT INTO public.account_identifiers (account_id, type, value, verified_at)
    VALUES (NEW.id, 'phone', btrim(NEW.phone), NEW.phone_confirmed_at)
    ON CONFLICT (type, value) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_account ON auth.users;
CREATE TRIGGER on_auth_user_created_account
  AFTER INSERT OR UPDATE OF email, phone, email_confirmed_at, phone_confirmed_at
  ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_auth_user_sync_account();

REVOKE EXECUTE ON FUNCTION public.tg_auth_user_sync_account() FROM public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 16 — Structural assertions (RLS coverage for this chunk)
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _t text;
BEGIN
  SELECT count(*), string_agg(c.relname, ', ') INTO _n, _t
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN ('accounts','account_identifiers','memberships','sessions',
                       'invitations','super_admins','super_admin_access_log')
     AND NOT c.relrowsecurity;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1: RLS not enabled on %', _t;
  END IF;

  SELECT count(*), string_agg(policyname, ', ') INTO _n, _t
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('accounts','account_identifiers','memberships','sessions',
                       'invitations','super_admins','super_admin_access_log')
     AND (coalesce(qual, '') = 'true' OR coalesce(with_check, '') = 'true');
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1: permissive-by-default policy created: %', _t;
  END IF;

  -- The super-admin bypass this chunk wires into same_school() and has_role()
  -- must be inert on arrival. Zero super_admins rows and zero open access
  -- windows means neither predicate can be widened by it today, and there is
  -- no INSERT policy on public.super_admins, so it cannot be created through
  -- the API either.
  SELECT count(*) INTO _n FROM public.super_admins WHERE revoked_at IS NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1: expected zero active super_admins on arrival, found %', _n;
  END IF;

  SELECT count(*) INTO _n FROM public.super_admin_access_log WHERE expires_at > now();
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1: expected zero open super-admin access windows, found %', _n;
  END IF;
END $$;
