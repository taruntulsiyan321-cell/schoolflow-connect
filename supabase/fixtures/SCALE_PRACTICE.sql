-- ---------------------------------------------------------------------
-- SCALE FIXTURE — practice half (G8)
--
-- "The seed must cover every table the gates measure." The six existing
-- practice tables held 0-17 rows between them, so the timing gate measured
-- nothing there: Chunk 7B batch 2 rewrites their tenant fences and without
-- volume there is no before/after worth reporting.
--
-- Seeded into the SCALE institution only. The demo school stays at 13
-- students and stays readable.
--
-- Run through scripts/seed-scale-practice.mjs, which mints the auth accounts
-- first — every one of these tables FKs user_id -> auth.users, so practice
-- volume is not seedable without real accounts.
--
-- Deterministic and idempotent: ids are md5(<stable label>)::uuid and every
-- insert is ON CONFLICT DO NOTHING. A fixture that differs between runs cannot
-- be the baseline for a before/after measurement.
--
-- What it does NOT do: store per-question correctness that should not exist.
-- question_attempts.is_correct is populated because the column still exists and
-- is 7C's subject (it feeds 14 SECURITY DEFINER analytics functions); the
-- fixture reflects the schema as it is rather than as it should be, and that
-- gap is the one CHUNK7B_BATCH1_VERIFY item 2 already reports.
-- ---------------------------------------------------------------------

DO $practice$
DECLARE
  _school uuid := '00000000-0000-4000-8000-000000000002';
  _n      bigint;
  _users  bigint;
