-- ═══════════════════════════════════════════════════════════════════════════
-- The test status vocabulary matches the app that writes it (§7, §10.5)
--
-- `tests_status_check` admits exactly three values:
--
--     CHECK (status = ANY (ARRAY['draft','published','submitted']))
--
-- `TestService` declares four, and writes two the constraint refuses:
--
--     export type TestStatus = "draft" | "scheduled" | "published" | "archived";
--
--     TestService.schedule() -> status = 'scheduled'   -> 23514
--     TestService.archive()  -> status = 'archived'    -> 23514
--
-- and the teacher's own builder offers "Schedule" beside "Save as draft" and
-- "Publish now". So two of the three buttons on that screen write a value the
-- database rejects.
--
-- Meanwhile 'submitted' is in the constraint and NOTHING in the application
-- writes it. All 72 existing rows carry it because they came from seed SQL.
-- The vocabulary and the writer have been drifting in both directions.
--
-- ── WHY WIDEN RATHER THAN NARROW THE APP ─────────────────────────────────
--
-- The table already carries `scheduled_publish_at` and `archived_at`, so the
-- schema was built expecting both states to exist; only the enum was left
-- behind. Nothing in the database reads this vocabulary — measured:
--
--   * `my_readable_test_ids` and `my_manageable_test_ids` do not mention
--     status at all (publish gating lives in the service and in `tests_read`).
--   * no function in `public` referencing 'scheduled' touches `tests` — the
--     eight that do are homework and battle functions on other tables.
--
-- So widening changes no read path, and narrowing the app would mean deleting
-- a button a teacher already uses. 'submitted' is KEPT: 72 rows hold it, and
-- dropping a value from a CHECK that existing rows satisfy would refuse them
-- on their next update.
--
-- Rollback: supabase/migrations/rollback/
--           20260915010000_the_test_status_vocabulary_matches_the_app.rollback.sql
--           (refuses to run while any row holds one of the two new values, so
--            it cannot orphan data behind a constraint it just re-narrowed)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tests DROP CONSTRAINT IF EXISTS tests_status_check;

ALTER TABLE public.tests
  ADD CONSTRAINT tests_status_check
  CHECK (status = ANY (ARRAY['draft', 'scheduled', 'published', 'submitted', 'archived']));

-- ── Proof, before this commits ────────────────────────────────────────────
-- The constraint must admit the four the app writes AND still refuse a value
-- that is not in the vocabulary. A CHECK that accepts everything is not a
-- wider CHECK, it is an absent one.
DO $verify$
DECLARE
  sch    uuid := '00000000-0000-4000-8000-000000000001';
  ss     uuid;
  author uuid;
  v      text;
  refused boolean := false;
BEGIN
  SELECT id INTO author FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT s.id INTO ss FROM public.section_subjects s
   WHERE s.section_id = 'd2000001-0001-4000-8000-000000000001' AND s.school_id = sch LIMIT 1;
  IF author IS NULL OR ss IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: fixtures missing — a check that cannot run is not a check that passed';
  END IF;

  FOREACH v IN ARRAY ARRAY['draft', 'scheduled', 'published', 'submitted', 'archived'] LOOP
    INSERT INTO public.tests (school_id, section_subject_id, created_by, title, max_mark, status)
    VALUES (sch, ss, author, 'vocab probe ' || v, 1, v);
  END LOOP;

  BEGIN
    INSERT INTO public.tests (school_id, section_subject_id, created_by, title, max_mark, status)
    VALUES (sch, ss, author, 'vocab probe bogus', 1, 'not_a_status');
  EXCEPTION WHEN check_violation THEN
    refused := true;
  END;

  -- Undo the probe rows; only the constraint change survives this migration.
  DELETE FROM public.tests WHERE title LIKE 'vocab probe %' AND created_by = author;

  IF NOT refused THEN
    RAISE EXCEPTION 'ROLLED BACK: the CHECK accepted a value outside the vocabulary — it is not a constraint any more';
  END IF;

  RAISE NOTICE 'tests_status_check admits draft/scheduled/published/submitted/archived and refuses anything else.';
END $verify$;
