-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 8 BATCH 1a — leave_decisions, and the 19 rows migrated
--
-- The ruling: both the class teacher's and the principal's decision are stored
-- separately, displayed as they are, and NO combined verdict is computed.
-- leave_requests.status IS that combined verdict, so it goes — but not in this
-- migration. The 7.5 ordering: the old column stays live until its readers are
-- repointed, because removing it first takes the feature with it. Batch 1b
-- repoints and drops.
--
-- ── What the 19 rows actually are, measured before writing anything ────────
--
--    8  pending                          no decision was made
--    3  decided WITH a reviewer          principal, principal, class_teacher
--    8  decided WITH NO reviewer         a verdict, no decider, no timestamp
--
-- The ruling says migrate each row "attributed to whoever reviewed_by names".
-- That covers 3 of the 11 decided rows. Eight carry a verdict and name nobody,
-- and reviewed_at is null on all eight — no audit trail of any kind.
--
-- Three options, and only one is honest:
--   drop them          8 students' outcomes silently become "pending"
--   attribute them     invents an audit record naming someone who did not act
--   record the absence decision preserved, decider NULL, provenance stated
--
-- The third. G4: an unknown decider is NULL, never a stand-in. decided_at is
-- nullable for the same reason — defaulting it to now() would date eight
-- decisions to this migration.
--
-- ── The one attribution that is measured, not assumed ─────────────────────
--
-- One reviewer holds app_role 'teacher'. Rather than record that, the query
-- below checked teachers.class_teacher_of against the request's class_id: they
-- WERE the class teacher of that class. So 'class_teacher' is a fact here. The
-- two principals are recorded as 'principal'.
--
-- ── No stored resolution ──────────────────────────────────────────────────
--
-- G5 forbids the stored aggregate, and the ruling names the derivation: a
-- request is resolved when a decision row exists. leave_request_decisions()
-- returns the rows; nothing caches a count or a verdict.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.leave_decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id  uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  school_id         uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  -- NULLABLE, deliberately. Eight live rows carry a verdict and name no
  -- decider; a NOT NULL here would force this migration to invent one.
  decided_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- The CAPACITY the decider acted in, not their app_role. 'class_teacher' is
  -- not an app_role — it is a teacher who is class teacher of that class, and
  -- that is the distinction the rule turns on.
  decided_by_role   text,

  decision          text NOT NULL,

  reason            text,

  -- Nullable for the same reason as decided_by: eight rows have no
  -- reviewed_at, and now() would date them to this migration.
  decided_at        timestamptz,

  -- Why a row looks the way it does, where that is not obvious from the row.
  -- Set only on the eight; null on anything decided through the app.
  provenance        text,

  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT leave_decisions_decision_known
    CHECK (decision = ANY (ARRAY['approved', 'rejected'])),

  -- No 'pending'. A request with no decision row is undecided; that is the
  -- derivation the ruling specifies, and a pending row would re-create the
  -- stored verdict this table exists to remove.
  CONSTRAINT leave_decisions_role_known
    CHECK (decided_by_role IS NULL
           OR decided_by_role = ANY (ARRAY['class_teacher', 'principal', 'admin'])),

  -- One decision per decider per request. NULLs do not collide, which is
  -- correct: the eight unattributed rows are one each, and a later real
  -- decision on the same request is a separate row.
  CONSTRAINT leave_decisions_one_per_role
    UNIQUE (leave_request_id, decided_by_role)
);

CREATE INDEX IF NOT EXISTS leave_decisions_request_idx ON public.leave_decisions (leave_request_id);
CREATE INDEX IF NOT EXISTS leave_decisions_school_idx  ON public.leave_decisions (school_id);

ALTER TABLE public.leave_decisions ENABLE ROW LEVEL SECURITY;

-- Policies mirror leave_requests exactly. A decision must not be visible to
-- anyone who cannot see the request it belongs to.
CREATE POLICY "leave decisions applicant read" ON public.leave_decisions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.leave_requests lr
     WHERE lr.id = leave_decisions.leave_request_id
       AND lr.applicant_user_id = auth.uid()));

CREATE POLICY "leave decisions parent read child" ON public.leave_decisions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.leave_requests lr
     WHERE lr.id = leave_decisions.leave_request_id
       AND public.is_my_child(lr.student_id)));

CREATE POLICY "leave decisions class teacher" ON public.leave_decisions
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.leave_requests lr
     WHERE lr.id = leave_decisions.leave_request_id
       AND lr.student_id IS NOT NULL
       AND public.is_class_teacher_of_student(auth.uid(), lr.student_id)));

CREATE POLICY "leave decisions principal admin" ON public.leave_decisions
  FOR ALL USING (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id));

