-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 10.5 — §10.8 closed in the database, in one migration
--
-- "Strong areas are never shown anywhere in the app. The product surfaces
-- weaknesses only." (locked-decisions §10.8)
--
-- The client half is closed. This is the half that was still emitting, and the
-- reason it must be ONE migration is that splitting it ships a fix that reads
-- complete and is not: drop the columns without fixing the writer and the writer
-- throws 42703 on its next call; fix the emitters without dropping the columns
-- and the data keeps accumulating for the next consumer to find.
--
-- ── THE SCOPE WAS THREE FUNCTIONS. IT IS FOUR, AND THREE COLUMNS ──────────
--
-- The census that produced "three functions" — rpc_student_academic_snapshot,
-- rpc_compute_session_analytics, _build_concept_recovery_report — is another
-- instance of the rule it was written under: every census has a representation
-- it cannot see. It swept for functions that EMIT a strength key and therefore
-- could not see the one that WRITES the columns.
--
--   rpc_refresh_academic_brain    INSERT … ON CONFLICT DO UPDATE over
--                                 strong_subjects, strong_chapters,
--                                 strong_concepts. Not an emitter — a writer,
--                                 and the writer of exactly the columns being
--                                 dropped. Left out, the drop breaks it.
--
-- And the columns are three, not one:
--   student_academic_brain.strong_subjects
--   student_academic_brain.strong_chapters
--   student_academic_brain.strong_concepts
--
-- One more the census caught and should not have: rpc_student_academic_snapshot_-
-- internal matches `strong_topics` only inside a COMMENT that cites §10.8. It is
-- already closed. A comment is a representation of the fact that is not an
-- emission of it, and the sweep could not tell them apart.
--
-- ── COMPUTED AND DISCARDED GOES TOO ──────────────────────────────────────
--
-- Each function has its emission removed AND the query that produced it. A value
-- computed and thrown away is one refactor from being live, and in
-- rpc_student_academic_snapshot the query is the sharper half: it selects from
-- _weak_topics_for_user WHERE accuracy >= 75 — the weak-topics function, run
-- backwards to find strengths.
--
-- ── HOW THE REWRITES ARE MADE ────────────────────────────────────────────
--
-- pg_get_functiondef + targeted regexp_replace + CREATE OR REPLACE, so the
-- signature, volatility, SECURITY DEFINER flag, search_path and grants all
-- survive. Every substitution is guarded: if the pattern does not match, the
-- migration RAISES rather than proceeding on a body it did not change (G15 —
-- a substitution that matches nothing fails open and silently).
--
-- rpc_student_academic_snapshot carries CRLF line endings; the others do not.
-- The patterns below use \s* around newlines rather than literal \n for that
-- reason — three fixes in Chunk 7.5 were lost to exactly this.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Premise: all four functions and all three columns are still as expected ──
DO $guard$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='student_academic_brain'
     AND column_name IN ('strong_subjects','strong_chapters','strong_concepts');
  IF _n <> 3 THEN
    RAISE EXCEPTION
      'expected 3 strength columns on student_academic_brain, found %. Re-derive before dropping.', _n;
  END IF;

  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('rpc_student_academic_snapshot','rpc_compute_session_analytics',
                       '_build_concept_recovery_report','rpc_refresh_academic_brain');
  IF _n <> 4 THEN
    RAISE EXCEPTION 'expected 4 functions to rewrite, found %. The list is stale.', _n;
  END IF;
END
$guard$;


-- ── 1. rpc_student_academic_snapshot — the live one, four client files ─────
DO $f1$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_student_academic_snapshot';

  -- The emission.
  _new := regexp_replace(_def, '\s*''strong_topics'',\s*_strong,', '', 'g');
  -- The query that produced it: _weak_topics_for_user run backwards, accuracy >= 75.
  _new := regexp_replace(
    _new,
    'SELECT COALESCE\(jsonb_agg\(row_to_json\(w\) ORDER BY w\.accuracy DESC\), ''\[\]''::jsonb\)\s*INTO _strong FROM public\._weak_topics_for_user\(_uid\) w WHERE w\.accuracy >= 75 LIMIT 5;',
    '', 'g');

  -- The declaration. A variable declared and never assigned is the same
  -- computed-and-discarded residue one step further back.
  _new := regexp_replace(_new, '_strong jsonb; ', '', 'g');

  IF _new = _def THEN
    RAISE EXCEPTION
      'rpc_student_academic_snapshot: neither substitution matched, so nothing was removed. Re-read the body rather than assuming this landed.';
  END IF;
  IF _new ~* 'strong_topics' THEN
    RAISE EXCEPTION 'rpc_student_academic_snapshot: strong_topics survives the rewrite.';
  END IF;
  EXECUTE _new;
