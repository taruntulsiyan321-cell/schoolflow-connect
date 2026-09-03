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

ALTER TABLE public.school_inquiries RENAME TO admission_enquiries;

-- Constraints keep their old names through a table rename; rename them too, so
-- a reader of \d admission_enquiries is not told about a table that is gone.
ALTER TABLE public.admission_enquiries RENAME CONSTRAINT school_inquiries_pkey TO admission_enquiries_pkey;
ALTER TABLE public.admission_enquiries RENAME CONSTRAINT school_inquiries_school_id_fkey TO admission_enquiries_school_id_fkey;
ALTER TABLE public.admission_enquiries RENAME CONSTRAINT school_inquiries_created_by_fkey TO admission_enquiries_created_by_fkey;

ALTER TRIGGER school_inquiries_set_school ON public.admission_enquiries
  RENAME TO admission_enquiries_set_school;

ALTER POLICY "school_inquiries_tenant_fence" ON public.admission_enquiries
  RENAME TO "admission_enquiries_tenant_fence";

-- The name now states the grant it actually carries.
ALTER POLICY "inquiries anyone insert" ON public.admission_enquiries
  RENAME TO "admission_enquiries insert own school signed in";

ALTER POLICY "inquiries staff all" ON public.admission_enquiries
  RENAME TO "admission_enquiries staff manage";

-- ── 3. Prove it ───────────────────────────────────────────────────────────

DO $$
DECLARE _n int; _rows int; _old int;
BEGIN
  SELECT count(*) INTO _old FROM information_schema.tables
   WHERE table_schema='public' AND table_name='school_inquiries';
  IF _old <> 0 THEN RAISE EXCEPTION 'school_inquiries still exists after the rename'; END IF;

  SELECT count(*) INTO _n FROM information_schema.tables
   WHERE table_schema='public' AND table_name='admission_enquiries';
  IF _n <> 1 THEN RAISE EXCEPTION 'admission_enquiries does not exist'; END IF;

  -- A rename must not lose rows. There were 11.
  EXECUTE 'SELECT count(*) FROM public.admission_enquiries' INTO _rows;
  RAISE NOTICE 'admission_enquiries carries % row(s)', _rows;

  -- The three policies must all still be attached, under the new names.
  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname='public' AND tablename='admission_enquiries';
  IF _n <> 3 THEN RAISE EXCEPTION 'expected 3 policies on admission_enquiries, found %', _n; END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='admission_enquiries'
                AND policyname ILIKE '%anyone%') THEN
    RAISE EXCEPTION 'a policy still claims "anyone"';
  END IF;
END $$;

COMMIT;