BEGIN

  SELECT count(*) INTO _users
    FROM public.students s
   WHERE s.school_id = _school AND s.user_id IS NOT NULL;

  IF _users < 10 THEN
    RAISE EXCEPTION
      'SCALE_PRACTICE: only % scale students have an auth account; run scripts/seed-scale-practice.mjs (it mints them) rather than this file directly.',
      _users;
  END IF;

  ----------------------------------------------------------------------
  -- practice_sessions — 6 per student. Session TOTALS only, which is what
  -- §10.8 says survives when a session closes.
  ----------------------------------------------------------------------
  INSERT INTO public.practice_sessions
    (id, school_id, user_id, student_id, subject, chapter, question_count,
     correct_count, wrong_count, skipped_count, score, accuracy, created_at, finished_at)
  SELECT md5('nf-ps-' || s.id::text || '-' || g)::uuid,
         _school, s.user_id, s.id,
         (ARRAY['Mathematics','Physics','Chemistry','Biology','English','Hindi'])[1 + (g % 6)],
         'Chapter ' || (1 + (g % 8)),
         20,
         12 + (g % 7),
         20 - (12 + (g % 7)) - (g % 3),
         (g % 3),
         (12 + (g % 7)) * 5.0,
         round(((12 + (g % 7)) * 100.0) / 20, 1),
         now() - ((g * 3) || ' days')::interval,
         now() - ((g * 3) || ' days')::interval + interval '18 minutes'
    FROM public.students s, generate_series(1, 6) g
   WHERE s.school_id = _school AND s.user_id IS NOT NULL
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------------
  -- question_attempts — 20 per session. This is the big one: the table the
  -- fence has to survive, and the table 7C will restructure.
  ----------------------------------------------------------------------
  INSERT INTO public.question_attempts
    (id, school_id, user_id, student_id, session_id, generated_question,
     correct_answer, selected_answer, is_correct, score, skipped,
     subject, chapter, difficulty, time_taken_ms, created_at)
  SELECT md5('nf-qa-' || ps.id::text || '-' || q)::uuid,
         _school, ps.user_id, ps.student_id, ps.id,
         jsonb_build_object('stem', 'Scale fixture question ' || q, 'options',
                            jsonb_build_array('A', 'B', 'C', 'D')),
         to_jsonb((q % 4)),
         to_jsonb(((q + ps.correct_count) % 4)),
         ((q % 4) = ((q + ps.correct_count) % 4)),
         CASE WHEN (q % 4) = ((q + ps.correct_count) % 4) THEN 1 ELSE 0 END,
         (q % 11 = 0),
         ps.subject, ps.chapter,
         (ARRAY['easy','medium','hard'])[1 + (q % 3)],
         18000 + (q * 700),
         ps.created_at + ((q * 40) || ' seconds')::interval
    FROM public.practice_sessions ps, generate_series(1, 20) q
   WHERE ps.school_id = _school
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------------
  -- student_mistakes — the mistake book. Only what went wrong.
  ----------------------------------------------------------------------
  INSERT INTO public.student_mistakes
    (id, school_id, user_id, student_id, source, subject, chapter, topic,
     question_text, correct_answer, student_answer, times_wrong, last_wrong_at, mastered)
  SELECT md5('nf-sm-' || s.id::text || '-' || m)::uuid,
         _school, s.user_id, s.id, 'practice',
         (ARRAY['Mathematics','Physics','Chemistry','Biology','English','Hindi'])[1 + (m % 6)],
         'Chapter ' || (1 + (m % 8)),
         'Topic ' || (1 + (m % 5)),
         'Scale fixture mistake ' || m,
         to_jsonb('A'::text), to_jsonb('C'::text),
         1 + (m % 3),
         now() - ((m * 2) || ' days')::interval,
         false
    FROM public.students s, generate_series(1, 12) m
   WHERE s.school_id = _school AND s.user_id IS NOT NULL
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------------
  -- concept_mastery — per concept, not per question.
  ----------------------------------------------------------------------
  INSERT INTO public.concept_mastery
    (id, school_id, user_id, student_id, subject, chapter, concept,
     mastery_score, total_attempts, correct_attempts, mistake_count, last_attempt_at)
  SELECT md5('nf-cm-' || s.id::text || '-' || c)::uuid,
         _school, s.user_id, s.id,
         (ARRAY['Mathematics','Physics','Chemistry','Biology','English','Hindi'])[1 + (c % 6)],
         'Chapter ' || (1 + (c % 8)),
         'Concept ' || (1 + (c % 10)),
         round(35 + ((c * 7) % 60), 1),
         20, 8 + (c % 10), (c % 5),
         now() - ((c * 2) || ' days')::interval
    FROM public.students s, generate_series(1, 10) c
   WHERE s.school_id = _school AND s.user_id IS NOT NULL
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------------
  -- revision_queue
  ----------------------------------------------------------------------
  INSERT INTO public.revision_queue
    (id, school_id, user_id, student_id, subject, chapter, topic, reason,
     priority, due_date, completed)
  SELECT md5('nf-rq-' || s.id::text || '-' || r)::uuid,
         _school, s.user_id, s.id,
         (ARRAY['Mathematics','Physics','Chemistry','Biology','English','Hindi'])[1 + (r % 6)],
         'Chapter ' || (1 + (r % 8)),
         'Topic ' || (1 + (r % 5)),
         'scale fixture',
         1 + (r % 3),
         (current_date + (r % 30))::date,
         (r % 4 = 0)
    FROM public.students s, generate_series(1, 5) r
   WHERE s.school_id = _school AND s.user_id IS NOT NULL
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------------
  -- student_question_history — keyed on real bank questions, since
  -- question_id FKs question_bank.
  ----------------------------------------------------------------------
  INSERT INTO public.student_question_history (user_id, question_id, times_seen, last_seen_at, school_id)
  SELECT s.user_id, qb.id, 1 + (qb.rn % 3), now() - ((qb.rn % 20) || ' days')::interval, _school
    FROM public.students s
    CROSS JOIN (SELECT id, row_number() OVER (ORDER BY id) AS rn
                  FROM public.question_bank ORDER BY id LIMIT 25) qb
   WHERE s.school_id = _school AND s.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  ----------------------------------------------------------------------
  -- Report. A fixture that silently seeds nothing is worse than none: the
  -- timing gate would report comfortable numbers on volume that is not there.
  ----------------------------------------------------------------------
  DECLARE
    _ps bigint; _qa bigint; _sm bigint; _cm bigint; _rq bigint; _sqh bigint;
  BEGIN
    SELECT count(*) INTO _ps  FROM public.practice_sessions        WHERE school_id = _school;
    SELECT count(*) INTO _qa  FROM public.question_attempts        WHERE school_id = _school;
    SELECT count(*) INTO _sm  FROM public.student_mistakes         WHERE school_id = _school;
    SELECT count(*) INTO _cm  FROM public.concept_mastery          WHERE school_id = _school;
    SELECT count(*) INTO _rq  FROM public.revision_queue           WHERE school_id = _school;
    SELECT count(*) INTO _sqh FROM public.student_question_history WHERE school_id = _school;

    -- RAISE only on failure. This is a FIXTURE, not a verification file: a
    -- verification file ends in a deliberate RAISE so its work rolls back,
    -- and doing that here would discard the very rows it just seeded.
    IF _qa < 2000 THEN
      RAISE EXCEPTION
        'SCALE_PRACTICE seeded only % question_attempts; the timing gate needs real volume (accounts=%, sessions=%).',
        _qa, _users, _ps;
    END IF;
  END;
END
$practice$;

-- Returned to the caller so the runner can assert the volume actually landed
-- rather than trusting that no error meant success.
SELECT 'SCALE_PRACTICE_OK' AS status,
       (SELECT count(*) FROM public.students s
         WHERE s.school_id = '00000000-0000-4000-8000-000000000002' AND s.user_id IS NOT NULL) AS accounts,
       (SELECT count(*) FROM public.practice_sessions        WHERE school_id = '00000000-0000-4000-8000-000000000002') AS sessions,
       (SELECT count(*) FROM public.question_attempts        WHERE school_id = '00000000-0000-4000-8000-000000000002') AS attempts,
       (SELECT count(*) FROM public.student_mistakes         WHERE school_id = '00000000-0000-4000-8000-000000000002') AS mistakes,
       (SELECT count(*) FROM public.concept_mastery          WHERE school_id = '00000000-0000-4000-8000-000000000002') AS mastery,
       (SELECT count(*) FROM public.revision_queue           WHERE school_id = '00000000-0000-4000-8000-000000000002') AS revision,
       (SELECT count(*) FROM public.student_question_history WHERE school_id = '00000000-0000-4000-8000-000000000002') AS history;