END
$f1$;


-- ── 2. rpc_compute_session_analytics — TWO keys, not one ──────────────────
DO $f2$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_compute_session_analytics';

  _new := regexp_replace(_def, '\s*''strong_chapters'',\s*COALESCE\(_strong_chapters, ''\[\]''::jsonb\),', '', 'g');
  _new := regexp_replace(_new, '\s*''strong_concepts'',\s*COALESCE\(_strong_concepts, ''\[\]''::jsonb\),', '', 'g');
  -- And the two queries behind them. Both select rows WHERE is_correct — a
  -- per-question record of what the student got right, which §10.8 and the
  -- 7B storage rule both forbid keeping.
  --
  -- ONE GENERIC PATTERN, not one per query shape. The first attempt wrote a
  -- pattern per query and the concepts one did not match: chapters selects
  -- jsonb_agg(row_data) FROM a subquery aliased `sc`, concepts selects
  -- jsonb_agg(DISTINCT jsonb_build_object(...)) straight from question_attempts
  -- with LIMIT 8. Two shapes, one purpose — and a pattern per shape is a census
  -- with a representation it cannot see, three lines after the header saying so.
  --
  -- [^;] cannot cross a statement boundary, so this removes exactly the
  -- statement that assigns into a _strong variable, whatever it looks like.
  _new := regexp_replace(_new, 'SELECT[^;]*?INTO _strong[a-z_]*[^;]*?;', '', 'gs');

  _new := regexp_replace(_new, '  _strong_chapters jsonb; _weak_chapters jsonb;', '  _weak_chapters jsonb;', 'g');
  _new := regexp_replace(_new, '  _strong_concepts jsonb; _weak_concepts jsonb;', '  _weak_concepts jsonb;', 'g');

  IF _new = _def THEN
    RAISE EXCEPTION 'rpc_compute_session_analytics: no substitution matched.';
  END IF;
  IF _new ~* 'strong_chapters|strong_concepts' THEN
    RAISE EXCEPTION
      'rpc_compute_session_analytics: a strength reference survives — %',
      substring(_new from '(?i)[^\n]*strong_[a-z]+[^\n]*');
  END IF;
  EXECUTE _new;
END
$f2$;


-- ── 3. _build_concept_recovery_report ────────────────────────────────────
DO $f3$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_build_concept_recovery_report';

  _new := regexp_replace(_def, '\s*''strong_concepts'',\s*_strong,', '', 'g');
  -- The accumulations. Three sites append to _strong inside loops that also
  -- build _weak; only the _strong arms go.
  _new := regexp_replace(_new, '\s*_strong := _strong \|\| jsonb_build_array\(jsonb_build_object\([^;]*?\)\);', '', 'gs');
  _new := regexp_replace(_new, '\s*_strong := jsonb_build_array\(jsonb_build_object\([^;]*?\)\);', '', 'gs');

  -- The brackets are ESCAPED. Written as ''[]'' this is an empty character
  -- class, which Postgres rejects outright with "brackets [] not balanced" —
  -- a loud failure, and the lucky kind: an unescaped pattern that happened to
  -- be VALID would have matched something else and failed open.
  _new := regexp_replace(_new, ' _strong jsonb := ''\[\]''::jsonb;', '', 'g');

  IF _new = _def THEN
    RAISE EXCEPTION '_build_concept_recovery_report: no substitution matched.';
  END IF;
  IF _new ~* 'strong_concepts' THEN
    RAISE EXCEPTION '_build_concept_recovery_report: strong_concepts survives the rewrite.';
  END IF;
  EXECUTE _new;
