-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — recreate public.parent_academic_alerts
--
-- Restores the table exactly as it stood before 20260904230000: nine columns,
-- the `kind` CHECK, three foreign keys, two indexes beyond the primary key,
-- RLS enabled, and both policies — the permissive own-rows policy and the
-- RESTRICTIVE tenant fence.
--
-- ── WHEN TO RUN THIS ─────────────────────────────────────────────────────
--
-- One legitimate reason, and it is a mechanical one:
--
--   `rollback/20260904190000_parent_digest_delivery.rollback.sql` SELECTs FROM
--   this table (line 135) and cannot run while it is absent. If you are rolling
--   back 190000, run THIS FIRST.
--
-- It is NOT a reason to run this that someone wants parent academic alerts
-- back. That feature was ruled not to exist — every generation rule it had was
-- derived from practice data, and §10.15 restricts the parent summary to school
-- data only. A future school-data emitter gets a table shaped for its own
-- requirements; it must not inherit this one, whose `kind` CHECK enumerates the
-- four practice-derived alert kinds.
--
-- ── WHAT COMES BACK WITH IT ──────────────────────────────────────────────
--
-- The gap recorded in the forward migration returns too: `authenticated` holds
-- INSERT through a PUBLIC grant, and the permissive policy constrains only
-- `parent_user_id`, not `student_id`. A signed-in parent can insert an alert
-- naming any student. Nothing reads the table, so nothing displays it — but if
-- this table is ever brought back into use, that policy needs fixing first.
--
-- Row data is NOT restored, because there was none: the table held 0 rows when
-- it was dropped. This rollback recreates a structure, not a dataset.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public.parent_academic_alerts (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  parent_user_id uuid        NOT NULL,
  student_id     uuid        NOT NULL,
  kind           text        NOT NULL,
  title          text        NOT NULL,
  body           text        NOT NULL,
  read           boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  school_id      uuid        NULL,
  CONSTRAINT parent_academic_alerts_pkey PRIMARY KEY (id),
  CONSTRAINT parent_academic_alerts_kind_check
    CHECK (kind = ANY (ARRAY['weakness'::text, 'consistency'::text, 'improvement'::text, 'participation'::text])),
  CONSTRAINT parent_academic_alerts_parent_user_id_fkey
    FOREIGN KEY (parent_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT parent_academic_alerts_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE,
  CONSTRAINT parent_academic_alerts_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.schools(id)
);

CREATE INDEX parent_alerts_parent_recent
  ON public.parent_academic_alerts USING btree (parent_user_id, created_at DESC);
CREATE INDEX parent_academic_alerts_school_id_idx
  ON public.parent_academic_alerts USING btree (school_id);

ALTER TABLE public.parent_academic_alerts ENABLE ROW LEVEL SECURITY;

-- The permissive own-rows policy, restored verbatim including its gap: the
-- WITH CHECK constrains parent_user_id only. See the header.
CREATE POLICY "parent alerts own"
  ON public.parent_academic_alerts
  AS PERMISSIVE FOR ALL
  TO authenticated
  USING (parent_user_id = auth.uid())
  WITH CHECK (parent_user_id = auth.uid());

-- The RESTRICTIVE tenancy fence, in the Chunk 1 pattern: it can only ever
-- narrow, never widen, whatever the permissive policies allow.
CREATE POLICY parent_academic_alerts_tenant_fence
  ON public.parent_academic_alerts
  AS RESTRICTIVE FOR ALL
  TO authenticated, anon
  USING (school_id IS NULL OR same_school(school_id))
  WITH CHECK (school_id IS NULL OR same_school(school_id));

-- Assert the INVERSE of the forward check, so a half-applied reversal fails
-- loudly rather than leaving a table with no fence on it.
DO $$
DECLARE _pol int; _restrictive int;
BEGIN
  IF to_regclass('public.parent_academic_alerts') IS NULL THEN
    RAISE EXCEPTION 'rollback incomplete: the table was not created';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.parent_academic_alerts'::regclass) THEN
    RAISE EXCEPTION 'rollback incomplete: RLS is not enabled — the table would be wide open';
  END IF;

  SELECT count(*) INTO _pol FROM pg_policy
   WHERE polrelid = 'public.parent_academic_alerts'::regclass;
  IF _pol <> 2 THEN
    RAISE EXCEPTION 'rollback incomplete: expected 2 policies, found %', _pol;
  END IF;

  -- Specifically the fence: a permissive-only restore is the dangerous
  -- half-state, and it would satisfy a bare count on its own.
  SELECT count(*) INTO _restrictive FROM pg_policy
   WHERE polrelid = 'public.parent_academic_alerts'::regclass AND NOT polpermissive;
  IF _restrictive <> 1 THEN
    RAISE EXCEPTION 'rollback incomplete: the RESTRICTIVE tenant fence is missing';
  END IF;
END $$;

DELETE FROM public.schema_migrations
 WHERE version = '20260904230000_drop_parent_academic_alerts';

COMMIT;
