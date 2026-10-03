-- ═══════════════════════════════════════════════════════════════════════════
-- EVERY QUESTION FORM IS LAID OUT, AND KNOWN BY ITS FORM
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-03: all MCQ, but every form CUET uses — assertion–reason,
-- statement-based, match-the-following, case-based (the long questions),
-- sequence — each laid out properly, wherever the question is shown.
--
-- Measured that day: all 1,130 active CUET questions were 'mcq'. The 42
-- assertion–reason questions held both statements on one line; the 27 match
-- questions had their lists pushed into the options; 16 of the
-- assertion–reason questions carried an imported fifth option, "(e) Both A
-- and R are incorrect", glued onto option D.
--
-- 1. THE LAYOUT LIVES IN THE TEXT. A question is stored as text, and every
--    attempt, mistake and report keeps a copy of that text, so the form is
--    written into it (supabase/functions/_shared/questionForms.ts: writers
--    compose it from parts; the app reads it back into blocks):
--      Assertion (A): …  / Reason (R): …
--      List I (…): A. … / List II (…): I. …          match
--      I. … II. …  — options "I and III only"        statements
--      I. … II. …  — options "II, I, IV, III"        sequence
--      Case: …  / Question: …                         case_based
-- 2. public.question_form_of(question, options) classifies that text, and a
--    trigger keeps question_bank.question_format equal to it for every
--    multiple-choice row; the existing rows are classified once here.
--    questionForms.test.ts holds formOf (TS) to the FIXTURES below, which the
--    PROOF holds question_form_of to.
-- 3. The imported "(e) …" tail is cut from option D of the 16 assertion–reason
--    questions whose answer is not D. The one whose answer IS D, and whose
--    explanation speaks of (e), joins the disputed list: its key may be (e).
-- 4. ai_practice_bank_candidates takes a form, and ai_practice_requests keeps
--    the form a student asked for.
--
-- ROLLBACK: rollback/20261141000000_every_question_form_is_laid_out.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The forms ────────────────────────────────────────────────────────────
ALTER TABLE public.question_bank DROP CONSTRAINT question_bank_question_format_check;
ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_question_format_check
  CHECK (question_format IS NULL OR question_format IN
    ('mcq', 'assertion_reason', 'statements', 'match', 'case_based', 'sequence',
     'short', 'long', 'numerical', 'concept'));

-- ── 2. What form a question's text is ───────────────────────────────────────
-- The same rules, in the same order, as formOf in questionForms.ts.
CREATE FUNCTION public.question_form_of(_question text, _options jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT CASE
    WHEN _question ~ '^\s*Case:' AND _question ~ '\n\s*Question:' THEN 'case_based'
    WHEN _question ~ '(^|\n)[ \t]*List I([ \t]*\([^)\n]*\))?[ \t]*:[ \t]*(\n|$)'
     AND _question ~ '(^|\n)[ \t]*List II([ \t]*\([^)\n]*\))?[ \t]*:[ \t]*(\n|$)' THEN 'match'
    WHEN _question ~ 'Assertion\s*\(A\)\s*:' AND _question ~ 'Reason\s*\(R\)\s*:' THEN 'assertion_reason'
    WHEN (SELECT count(*) FROM regexp_matches(_question, '(^|\n)[ \t]*(I|II|III|IV|V|VI|VII|VIII)\.[ \t]+\S', 'g')) >= 2 THEN
      CASE WHEN jsonb_typeof(_options) = 'array' AND jsonb_array_length(_options) > 0
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(_options) o(v)
               WHERE v !~ '^\s*\(?(I|II|III|IV|V|VI|VII|VIII)\)?(\s*(,|→|->|–|-)\s*\(?(I|II|III|IV|V|VI|VII|VIII)\)?){2,}\s*\.?\s*$')
           THEN 'sequence' ELSE 'statements' END
    ELSE 'mcq'
  END
$fn$;

COMMENT ON FUNCTION public.question_form_of(text, jsonb) IS
  'The form of a multiple-choice question, read from the layout its text is written in (20261141000000; questionForms.ts writes and reads that layout).';

