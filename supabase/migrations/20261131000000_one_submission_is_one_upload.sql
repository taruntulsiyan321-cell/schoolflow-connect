-- ═══════════════════════════════════════════════════════════════════════════
-- ONE SUBMISSION IS ONE CUSTOM PRACTICE UPLOAD
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KNOWN_ISSUES 85. The plan counts Custom Practice uploads a month (5 on
-- Starter, 30 on Standard, 100 on Premium), and it counted one per FILE: the
-- screen makes one student_uploads row per file picked, and custom-practice-
-- upload consumed one use per row. A worksheet photographed as three pages
-- cost three of five, while the same worksheet as one PDF cost one.
--
-- RULED (the owner, 2026-10-01: "fix everything"): an upload is what the
-- student submits — the files they pick together — whatever its page count,
-- as a PDF already was.
--
--   student_uploads.submission_id   the files picked together; set by the app
--                                   at intake (one id per pick).
--   student_upload_plan_uses        the file that COUNTED its submission's
--                                   use, with the plan period it counted in.
--                                   Written only by the upload function (no
--                                   client grant at all) — a mark a student
--                                   could write would be a way to upload free.
--   _upload_counted_sibling(id)     the file this one rides on: a file of the
--                                   same submission, same owner, whose use was
--                                   counted and KEPT (it ended ready), created
--                                   within ten minutes of this one. The window
--                                   bounds what reusing a submission id could
--                                   ever buy; a real pick is inserted within
--                                   seconds.
--
-- The upload function counts the first file of a submission as before, and
-- records it here when it ends ready; a later file of that submission rides on
-- it and counts nothing. A file that fails or is unusable gives its use back,
-- as before — and then the next file of the submission counts instead, because
-- nothing it could ride on was kept.
--
-- ROLLBACK: rollback/20261131000000_one_submission_is_one_upload.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.student_uploads ADD COLUMN submission_id uuid;
COMMENT ON COLUMN public.student_uploads.submission_id IS
  'The files a student picked together: one Custom Practice submission, counted once by the plan (20261131000000). Set by the app at intake.';
CREATE INDEX student_uploads_submission_idx
  ON public.student_uploads (owner_id, submission_id) WHERE submission_id IS NOT NULL;