-- The RESTRICTIVE fence, AND-ed with every policy above.
CREATE POLICY leave_decisions_tenant_fence ON public.leave_decisions
  AS RESTRICTIVE FOR ALL USING (public.same_school(school_id));

-- ── Migrate the 11 decided rows ───────────────────────────────────────────
INSERT INTO public.leave_decisions
  (leave_request_id, school_id, decided_by, decided_by_role, decision, reason, decided_at, provenance)
SELECT
  lr.id,
  lr.school_id,
  lr.reviewed_by,
  CASE
    WHEN lr.reviewed_by IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.teachers t
                  WHERE t.user_id = lr.reviewed_by AND t.class_teacher_of = lr.class_id)
      THEN 'class_teacher'
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = lr.reviewed_by AND ur.role = 'principal')
      THEN 'principal'
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = lr.reviewed_by AND ur.role = 'admin')
      THEN 'admin'
    ELSE NULL
  END,
  lr.status::text,
  NULLIF(trim(COALESCE(lr.review_note, '')), ''),
  lr.reviewed_at,
  CASE WHEN lr.reviewed_by IS NULL
       THEN 'Migrated from leave_requests.status by chunk8 batch1a. The source row '
         || 'carried a verdict with no reviewed_by and no reviewed_at, so the '
         || 'decider and the time of the decision are genuinely unknown rather '
         || 'than defaulted.'
       ELSE NULL END
FROM public.leave_requests lr
WHERE lr.status <> 'pending'
  AND NOT EXISTS (SELECT 1 FROM public.leave_decisions d WHERE d.leave_request_id = lr.id);

-- ── The derivation, so nothing stores a verdict ───────────────────────────
CREATE OR REPLACE FUNCTION public.leave_request_decisions(_leave_request_id uuid)
RETURNS TABLE (
  decided_by uuid,
  decided_by_role text,
  decision text,
  reason text,
  decided_at timestamptz,
  provenance text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  -- SECURITY INVOKER on purpose. The policies above are the access rule; a
  -- definer here would answer for callers those policies exclude, which is the
  -- shape G13 exists for.
  --
  -- Returns the decisions as they are. It deliberately does NOT reduce them to
  -- a verdict: "Approved by class teacher · Rejected by principal" is two rows
  -- a screen renders, and any combining function here would be the column this
  -- chunk is removing, wearing a different name.
  SELECT d.decided_by, d.decided_by_role, d.decision, d.reason, d.decided_at, d.provenance
    FROM public.leave_decisions d
   WHERE d.leave_request_id = _leave_request_id
   ORDER BY d.decided_at NULLS LAST, d.created_at
$fn$;

REVOKE EXECUTE ON FUNCTION public.leave_request_decisions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_request_decisions(uuid) TO authenticated, service_role;

-- ── Assert the outcome, not the statements ────────────────────────────────
DO $verify$
DECLARE
  _decided int; _rows int; _attributed int; _unattributed int; _pending_rows int;
BEGIN
  SELECT count(*) INTO _decided FROM public.leave_requests WHERE status <> 'pending';
  SELECT count(*) INTO _rows    FROM public.leave_decisions;
  SELECT count(*) INTO _attributed   FROM public.leave_decisions WHERE decided_by IS NOT NULL;
  SELECT count(*) INTO _unattributed FROM public.leave_decisions WHERE decided_by IS NULL;

  IF _rows <> _decided THEN
    RAISE EXCEPTION 'migrated % decision(s) for % decided request(s) — every decided request must carry exactly one',
      _rows, _decided;
  END IF;
  IF _attributed <> 3 THEN
    RAISE EXCEPTION 'expected 3 attributed decisions (measured), found %', _attributed;
  END IF;
  IF _unattributed <> 8 THEN
    RAISE EXCEPTION 'expected 8 unattributed decisions (measured), found %', _unattributed;
  END IF;

  -- No pending request may acquire a decision row: that is the derivation.
  SELECT count(*) INTO _pending_rows
    FROM public.leave_decisions d
    JOIN public.leave_requests lr ON lr.id = d.leave_request_id
   WHERE lr.status = 'pending';
  IF _pending_rows <> 0 THEN
    RAISE EXCEPTION '% pending request(s) acquired a decision row', _pending_rows;
  END IF;

  -- Every unattributed row must say why, or the absence is silent.
  IF EXISTS (SELECT 1 FROM public.leave_decisions
              WHERE decided_by IS NULL AND (provenance IS NULL OR provenance = '')) THEN
    RAISE EXCEPTION 'an unattributed decision carries no provenance';
  END IF;
END
$verify$;

COMMIT;