GRANT EXECUTE ON FUNCTION public.question_form_of(text, jsonb) TO authenticated, service_role;

-- A multiple-choice row's form is its text's; written questions (short,
-- long, numerical) keep what they were given.
CREATE FUNCTION public._question_bank_form()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF jsonb_typeof(NEW.options) = 'array' AND NEW.correct_index IS NOT NULL THEN
    NEW.question_format := public.question_form_of(NEW.question, NEW.options);
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_question_bank_form
  BEFORE INSERT OR UPDATE OF question, options, correct_index, question_format ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public._question_bank_form();

-- ── 3. The imported fifth option, cut where it is not the answer ───────────
UPDATE public.question_bank
   SET options = jsonb_set(options, '{3}', to_jsonb(btrim(regexp_replace(options->>3,
         '\s*(\(\s*[eE]\s*\)\s*Both A and R are (incorrect|false)\.?|Statement Based Questions)\s*$', '')))),
       updated_at = now()
 WHERE jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 4
   AND question ~ 'Assertion\s*\(A\)\s*:' AND question ~ 'Reason\s*\(R\)\s*:'
   AND correct_index <> 3
   AND options->>3 ~ '\s*(\(\s*[eE]\s*\)\s*Both A and R are (incorrect|false)\.?|Statement Based Questions)\s*$';

UPDATE public.question_bank
   SET explanation_status = 'disputed', explanation_claimed_at = NULL,
       review_note = concat_ws(E'\n', nullif(btrim(review_note), ''),
         'Import 2026-10-03: option D carries a fifth option, "(e) Both A and R are incorrect", and D is the key — the key may have been (e). Kept as it stands for a ruling (20261141000000).'),
       updated_at = now()
 WHERE jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 4
   AND question ~ 'Assertion\s*\(A\)\s*:' AND question ~ 'Reason\s*\(R\)\s*:'
   AND correct_index = 3
   AND options->>3 ~ '\(\s*[eE]\s*\)\s*Both A and R are (incorrect|false)';

-- ── 4. Every multiple-choice row, classified once ───────────────────────────
UPDATE public.question_bank
   SET question_format = public.question_form_of(question, options)
 WHERE jsonb_typeof(options) = 'array' AND correct_index IS NOT NULL
   AND question_format IS DISTINCT FROM public.question_form_of(question, options);

-- ── 5. AI Practice can be asked for one form ────────────────────────────────
DROP FUNCTION public.ai_practice_bank_candidates(uuid, uuid, uuid, uuid, text, vector, integer);

CREATE FUNCTION public.ai_practice_bank_candidates(
  _user uuid, _exam uuid, _chapter uuid, _topic uuid, _difficulty text, _form text, _query vector, _limit integer)
RETURNS TABLE (id uuid, similarity double precision, topic_id uuid, difficulty text)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT qb.id,
         CASE WHEN _query IS NULL OR qb.embedding IS NULL THEN NULL
              ELSE 1 - (qb.embedding <=> _query) END,
         qb.topic_id,
         qb.difficulty
    FROM public.question_bank qb
   WHERE qb.exam_id = _exam
     AND qb.chapter_id = _chapter
     AND (_topic IS NULL OR qb.topic_id = _topic)
     AND (_difficulty IS NULL OR qb.difficulty = _difficulty)
     AND (_form IS NULL OR qb.question_format = _form)
     AND qb.is_active AND qb.is_approved
     AND qb.replaced_by_question_id IS NULL
     AND qb.variant_tier IS NULL
     AND qb.correct_index IS NOT NULL
     AND jsonb_typeof(qb.options) = 'array'
     AND NOT EXISTS (
       SELECT 1 FROM public.question_attempts qa
        WHERE qa.user_id = _user AND qa.bank_question_id = qb.id
          AND qa.created_at > now() - interval '30 days')
   ORDER BY CASE WHEN _query IS NULL OR qb.embedding IS NULL THEN 1 ELSE 0 END,
            qb.embedding <=> _query,
            md5(qb.id::text || current_date::text)
   LIMIT greatest(1, least(_limit, 200));
