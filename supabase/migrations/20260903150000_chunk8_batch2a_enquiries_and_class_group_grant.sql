-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 8 BATCH 2a — the class-group grant, and the table that is not inquiries
--
-- Two approved rulings, both of which make the chunk smaller rather than larger.
--
-- ── 1. rpc_create_class_group is the whole of the chat_conversations break ──
--
-- `chat conv insert deny` carries WITH CHECK false, so no client can INSERT a
-- conversation directly. That policy is correct and stays: conversations are
-- created through SECURITY DEFINER RPCs, which bypass it by design.
--
-- Five of the six creation RPCs are granted to `authenticated` and work. One is
-- not:
--
--   rpc_create_class_group    postgres=X, service_role=X          <- unreachable
--   rpc_create_teacher_group  postgres=X, authenticated=X, service_role=X
--   rpc_ensure_class_group    postgres=X, authenticated=X, service_role=X
--   rpc_ensure_teacher_group  postgres=X, authenticated=X, service_role=X
--   rpc_ensure_dm             postgres=X, authenticated=X, service_role=X
--   rpc_send_chat_message     postgres=X, authenticated=X, service_role=X
--
-- So the break was one missing GRANT, not a dead feature. This is G13's case
-- exactly — the policy was read and reachability inferred from it, when
-- reachability for a definer is decided by the grant.
--
-- ── 2. school_inquiries is an admissions form, not the spec's `inquiries` ───
--
-- Locked decision: an inquiry is "same as a message but routed to admin" — a
-- message with an admin recipient, not a table. The spec's `inquiries` table is
-- dropped from this chunk entirely and goes through messaging.
--
-- What EXISTS under that name is a different product: contact_name,
-- contact_phone, contact_email, grade_interest, message. A prospective parent
-- asking about admission, not an existing parent asking a question. It keeps its
-- rows and takes the name it has always deserved.
--
-- The policy name goes with it. `inquiries anyone insert` is granted to
-- {authenticated} and checks the school and the author — it says "anyone" and
-- means "any signed-in member of this school, for themselves". A name that
-- overstates a grant is the same defect as a control that exists only in a
-- comment (G14): the next reader trusts the name.
--
-- ── DEPLOY COUPLING — read before applying ─────────────────────────────────
--
-- A rename is breaking for a running client. Two files still say
-- `from("school_inquiries")` — pages/shared/OperationalCases.tsx and
-- gurukul-principal/blocks/NeedsDecision.tsx — and the generated types still
-- carry the old name. They are deliberately NOT changed in this commit, because
-- changing them before this migration is applied would point the live client at
-- a table that does not exist yet.
--
-- Apply as one step:
--   1. this migration
--   2. npm run db:types
--   3. repoint those two files
--   4. deploy
--
-- Between 1 and 3 the principal's cases screen is broken. With 11 rows on an
-- internal screen that window is acceptable; it is stated rather than hidden.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The grant ──────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.rpc_create_class_group(uuid, text) TO authenticated;

DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.rpc_create_class_group(uuid, text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_create_class_group is still unreachable from authenticated';
  END IF;
  -- anon must NOT gain it. The five siblings are authenticated-only and this
  -- one joins them, rather than joining the 183 functions anon can already call.
  IF has_function_privilege('anon', 'public.rpc_create_class_group(uuid, text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'rpc_create_class_group became callable by anon';
  END IF;
END $$;

-- ── 2. The rename ─────────────────────────────────────────────────────────

-- RECONCILED. Three sessions wrote this rename independently, in three
-- worktrees, and one of them applied it: the table was renamed on 2026-09-03
-- at 10:33 by 20260903100000_admission_enquiries_rename. So the unguarded
-- `ALTER TABLE public.school_inquiries RENAME TO admission_enquiries` this
-- file used to open with now fails on a table that no longer exists, and the
-- verification block below — which asserts that no policy still claims
-- "anyone" — fails against the names that migration chose.
--
-- What survives from THIS file is the part the other one got wrong: the
-- policy names. `inquiries anyone insert` is granted to {authenticated} and
-- checks both the school and the author. It says "anyone" and means "any
-- signed-in member of this school, for themselves". A name that overstates a
-- grant is G14 — the next reader trusts the name and not the predicate. The
-- applied migration carried that name across unchanged; this one renames it.
--
-- So section 2 becomes idempotent: rename the table only if it is still
-- called school_inquiries, and rename the policies from whichever of the two
-- naming schemes is actually present.

DO $rename$
BEGIN
  IF to_regclass('public.school_inquiries') IS NOT NULL THEN
    IF to_regclass('public.admission_enquiries') IS NOT NULL THEN
      RAISE EXCEPTION
        'ABORT: both school_inquiries and admission_enquiries exist; refusing to guess which holds the rows';
    END IF;

    ALTER TABLE public.school_inquiries RENAME TO admission_enquiries;

    ALTER TABLE public.admission_enquiries
      RENAME CONSTRAINT school_inquiries_pkey TO admission_enquiries_pkey;
    ALTER TABLE public.admission_enquiries
      RENAME CONSTRAINT school_inquiries_school_id_fkey TO admission_enquiries_school_id_fkey;
    ALTER TABLE public.admission_enquiries
      RENAME CONSTRAINT school_inquiries_created_by_fkey TO admission_enquiries_created_by_fkey;
    ALTER TRIGGER school_inquiries_set_school ON public.admission_enquiries
      RENAME TO admission_enquiries_set_school;
    ALTER POLICY "school_inquiries_tenant_fence" ON public.admission_enquiries
      RENAME TO "admission_enquiries_tenant_fence";

    RAISE NOTICE 'renamed school_inquiries -> admission_enquiries';
  ELSE
    RAISE NOTICE 'admission_enquiries already renamed; reconciling policy names only';
  END IF;
END
$rename$;

-- The two policy names, from EITHER predecessor's scheme to the one that does
-- not overstate what it permits. Guarded individually so this runs cleanly no
-- matter which of the three files got there first.
DO $policies$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid = 'public.admission_enquiries'::regclass
                AND polname = 'inquiries anyone insert') THEN
    ALTER POLICY "inquiries anyone insert" ON public.admission_enquiries
      RENAME TO "admission_enquiries insert own school signed in";
  ELSIF EXISTS (SELECT 1 FROM pg_policy
                 WHERE polrelid = 'public.admission_enquiries'::regclass
                   AND polname = 'admission_enquiries anyone insert') THEN
    ALTER POLICY "admission_enquiries anyone insert" ON public.admission_enquiries
      RENAME TO "admission_enquiries insert own school signed in";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid = 'public.admission_enquiries'::regclass
                AND polname = 'inquiries staff all') THEN
    ALTER POLICY "inquiries staff all" ON public.admission_enquiries
      RENAME TO "admission_enquiries staff manage";
  ELSIF EXISTS (SELECT 1 FROM pg_policy
                 WHERE polrelid = 'public.admission_enquiries'::regclass
                   AND polname = 'admission_enquiries staff all') THEN
    ALTER POLICY "admission_enquiries staff all" ON public.admission_enquiries
      RENAME TO "admission_enquiries staff manage";
  END IF;
END
$policies$;

DO $verify$
DECLARE _n int; _rows int;
BEGIN
  IF to_regclass('public.school_inquiries') IS NOT NULL THEN
    RAISE EXCEPTION 'school_inquiries still exists after the rename';
  END IF;
  IF to_regclass('public.admission_enquiries') IS NULL THEN
    RAISE EXCEPTION 'admission_enquiries does not exist';
  END IF;

  EXECUTE 'SELECT count(*) FROM public.admission_enquiries' INTO _rows;
  RAISE NOTICE 'admission_enquiries carries % row(s)', _rows;

  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname='public' AND tablename='admission_enquiries';
  IF _n <> 3 THEN
    RAISE EXCEPTION 'expected 3 policies on admission_enquiries, found %', _n;
  END IF;

  -- The point of this file's half of the work.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='admission_enquiries'
                AND policyname ILIKE '%anyone%') THEN
    RAISE EXCEPTION 'a policy still claims "anyone"';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='admission_enquiries'
                    AND policyname = 'admission_enquiries insert own school signed in') THEN
    RAISE EXCEPTION 'the INSERT policy did not reach its final name';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='admission_enquiries'
                    AND policyname = 'admission_enquiries staff manage') THEN
    RAISE EXCEPTION 'the staff policy did not reach its final name';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='admission_enquiries'
                    AND policyname = 'admission_enquiries_tenant_fence'
                    AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'the RESTRICTIVE tenant fence is missing';
  END IF;
END
$verify$;

COMMIT;