CREATE TABLE public.student_upload_plan_uses (
  upload_id     uuid PRIMARY KEY REFERENCES public.student_uploads(id) ON DELETE CASCADE,
  owner_id      uuid NOT NULL,
  submission_id uuid,
  period_key    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.student_upload_plan_uses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_upload_plan_uses FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.student_upload_plan_uses IS
  'The upload that counted its submission''s Custom Practice use, and the plan period it counted in (20261131000000). Written by custom-practice-upload under the service role only; no policy, no client grant.';

CREATE FUNCTION public._upload_counted_sibling(_upload_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
  SELECT s.id
    FROM public.student_uploads u
    JOIN public.student_uploads s
      ON s.owner_id = u.owner_id AND s.submission_id = u.submission_id AND s.id <> u.id
    JOIN public.student_upload_plan_uses pu ON pu.upload_id = s.id
   WHERE u.id = _upload_id
     AND u.submission_id IS NOT NULL
     AND s.status = 'ready'
     AND abs(extract(epoch FROM (s.created_at - u.created_at))) <= 600
   ORDER BY s.created_at, s.id
   LIMIT 1
$f$;
COMMENT ON FUNCTION public._upload_counted_sibling(uuid) IS
  'The upload of the same submission whose Custom Practice use was counted and kept, within ten minutes — the one this upload rides on, or NULL (20261131000000).';

CREATE FUNCTION public._upload_record_plan_use(_upload_id uuid, _period_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
  INSERT INTO public.student_upload_plan_uses (upload_id, owner_id, submission_id, period_key)
  SELECT u.id, u.owner_id, u.submission_id, _period_key
    FROM public.student_uploads u WHERE u.id = _upload_id
  ON CONFLICT (upload_id) DO NOTHING
$f$;
COMMENT ON FUNCTION public._upload_record_plan_use(uuid, text) IS
  'Marks the upload that counted its submission''s Custom Practice use (20261131000000). Service role only.';

REVOKE ALL ON FUNCTION public._upload_counted_sibling(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._upload_record_plan_use(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._upload_counted_sibling(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._upload_record_plan_use(uuid, text) TO service_role;

-- ── THE PROOF ─────────────────────────────────────────────────────────────
-- On a real individual account, with fixture uploads rolled back:
--   1. a file of a submission whose first file counted and ended ready rides on it;
--   2. CONTROL — not when that first file did not end ready (its use went back);
--   3. CONTROL — not a file of another submission, nor one with no submission;
--   4. CONTROL — not a file created more than ten minutes from the counted one;
--   5. no client role can read or write the uses, or call either function.
DO $proof$
DECLARE
  _uid uuid; _school uuid; _sub uuid := gen_random_uuid();
  _a uuid; _b uuid; _c uuid; _d uuid; _e uuid; _got uuid;
BEGIN
  IF has_table_privilege('authenticated', 'public.student_upload_plan_uses', 'SELECT')
     OR has_table_privilege('authenticated', 'public.student_upload_plan_uses', 'INSERT')
     OR has_table_privilege('anon', 'public.student_upload_plan_uses', 'SELECT')
     OR has_function_privilege('authenticated', 'public._upload_counted_sibling(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._upload_record_plan_use(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a client role can reach the plan uses';
  END IF;

  SELECT u.owner_id, u.school_id INTO _uid, _school
    FROM public.student_uploads u JOIN public.schools s ON s.id = u.school_id
   WHERE s.kind = 'individual'
   GROUP BY u.owner_id, u.school_id ORDER BY count(*) LIMIT 1;
  IF _uid IS NULL THEN RAISE EXCEPTION 'NO FIXTURE: no individual account has an upload'; END IF;

  BEGIN
    INSERT INTO public.student_uploads (owner_id, school_id, storage_path, original_filename, byte_size, mime_type, status, submission_id, created_at)
    VALUES (_uid, _school, 'proof/a', 'a.png', 1, 'image/png', 'ready',   _sub, now())                       RETURNING id INTO _a;
    INSERT INTO public.student_uploads (owner_id, school_id, storage_path, original_filename, byte_size, mime_type, status, submission_id, created_at)
    VALUES (_uid, _school, 'proof/b', 'b.png', 1, 'image/png', 'pending', _sub, now() + interval '5 seconds') RETURNING id INTO _b;
    INSERT INTO public.student_uploads (owner_id, school_id, storage_path, original_filename, byte_size, mime_type, status, submission_id, created_at)
    VALUES (_uid, _school, 'proof/c', 'c.png', 1, 'image/png', 'pending', _sub, now() + interval '11 minutes') RETURNING id INTO _c;
    INSERT INTO public.student_uploads (owner_id, school_id, storage_path, original_filename, byte_size, mime_type, status, submission_id, created_at)
    VALUES (_uid, _school, 'proof/d', 'd.png', 1, 'image/png', 'pending', gen_random_uuid(), now())          RETURNING id INTO _d;
    INSERT INTO public.student_uploads (owner_id, school_id, storage_path, original_filename, byte_size, mime_type, status, submission_id, created_at)
    VALUES (_uid, _school, 'proof/e', 'e.png', 1, 'image/png', 'pending', NULL, now())                       RETURNING id INTO _e;

    -- Before the first file is recorded, nothing rides.
    IF public._upload_counted_sibling(_b) IS NOT NULL THEN
      RAISE EXCEPTION 'a file rode on a submission none of whose files had counted';
    END IF;

    PERFORM public._upload_record_plan_use(_a, 'm:proof');
    _got := public._upload_counted_sibling(_b);
    IF _got IS DISTINCT FROM _a THEN RAISE EXCEPTION '1: the second file of a counted submission does not ride on it (%)', _got; END IF;
    IF public._upload_counted_sibling(_c) IS NOT NULL THEN RAISE EXCEPTION '4: a file eleven minutes later rode on the submission'; END IF;
    IF public._upload_counted_sibling(_d) IS NOT NULL THEN RAISE EXCEPTION '3: a file of another submission rode'; END IF;
    IF public._upload_counted_sibling(_e) IS NOT NULL THEN RAISE EXCEPTION '3: a file with no submission rode'; END IF;

    UPDATE public.student_uploads SET status = 'failed' WHERE id = _a;
    IF public._upload_counted_sibling(_b) IS NOT NULL THEN RAISE EXCEPTION '2: a file rode on one that did not end ready'; END IF;

    RAISE EXCEPTION 'SUBMISSION_PROOF_OK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SUBMISSION_PROOF_OK' THEN RAISE; END IF;
  END;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261131000000_one_submission_is_one_upload')
ON CONFLICT (version) DO NOTHING;

COMMIT;