$fn$;

REVOKE ALL ON FUNCTION public.ai_practice_bank_candidates(uuid, uuid, uuid, uuid, text, text, vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_practice_bank_candidates(uuid, uuid, uuid, uuid, text, text, vector, integer) TO service_role;

ALTER TABLE public.ai_practice_requests
  ADD COLUMN form text
    CONSTRAINT ai_practice_requests_form_check
    CHECK (form IS NULL OR form IN ('mcq', 'assertion_reason', 'statements', 'match', 'case_based', 'sequence'));

COMMENT ON COLUMN public.ai_practice_requests.form IS
  'The one form the student asked for ("assertion reason questions"), or NULL for the mix the exam uses (20261141000000).';

-- ── VERIFY: the shape (must be able to fail) ────────────────────────────────
DO $verify$
DECLARE _n integer;
BEGIN
  SELECT count(*) INTO _n FROM public.question_bank
   WHERE jsonb_typeof(options) = 'array' AND correct_index IS NOT NULL
     AND question_format IS DISTINCT FROM public.question_form_of(question, options);
  IF _n <> 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % multiple-choice rows disagree with their text''s form', _n; END IF;
  SELECT count(*) INTO _n FROM public.question_bank
   WHERE is_active AND question_format = 'assertion_reason';
  IF _n < 40 THEN RAISE EXCEPTION 'VERIFY FAILED: only % assertion–reason questions classified (42 measured)', _n; END IF;
  SELECT count(*) INTO _n FROM public.question_bank
   WHERE question ~ 'Assertion\s*\(A\)\s*:' AND correct_index <> 3
     AND options->>3 ~ '(\(\s*[eE]\s*\)\s*Both A and R are|Statement Based Questions)';
  IF _n <> 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % assertion–reason questions still carry the imported fifth option', _n; END IF;
  IF has_function_privilege('authenticated', 'public.ai_practice_bank_candidates(uuid, uuid, uuid, uuid, text, text, vector, integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ai_practice_bank_candidates(uuid, uuid, uuid, uuid, text, text, vector, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the bank candidates door is open to students, or shut to the function';
  END IF;
END $verify$;

-- ── PROOF: the fixtures, the trigger and the form filter; rolled back ──────
DO $proof$
DECLARE
  -- FIXTURES — questionForms.test.ts reads this array: composeQuestion(parts)
  -- must give the text, and formOf(text, options) the form, as below.
  _fixtures constant jsonb := $json$[
    {"form": "assertion_reason",
     "parts": {"form": "assertion_reason", "assertion": "Goodwill is an intangible asset of a firm.", "reason": "Goodwill cannot be seen or touched but has a value."},
     "text": "Assertion (A): Goodwill is an intangible asset of a firm.\nReason (R): Goodwill cannot be seen or touched but has a value.",
     "options": ["Both A and R are true, and R is the correct explanation of A.", "Both A and R are true, but R is not the correct explanation of A.", "A is true, but R is false.", "A is false, but R is true."]},
    {"form": "statements",
     "parts": {"form": "statements", "intro": "Consider the following statements about a partnership deed:", "statements": ["It may be oral or written.", "It must be registered with the Registrar of Firms.", "It settles the ratio in which profits are shared."], "ask": "Which of the statements given above are correct?"},
     "text": "Consider the following statements about a partnership deed:\nI. It may be oral or written.\nII. It must be registered with the Registrar of Firms.\nIII. It settles the ratio in which profits are shared.\nWhich of the statements given above are correct?",
     "options": ["I and II only", "I and III only", "II and III only", "I, II and III"]},
    {"form": "sequence",
     "parts": {"form": "sequence", "intro": "Arrange the steps of issuing shares in the order in which they happen:", "items": ["Allotment of shares", "Receipt of applications", "Issue of prospectus", "Calls on shares"], "ask": "Choose the correct order:"},
     "text": "Arrange the steps of issuing shares in the order in which they happen:\nI. Allotment of shares\nII. Receipt of applications\nIII. Issue of prospectus\nIV. Calls on shares\nChoose the correct order:",
     "options": ["III, II, I, IV", "II, III, I, IV", "III, I, II, IV", "I, II, III, IV"]},
    {"form": "match",
     "parts": {"form": "match", "intro": "Match List I with List II:", "list1Title": "Ratio", "list1": ["Current ratio", "Quick ratio", "Debt-equity ratio"], "list2Title": "Type", "list2": ["Solvency ratio", "Liquidity ratio", "Acid-test ratio"], "ask": "Choose the correct answer from the options given below:"},
     "text": "Match List I with List II:\nList I (Ratio):\nA. Current ratio\nB. Quick ratio\nC. Debt-equity ratio\nList II (Type):\nI. Solvency ratio\nII. Liquidity ratio\nIII. Acid-test ratio\nChoose the correct answer from the options given below:",
     "options": ["A-II, B-III, C-I", "A-I, B-II, C-III", "A-III, B-II, C-I", "A-II, B-I, C-III"]},
    {"form": "case_based",
     "parts": {"form": "case_based", "passage": "Asha and Binu are partners sharing profits equally. On 1 April they admitted Chetan for a one-fourth share of future profits. Chetan brought ₹40,000 in cash as his share of goodwill, and the old partners agreed to share it in their sacrificing ratio.", "ask": "In what ratio will Asha and Binu share the premium brought in by Chetan?"},
     "text": "Case: Asha and Binu are partners sharing profits equally. On 1 April they admitted Chetan for a one-fourth share of future profits. Chetan brought ₹40,000 in cash as his share of goodwill, and the old partners agreed to share it in their sacrificing ratio.\nQuestion: In what ratio will Asha and Binu share the premium brought in by Chetan?",
     "options": ["1:1", "3:1", "2:1", "1:3"]},
    {"form": "mcq",
     "parts": {"form": "mcq", "stem": "What is the ideal current ratio?"},
     "text": "What is the ideal current ratio?",
     "options": ["1:1", "2:1", "1:2", "3:1"]},
    {"form": "assertion_reason",
     "text": "Assertion (A): On dissolution, goodwill is transferred to the Realisation Account. Reason (R): Goodwill is treated like other assets on dissolution.",
     "options": ["Both A and R are true, and R is the correct explanation of A.", "Both A and R are true, but R is not the correct explanation of A.", "A is true, but R is false.", "A is false, but R is true."]},
    {"form": "mcq",
     "text": "If a company's Proprietors' Funds are ₹5,00,000, what are its Net Assets?\nA. ₹3,00,000\nB. ₹7,00,000\nC. ₹5,00,000\nD. ₹2,00,000",
     "options": ["₹3,00,000", "₹7,00,000", "₹5,00,000", "₹2,00,000"]},
    {"form": "mcq",
     "text": "Match the items given in List-I with List-II: List-I List-II",
     "options": ["Selection (I)", "Orientation (II)", "Recruitment (III)", "Training (IV)"]},
    {"form": "mcq",
     "text": "Which of these is a statement of fact?\nI. Only one numbered line.",
     "options": ["a", "b", "c", "d"]}
  ]$json$;
  _fail text := '';
  _sentinel constant text := 'm20261141 proof rolled back';
  _f jsonb; _got text; _exam constant uuid := '5a78f1f8-cf43-4631-a9de-4abc7d6a8d9d';
  _topic uuid; _user uuid; _r jsonb; _id uuid; _n integer;
BEGIN
  -- 1. Each fixture is the form it says.
  FOR _f IN SELECT * FROM jsonb_array_elements(_fixtures) LOOP
    _got := public.question_form_of(_f->>'text', _f->'options');
    IF _got IS DISTINCT FROM _f->>'form' THEN
      _fail := _fail || format(' [1 %s read as %s: %s]', _f->>'form', _got, left(_f->>'text', 60));
    END IF;
  END LOOP;

  SELECT st.user_id, t.id INTO _user, _topic
    FROM public.students st
    JOIN public.schools s ON s.id = st.school_id AND s.kind = 'individual'
    JOIN public.exam_accounts ea ON ea.school_id = st.school_id AND ea.exam_id = _exam
    JOIN public.exam_syllabus_chapters sc ON sc.exam_id = ea.exam_id AND sc.stream = ea.stream
    JOIN public.topics t ON t.chapter_id = sc.chapter_id
   WHERE st.user_id IS NOT NULL
   ORDER BY st.user_id, t.id LIMIT 1;
  IF _topic IS NULL THEN RAISE EXCEPTION 'PROOF FAILED: fixture missing (a topic of an exam account''s syllabus)'; END IF;

  BEGIN
    -- 2. A question written through the one door is filed under its form…
    _r := public.store_generated_questions((
      SELECT jsonb_agg(jsonb_build_object('topic_id', _topic, 'exam_id', _exam, 'question', f->>'text',
               'options', f->'options', 'correct_index', 0, 'difficulty', 'medium', 'source', 'ai_practice'))
        FROM jsonb_array_elements(_fixtures) f WHERE f ? 'parts' AND f->>'form' = 'match'));
    _id := (_r->'inserted'->0->>'id')::uuid;
    IF (SELECT question_format FROM public.question_bank WHERE id = _id) IS DISTINCT FROM 'match' THEN
      _fail := _fail || ' [2 a stored match question is not filed as match: ' || _r::text || ']';
    END IF;
    -- …whatever a writer says its form is, and it follows its text.
    UPDATE public.question_bank SET question_format = 'mcq' WHERE id = _id;
    IF (SELECT question_format FROM public.question_bank WHERE id = _id) <> 'match' THEN
      _fail := _fail || ' [2 a writer overrode the form the text has]';
    END IF;
    UPDATE public.question_bank SET question = (SELECT f->>'text' FROM jsonb_array_elements(_fixtures) f WHERE f->>'form' = 'assertion_reason' LIMIT 1)
     WHERE id = _id;
    IF (SELECT question_format FROM public.question_bank WHERE id = _id) <> 'assertion_reason' THEN
      _fail := _fail || ' [2 a new text did not bring its form]';
    END IF;
    -- A written (non-choice) question keeps the form it was given.
    UPDATE public.question_bank SET options = NULL, correct_index = NULL, answer = 'A worked answer.', question_format = 'long' WHERE id = _id;
    IF (SELECT question_format FROM public.question_bank WHERE id = _id) <> 'long' THEN
      _fail := _fail || ' [2 a written question lost its form]';
    END IF;

    -- 3. AI Practice can ask the bank for one form only.
    UPDATE public.question_bank SET options = (SELECT f->'options' FROM jsonb_array_elements(_fixtures) f WHERE f->>'form' = 'assertion_reason' LIMIT 1),
           correct_index = 0, answer = NULL WHERE id = _id;
    SELECT count(*) INTO _n FROM public.ai_practice_bank_candidates(_user, _exam,
      (SELECT chapter_id FROM public.question_bank WHERE id = _id), NULL, NULL, 'assertion_reason', NULL, 200) c WHERE c.id = _id;
    IF _n <> 1 THEN _fail := _fail || ' [3 an assertion–reason question was not offered for that form]'; END IF;
    SELECT count(*) INTO _n FROM public.ai_practice_bank_candidates(_user, _exam,
      (SELECT chapter_id FROM public.question_bank WHERE id = _id), NULL, NULL, 'match', NULL, 200) c WHERE c.id = _id;
    IF _n <> 0 THEN _fail := _fail || ' [3 an assertion–reason question was offered as a match question]'; END IF;

    RAISE EXCEPTION USING MESSAGE = _sentinel;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> _sentinel THEN
      RAISE EXCEPTION 'PROOF FAILED (unexpected %): %', SQLSTATE, SQLERRM;
    END IF;
  END;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'PROOF FAILED:%', _fail;
  END IF;
END $proof$;

COMMIT;