END
$f3$;


-- ── 4. rpc_refresh_academic_brain — THE WRITER the census could not see ───
DO $f4$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_refresh_academic_brain';

  -- Column list, VALUES list, and the ON CONFLICT SET arms.
  _new := regexp_replace(_def, '\s*strong_subjects, weak_subjects, strong_chapters, weak_chapters,', E'\n    weak_subjects, weak_chapters,', 'g');
  _new := regexp_replace(_new, '\s*strong_concepts, weak_concepts,', E'\n    weak_concepts,', 'g');
  _new := regexp_replace(_new, '\s*COALESCE\(_strong_(subjects|chapters|concepts), ''\[\]''::jsonb\),', '', 'g');
  _new := regexp_replace(_new, '\s*strong_(subjects|chapters|concepts) = EXCLUDED\.strong_(subjects|chapters|concepts),', '', 'g');
  -- And the three queries that computed them.
  _new := regexp_replace(_new, 'SELECT[^;]*?INTO _strong_(subjects|chapters|concepts)[^;]*?;', '', 'gs');

  _new := regexp_replace(_new, '  _weak_(concepts|chapters|subjects) jsonb; _strong_(concepts|chapters|subjects) jsonb;', '  _weak_\1 jsonb;', 'g');

  IF _new = _def THEN
    RAISE EXCEPTION 'rpc_refresh_academic_brain: no substitution matched.';
  END IF;
  IF _new ~* 'strong_subjects|strong_chapters|strong_concepts' THEN
    RAISE EXCEPTION
      'rpc_refresh_academic_brain: a strength reference survives — %',
      substring(_new from '(?i)[^\n]*strong_[a-z]+[^\n]*');
  END IF;
  EXECUTE _new;
END
$f4$;


-- ── 5. The columns. Only now, with no writer and no reader left ───────────
ALTER TABLE public.student_academic_brain
  DROP COLUMN IF EXISTS strong_subjects,
  DROP COLUMN IF EXISTS strong_chapters,
  DROP COLUMN IF EXISTS strong_concepts;


-- ── AFTER: no function in public names a strength, and the live one RUNS ──
DO $after$
DECLARE _left text; _uid uuid; _res jsonb; _n int;
BEGIN
  -- Catalog: nothing left anywhere in public, including bodies this migration
  -- did not touch. Counted, not asserted at zero on the four it knew about.
  SELECT string_agg(p.proname, ', ') INTO _left
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f'
     AND p.prosrc ~* '''strong_(topics|concepts|chapters|subjects)''';
  IF _left IS NOT NULL THEN
    RAISE EXCEPTION 'a function still EMITS a strength key: %', _left;
  END IF;

  SELECT count(*) INTO _n
    FROM information_schema.columns
   WHERE table_schema='public' AND column_name ~ '^strong_';
  IF _n <> 0 THEN
    RAISE EXCEPTION '% strength column(s) survive in public.', _n;
  END IF;

  -- Behaviour, not catalog. rpc_student_academic_snapshot feeds four client
  -- files; a body that compiles proves nothing about a plpgsql function.
  SELECT id INTO _uid FROM auth.users WHERE email = 'arjun.mehta@wisdomcampus.com';
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'no demo student; the live path cannot be exercised.';
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _res := public.rpc_student_academic_snapshot();
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _res IS NULL THEN
    RAISE EXCEPTION 'rpc_student_academic_snapshot returned NULL for a real student.';
  END IF;
  IF _res ? 'strong_topics' THEN
    RAISE EXCEPTION 'the snapshot still carries a strong_topics key at run time.';
  END IF;
  -- It must still answer: an empty object would pass the check above.
  IF NOT (_res ? 'weak_topics') THEN
    RAISE EXCEPTION 'the snapshot no longer carries weak_topics — it was emptied, not narrowed.';
  END IF;

  RAISE NOTICE 'chunk 10.5: 4 functions rewritten, 3 columns dropped, snapshot runs and carries weak_topics.';
END
$after$;

COMMIT;
