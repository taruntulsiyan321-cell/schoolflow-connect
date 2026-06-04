-- Combined pending migrations
ALTER TABLE public.battle_questions
  ADD COLUMN IF NOT EXISTS bank_question_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.student_question_history (
  user_id      uuid NOT NULL,
  question_id  uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  times_seen   int  NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_sqh_user ON public.student_question_history(user_id, last_seen_at DESC);
GRANT SELECT ON public.student_question_history TO authenticated;
GRANT ALL ON public.student_question_history TO service_role;
ALTER TABLE public.student_question_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sqh self read" ON public.student_question_history;
CREATE POLICY "sqh self read" ON public.student_question_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.student_xp
  ADD COLUMN IF NOT EXISTS best_score      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_correct   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_answered  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS win_streak      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_win_streak int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public._award_badge(_uid uuid, _code text, _tier public.badge_tier DEFAULT 'bronze')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.student_badges(user_id, badge_code, tier)
  VALUES (_uid, _code, _tier)
  ON CONFLICT (user_id, badge_code) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION public.rpc_generate_battle(_battle_id uuid, _count int DEFAULT 5)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _b   record;
  _uid uuid := auth.uid();
  _inserted int := 0;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;
  IF _b.creator_user_id <> _uid
     AND NOT has_role(_uid,'admin') AND NOT has_role(_uid,'teacher') THEN
    RAISE EXCEPTION 'Not your battle';
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty,
           COALESCE(h.times_seen, 0)                     AS seen,
           COALESCE(h.last_seen_at, 'epoch'::timestamptz) AS last_seen
    FROM public.question_bank q
    LEFT JOIN public.student_question_history h
      ON h.question_id = q.id AND h.user_id = _uid
    WHERE q.is_approved
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      AND (_b.class_level IS NULL OR q.class_level IS NULL OR q.class_level = _b.class_level)
  ), picked AS (
    SELECT id, question, options, correct_index
    FROM pool
    ORDER BY
      seen ASC,
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
      last_seen ASC,
      random()
    LIMIT GREATEST(_count, 1)
  ), ins AS (
    INSERT INTO public.battle_questions
      (battle_id, order_index, question, options, correct_index, points, bank_question_id)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10, id
    FROM picked
    RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles
    SET source = 'bank', question_count = _inserted, duration_sec = per_question_sec * _inserted
    WHERE id = _battle_id;
  RETURN _inserted;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_finish_battle(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid; _battle uuid; _score int; _correct int; _answered int; _time int;
  _won boolean := false; _max_score int; _xp record; _avg_ms numeric; _hour int;
BEGIN
  SELECT user_id, battle_id, score, correct_count, answered_count, total_time_ms
    INTO _user, _battle, _score, _correct, _answered, _time
    FROM public.battle_participants WHERE id = _participant_id;
  IF _user IS NULL OR _user <> auth.uid() THEN RAISE EXCEPTION 'Not your participation'; END IF;

  UPDATE public.battle_participants SET finished_at = COALESCE(finished_at, now()) WHERE id = _participant_id;

  WITH ranked AS (
    SELECT id, RANK() OVER (ORDER BY score DESC, total_time_ms ASC) AS r
    FROM public.battle_participants WHERE battle_id = _battle
  )
  UPDATE public.battle_participants p SET rank = r.r FROM ranked r WHERE p.id = r.id;

  SELECT MAX(score) INTO _max_score FROM public.battle_participants WHERE battle_id = _battle;
  _won := (_score = _max_score AND _score > 0);

  INSERT INTO public.student_question_history (user_id, question_id, times_seen, last_seen_at)
  SELECT _user, bq.bank_question_id, 1, now()
  FROM public.battle_answers ba
  JOIN public.battle_questions bq ON bq.id = ba.question_id
  WHERE ba.participant_id = _participant_id AND bq.bank_question_id IS NOT NULL
  ON CONFLICT (user_id, question_id) DO UPDATE
    SET times_seen = student_question_history.times_seen + 1, last_seen_at = now();

  INSERT INTO public.student_xp(user_id, xp, level, total_battles, wins, last_battle_at,
    best_score, total_correct, total_answered, win_streak, best_win_streak)
  VALUES (_user, _score, 1 + (_score/100), 1, CASE WHEN _won THEN 1 ELSE 0 END, now(),
    _score, _correct, _answered, CASE WHEN _won THEN 1 ELSE 0 END, CASE WHEN _won THEN 1 ELSE 0 END)
  ON CONFLICT (user_id) DO UPDATE SET
    xp              = student_xp.xp + EXCLUDED.xp,
    level           = 1 + ((student_xp.xp + EXCLUDED.xp)/100),
    total_battles   = student_xp.total_battles + 1,
    wins            = student_xp.wins + CASE WHEN _won THEN 1 ELSE 0 END,
    last_battle_at  = now(),
    best_score      = GREATEST(student_xp.best_score, _score),
    total_correct   = student_xp.total_correct + _correct,
    total_answered  = student_xp.total_answered + _answered,
    win_streak      = CASE WHEN _won THEN student_xp.win_streak + 1 ELSE 0 END,
    best_win_streak = GREATEST(student_xp.best_win_streak,
                               CASE WHEN _won THEN student_xp.win_streak + 1 ELSE 0 END),
    updated_at      = now();

  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _user;
  _avg_ms := CASE WHEN _answered > 0 THEN _time::numeric / _answered ELSE NULL END;
  _hour   := EXTRACT(HOUR FROM now());

  IF _won THEN PERFORM public._award_badge(_user,'first_win','bronze'); END IF;
  IF _correct >= 5 THEN PERFORM public._award_badge(_user,'sharp_shooter','silver'); END IF;
  IF _answered >= 5 AND _correct = _answered THEN PERFORM public._award_badge(_user,'flawless','gold'); END IF;
  IF _avg_ms IS NOT NULL AND _avg_ms <= 5000 AND _correct >= 3 THEN PERFORM public._award_badge(_user,'speed_master','gold'); END IF;
  IF _avg_ms IS NOT NULL AND _avg_ms <= 3000 AND _correct >= 5 THEN PERFORM public._award_badge(_user,'lightning','platinum'); END IF;
  IF _xp.wins >= 5   THEN PERFORM public._award_badge(_user,'quiz_winner','silver'); END IF;
  IF _xp.wins >= 25  THEN PERFORM public._award_badge(_user,'battleground_master','gold'); END IF;
  IF _xp.wins >= 100 THEN PERFORM public._award_badge(_user,'arena_legend','platinum'); END IF;
  IF _xp.win_streak >= 3  THEN PERFORM public._award_badge(_user,'win_streak_3','silver'); END IF;
  IF _xp.win_streak >= 5  THEN PERFORM public._award_badge(_user,'win_streak_5','gold'); END IF;
  IF _xp.win_streak >= 10 THEN PERFORM public._award_badge(_user,'win_streak_10','platinum'); END IF;
  IF _xp.total_battles >= 10 THEN PERFORM public._award_badge(_user,'gladiator','bronze'); END IF;
  IF _xp.total_battles >= 50 THEN PERFORM public._award_badge(_user,'veteran','gold'); END IF;
  IF _hour < 5 THEN PERFORM public._award_badge(_user,'night_owl','silver'); END IF;
  IF _hour >= 5 AND _hour < 8 THEN PERFORM public._award_badge(_user,'early_bird','silver'); END IF;
  IF _score >= 150 THEN PERFORM public._award_badge(_user,'high_scorer','gold'); END IF;
  IF _score >= 300 THEN PERFORM public._award_badge(_user,'unstoppable','platinum'); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_challenge_student(
  _opponent_user_id uuid,
  _subject text,
  _difficulty text DEFAULT 'medium',
  _count int DEFAULT 5,
  _per_q int DEFAULT 20,
  _chapter text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(auth.uid());
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.battles (title, subject, chapter, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at)
  VALUES (_name || ' challenges you · ' || _subject, _subject, _chapter, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'class', 'bank', now())
  RETURNING id INTO _bid;

  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this subject yet';
  END IF;

  INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id)
  VALUES (_bid, _opponent_user_id, auth.uid())
  ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

  RETURN _bid;
END $$;

DO $seed$
BEGIN
IF (SELECT count(*) FROM public.question_bank) < 20 THEN
  INSERT INTO public.question_bank (class_level, subject, chapter, difficulty, question, options, correct_index, explanation, source) VALUES
  (9,  'Mathematics', 'Number Systems', 'easy',   'Which of the following is a rational number?',                 '["0.75","\u221a2","\u03c0","\u221a3"]'::jsonb, 0, '0.75 = 3/4, a ratio of integers.', 'seed'),
  (9,  'Mathematics', 'Triangles', 'easy',         'The sum of the interior angles of a triangle is:',            '["90\u00b0","180\u00b0","270\u00b0","360\u00b0"]'::jsonb, 1, 'Angle sum property of a triangle.', 'seed'),
  (9,  'Mathematics', 'Mensuration', 'medium',     'The area of a circle of radius r is:',                         '["2\u03c0r","\u03c0r\u00b2","\u03c0d","2\u03c0r\u00b2"]'::jsonb, 1, 'Area = \u03c0r\u00b2.', 'seed'),
  (10, 'Mathematics', 'Quadratic Equations', 'medium', 'The discriminant of ax\u00b2 + bx + c = 0 is:',            '["b\u00b2 \u2212 4ac","2a","\u2212b/2a","b\u00b2 + 4ac"]'::jsonb, 0, 'Discriminant D = b\u00b2 \u2212 4ac.', 'seed'),
  (10, 'Mathematics', 'Real Numbers', 'easy',      'The HCF of 12 and 18 is:',                                     '["6","12","3","9"]'::jsonb, 0, '12 = 2\u00b2\u00d73, 18 = 2\u00d73\u00b2, HCF = 2\u00d73 = 6.', 'seed'),
  (10, 'Mathematics', 'Trigonometry', 'medium',    'The value of sin 30\u00b0 is:',                                '["1/2","\u221a3/2","1","0"]'::jsonb, 0, 'sin 30\u00b0 = 1/2.', 'seed'),
  (11, 'Mathematics', 'Calculus', 'medium',        'The derivative of x\u00b2 with respect to x is:',              '["2x","x","x\u00b2/2","2"]'::jsonb, 0, 'd/dx(x\u00b2) = 2x.', 'seed'),
  (11, 'Mathematics', 'Logarithms', 'easy',        'The value of log\u2081\u2080(1) is:',                          '["1","0","10","Undefined"]'::jsonb, 1, 'log of 1 to any base is 0.', 'seed'),
  (12, 'Mathematics', 'Integration', 'medium',     'The value of \u222b 1 dx is:',                                 '["x + C","1","0","x\u00b2"]'::jsonb, 0, 'Integral of 1 is x + C.', 'seed'),
  (12, 'Mathematics', 'Exponentials', 'easy',      'The value of e\u2070 is:',                                     '["0","1","e","\u221e"]'::jsonb, 1, 'Any non-zero number to the power 0 is 1.', 'seed'),
  (9,  'Physics', 'Force and Laws of Motion', 'easy', 'The SI unit of force is:',                                  '["Newton","Joule","Watt","Pascal"]'::jsonb, 0, 'Force is measured in newtons (N).', 'seed'),
  (9,  'Physics', 'Gravitation', 'easy',           'The acceleration due to gravity on Earth is approximately:',   '["9.8 m/s\u00b2","8.9 m/s\u00b2","10.8 m/s\u00b2","6.7 m/s\u00b2"]'::jsonb, 0, 'g \u2248 9.8 m/s\u00b2.', 'seed'),
  (10, 'Physics', 'Electricity', 'medium',         'Ohm''s law is expressed as:',                                  '["V = IR","V = I/R","V = R/I","V = I + R"]'::jsonb, 0, 'Voltage = Current \u00d7 Resistance.', 'seed'),
  (10, 'Physics', 'Electricity', 'easy',           'The SI unit of electric current is:',                          '["Ampere","Volt","Ohm","Watt"]'::jsonb, 0, 'Current is measured in amperes (A).', 'seed'),
  (11, 'Physics', 'Units and Measurement', 'medium','Which of the following is a vector quantity?',                '["Speed","Mass","Velocity","Time"]'::jsonb, 2, 'Velocity has both magnitude and direction.', 'seed'),
  (11, 'Physics', 'Work, Energy and Power', 'easy', 'The SI unit of work is:',                                     '["Joule","Newton","Watt","Pascal"]'::jsonb, 0, 'Work is measured in joules (J).', 'seed'),
  (12, 'Physics', 'Electrostatics', 'medium',      'The SI unit of capacitance is:',                               '["Farad","Henry","Tesla","Weber"]'::jsonb, 0, 'Capacitance is measured in farads (F).', 'seed'),
  (9,  'Chemistry', 'Atoms and Molecules', 'easy', 'The chemical symbol for sodium is:',                           '["Na","S","So","Sd"]'::jsonb, 0, 'Sodium = Na (from Latin natrium).', 'seed'),
  (9,  'Chemistry', 'Matter', 'easy',              'Water is made up of hydrogen and:',                            '["Oxygen","Nitrogen","Carbon","Helium"]'::jsonb, 0, 'Water is H\u2082O.', 'seed'),
  (10, 'Chemistry', 'Acids, Bases and Salts', 'easy', 'The pH of a neutral solution is:',                         '["7","0","14","1"]'::jsonb, 0, 'Neutral pH = 7.', 'seed'),
  (10, 'Chemistry', 'Acids, Bases and Salts', 'easy', 'The chemical formula of common salt is:',                  '["NaCl","KCl","HCl","NaOH"]'::jsonb, 0, 'Common salt is sodium chloride, NaCl.', 'seed'),
  (11, 'Chemistry', 'Structure of Atom', 'easy',   'The atomic number of carbon is:',                              '["6","12","8","14"]'::jsonb, 0, 'Carbon has 6 protons.', 'seed'),
  (11, 'Chemistry', 'Periodic Table', 'medium',    'The most electronegative element is:',                         '["Fluorine","Oxygen","Chlorine","Nitrogen"]'::jsonb, 0, 'Fluorine is the most electronegative.', 'seed'),
  (12, 'Chemistry', 'p-Block Elements', 'medium',  'Which gas is commonly known as laughing gas?',                 '["Nitrous oxide (N\u2082O)","Carbon dioxide","Oxygen","Nitrogen dioxide"]'::jsonb, 0, 'N\u2082O is laughing gas.', 'seed'),
  (9,  'Biology', 'The Fundamental Unit of Life', 'easy', 'The basic structural unit of life is the:',             '["Cell","Atom","Tissue","Organ"]'::jsonb, 0, 'The cell is the basic unit of life.', 'seed'),
  (9,  'Biology', 'The Fundamental Unit of Life', 'easy', 'The "powerhouse of the cell" is the:',                  '["Mitochondria","Nucleus","Ribosome","Golgi body"]'::jsonb, 0, 'Mitochondria produce ATP.', 'seed'),
  (10, 'Biology', 'Life Processes', 'easy',        'Which organ pumps blood throughout the body?',                 '["Heart","Liver","Lungs","Kidney"]'::jsonb, 0, 'The heart pumps blood.', 'seed'),
  (10, 'Biology', 'Life Processes', 'easy',        'The green pigment in plants responsible for photosynthesis is:', '["Chlorophyll","Hemoglobin","Carotene","Melanin"]'::jsonb, 0, 'Chlorophyll captures light energy.', 'seed'),
  (11, 'Biology', 'Human Physiology', 'easy',      'How many chambers does the human heart have?',                 '["4","2","3","1"]'::jsonb, 0, 'Two atria and two ventricles.', 'seed'),
  (12, 'Biology', 'Molecular Basis of Inheritance', 'medium', 'DNA stands for:',                                   '["Deoxyribonucleic acid","Dinucleic acid","Deoxyribose acid","Diribonucleic acid"]'::jsonb, 0, 'DNA = Deoxyribonucleic acid.', 'seed'),
  (NULL, 'English', 'Vocabulary', 'easy',          'Choose the correct synonym of "happy".',                       '["Joyful","Sad","Angry","Tired"]'::jsonb, 0, 'Joyful means happy.', 'seed'),
  (NULL, 'English', 'Grammar', 'easy',             'The plural of "child" is:',                                    '["Children","Childs","Childes","Child"]'::jsonb, 0, 'Irregular plural: children.', 'seed'),
  (NULL, 'English', 'Grammar', 'easy',             'Which word is a noun?',                                         '["Run","Beautiful","Dog","Quickly"]'::jsonb, 2, 'A dog is a person, place or thing \u2014 a noun.', 'seed'),
  (NULL, 'English', 'Vocabulary', 'medium',        'Choose the antonym of "ancient".',                             '["Modern","Old","Antique","Historic"]'::jsonb, 0, 'Modern is the opposite of ancient.', 'seed'),
  (NULL, 'English', 'Grammar', 'medium',           'Identify the verb: "She sings beautifully."',                  '["sings","She","beautifully","none"]'::jsonb, 0, '"Sings" is the action word.', 'seed'),
  (NULL, 'Computer Science', 'Fundamentals', 'easy', 'What does CPU stand for?',                                   '["Central Processing Unit","Central Print Unit","Computer Personal Unit","Control Process Unit"]'::jsonb, 0, 'CPU = Central Processing Unit.', 'seed'),
  (NULL, 'Computer Science', 'Fundamentals', 'easy', 'Which of these is an input device?',                         '["Keyboard","Monitor","Printer","Speaker"]'::jsonb, 0, 'A keyboard inputs data.', 'seed'),
  (NULL, 'Computer Science', 'Number Systems', 'easy', 'The binary number system uses the digits:',               '["0 and 1","0 to 9","1 and 2","0 to 7"]'::jsonb, 0, 'Binary is base-2: 0 and 1.', 'seed'),
  (NULL, 'Computer Science', 'Web', 'medium',      'HTML is primarily used to:',                                   '["Structure web pages","Style web pages","Manage databases","Run an operating system"]'::jsonb, 0, 'HTML structures content; CSS styles it.', 'seed'),
  (NULL, 'Social Studies', 'Civics', 'easy',       'What is the capital of India?',                                '["New Delhi","Mumbai","Kolkata","Chennai"]'::jsonb, 0, 'New Delhi is the capital of India.', 'seed'),
  (NULL, 'Social Studies', 'History', 'easy',      'Who was the first Prime Minister of India?',                   '["Jawaharlal Nehru","Mahatma Gandhi","Sardar Patel","Subhas Chandra Bose"]'::jsonb, 0, 'Nehru was independent India''s first PM.', 'seed'),
  (NULL, 'Social Studies', 'Geography', 'easy',    'How many continents are there on Earth?',                      '["7","5","6","8"]'::jsonb, 0, 'There are 7 continents.', 'seed'),
  (NULL, 'General Knowledge', 'Science', 'easy',   'Which is the largest planet in our solar system?',             '["Jupiter","Saturn","Earth","Mars"]'::jsonb, 0, 'Jupiter is the largest planet.', 'seed'),
  (NULL, 'General Knowledge', 'Geography', 'medium','The Great Barrier Reef is located off the coast of:',         '["Australia","India","USA","Brazil"]'::jsonb, 0, 'It lies off Queensland, Australia.', 'seed'),
  (12, 'Economics', 'Macroeconomics', 'medium',    'GDP stands for:',                                              '["Gross Domestic Product","Gross Demand Product","General Domestic Price","Gross Domestic Price"]'::jsonb, 0, 'GDP = Gross Domestic Product.', 'seed'),
  (11, 'Accountancy', 'Fundamentals', 'medium',    'The accounting equation is: Assets = Liabilities + ___',       '["Capital","Revenue","Expenses","Drawings"]'::jsonb, 0, 'Assets = Liabilities + Capital (Owner''s equity).', 'seed'),
  (11, 'Accountancy', 'Fundamentals', 'easy',      'Which of the following is a current asset?',                   '["Cash","Building","Machinery","Land"]'::jsonb, 0, 'Cash is a current asset.', 'seed'),
  (11, 'Business Studies', 'Nature of Business', 'easy', 'The primary objective of any business is to earn:',       '["Profit","Loss","Goodwill only","Taxes"]'::jsonb, 0, 'Earning profit is a core business objective.', 'seed'),
  (9,  'Science', 'Mixtures', 'easy',              'Which of the following is a mixture?',                          '["Air","Water","Oxygen","Gold"]'::jsonb, 0, 'Air is a mixture of gases.', 'seed'),
  (10, 'Science', 'Periodic Classification', 'easy','The most abundant gas in Earth''s atmosphere is:',            '["Nitrogen","Oxygen","Carbon dioxide","Hydrogen"]'::jsonb, 0, 'Nitrogen is ~78% of the atmosphere.', 'seed');
END IF;
END $seed$;

CREATE OR REPLACE FUNCTION public.rpc_leaderboard(
  _scope    text DEFAULT 'class',
  _category text DEFAULT 'xp',
  _subject  text DEFAULT NULL,
  _limit    int  DEFAULT 50
)
RETURNS TABLE (
  user_id        uuid,
  full_name      text,
  roll_number    text,
  class_label    text,
  score          numeric,
  detail         text,
  equipped_badge text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cls uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cls := public.student_class_id(auth.uid());

  RETURN QUERY
  WITH base AS (
    SELECT s.user_id AS uid, s.id AS sid, s.class_id AS cid, s.full_name, s.roll_number,
           COALESCE(c.name || '-' || c.section, 'Unassigned') AS class_label
    FROM public.students s
    LEFT JOIN public.classes c ON c.id = s.class_id
    WHERE s.user_id IS NOT NULL
      AND (_scope = 'school' OR s.class_id = _cls)
  ),
  scored AS (
    SELECT
      b.uid, b.full_name, b.roll_number, b.class_label,
      CASE _category
        WHEN 'xp'      THEN COALESCE(x.xp, 0)::numeric
        WHEN 'wins'    THEN COALESCE(x.wins, 0)::numeric
        WHEN 'streak'  THEN COALESCE(x.current_streak, 0)::numeric
        WHEN 'weekly'  THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('week', now())), 0)::numeric
        WHEN 'monthly' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('month', now())), 0)::numeric
        WHEN 'subject' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       JOIN public.battles bt ON bt.id = bp.battle_id
                                       WHERE bp.user_id = b.uid AND _subject IS NOT NULL
                                         AND lower(bt.subject) = lower(_subject)), 0)::numeric
        WHEN 'marks' THEN COALESCE((
            SELECT CASE WHEN SUM(e.max_marks) > 0
                        THEN ROUND(SUM(m.marks_obtained)::numeric / SUM(e.max_marks) * 100, 1) ELSE 0 END
            FROM public.marks m JOIN public.exams e ON e.id = m.exam_id
            WHERE m.student_id = b.sid), 0)::numeric
        WHEN 'attendance' THEN COALESCE((
            SELECT CASE WHEN COUNT(*) > 0
                        THEN ROUND(COUNT(*) FILTER (WHERE a.status = 'present')::numeric / COUNT(*) * 100, 0) ELSE 0 END
            FROM public.attendance a WHERE a.student_id = b.sid), 0)::numeric
        WHEN 'homework' THEN COALESCE((
            SELECT CASE WHEN (SELECT COUNT(*) FROM public.homework h WHERE h.class_id = b.cid) > 0
                        THEN ROUND(
                          (SELECT COUNT(*) FROM public.homework_submissions hs
                             JOIN public.homework h2 ON h2.id = hs.homework_id
                             WHERE hs.student_id = b.sid AND hs.status IN ('submitted','graded') AND h2.class_id = b.cid)::numeric
                          / (SELECT COUNT(*) FROM public.homework h WHERE h.class_id = b.cid) * 100, 0)
                        ELSE 0 END), 0)::numeric
        WHEN 'dpp' THEN COALESCE((
            SELECT ROUND(AVG(best), 0) FROM (
              SELECT MAX(CASE WHEN da.max_score > 0 THEN da.score::numeric / da.max_score * 100 ELSE 0 END) AS best
              FROM public.dpp_attempts da JOIN public.dpps dp ON dp.id = da.dpp_id
              WHERE da.user_id = b.uid AND da.status = 'submitted' AND dp.is_published
              GROUP BY da.dpp_id) t), 0)::numeric
        ELSE COALESCE(x.xp, 0)::numeric
      END AS score,
      CASE _category
        WHEN 'xp'     THEN 'Lvl ' || COALESCE(x.level,1) || ' · ' || COALESCE(x.wins,0) || ' wins'
        WHEN 'wins'   THEN COALESCE(x.total_battles,0) || ' battles'
        WHEN 'streak' THEN COALESCE(x.current_streak,0) || '-day streak'
        ELSE NULL
      END AS detail,
      x.equipped_badge AS equipped_badge
    FROM base b
    LEFT JOIN public.student_xp x ON x.user_id = b.uid
  )
  SELECT s.uid, s.full_name, s.roll_number, s.class_label, s.score, s.detail, s.equipped_badge
  FROM scored s
  ORDER BY s.score DESC, s.full_name ASC
  LIMIT GREATEST(_limit, 1);
END $$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  type       text NOT NULL DEFAULT 'general',
  title      text NOT NULL,
  body       text,
  icon       text,
  link       text,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON public.notifications(user_id) WHERE NOT read;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif self read"   ON public.notifications;
DROP POLICY IF EXISTS "notif self insert" ON public.notifications;
DROP POLICY IF EXISTS "notif self update" ON public.notifications;
DROP POLICY IF EXISTS "notif self delete" ON public.notifications;
CREATE POLICY "notif self read"   ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notif self insert" ON public.notifications FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif self update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif self delete" ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public._notify(
  _uid uuid, _type text, _title text, _body text DEFAULT NULL,
  _icon text DEFAULT NULL, _link text DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications(user_id, type, title, body, icon, link)
  VALUES (_uid, _type, _title, _body, _icon, _link);
$$;

CREATE OR REPLACE FUNCTION public._award_badge(_uid uuid, _code text, _tier public.badge_tier DEFAULT 'bronze')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.student_badges(user_id, badge_code, tier)
  VALUES (_uid, _code, _tier)
  ON CONFLICT (user_id, badge_code) DO NOTHING;
  IF FOUND THEN
    PERFORM public._notify(
      _uid, 'badge', 'Badge unlocked!',
      'You earned a new ' || _tier || ' badge.', 'award',
      '/student/battleground/achievements'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_challenge_student(
  _opponent_user_id uuid,
  _subject text,
  _difficulty text DEFAULT 'medium',
  _count int DEFAULT 5,
  _per_q int DEFAULT 20,
  _chapter text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(auth.uid());
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.battles (title, subject, chapter, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at)
  VALUES (_name || ' challenges you · ' || _subject, _subject, _chapter, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'class', 'bank', now())
  RETURNING id INTO _bid;

  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this subject yet';
  END IF;

  INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id)
  VALUES (_bid, _opponent_user_id, auth.uid())
  ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

  PERFORM public._notify(
    _opponent_user_id, 'invite', 'Battle challenge!',
    _name || ' challenged you to a ' || _subject || ' battle.', 'swords',
    '/student/battleground/battle/' || _bid::text
  );

  RETURN _bid;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_classmates()
RETURNS TABLE (
  user_id        uuid,
  student_id     uuid,
  full_name      text,
  roll_number    text,
  equipped_badge text,
  xp             int,
  level          int,
  wins           int,
  current_streak int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.user_id, s.id, s.full_name, s.roll_number, x.equipped_badge,
         COALESCE(x.xp, 0), COALESCE(x.level, 1), COALESCE(x.wins, 0), COALESCE(x.current_streak, 0)
  FROM public.students s
  LEFT JOIN public.student_xp x ON x.user_id = s.user_id
  WHERE s.class_id = public.student_class_id(auth.uid())
    AND s.user_id IS NOT NULL
    AND s.user_id <> auth.uid()
  ORDER BY s.full_name;
$$;

CREATE TABLE IF NOT EXISTS public.class_timetables (
  class_id   uuid PRIMARY KEY REFERENCES public.classes(id) ON DELETE CASCADE,
  grid       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_timetables TO authenticated;
GRANT ALL ON public.class_timetables TO service_role;
ALTER TABLE public.class_timetables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timetable read"  ON public.class_timetables;
DROP POLICY IF EXISTS "timetable write" ON public.class_timetables;
CREATE POLICY "timetable read" ON public.class_timetables
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "timetable write" ON public.class_timetables
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'principal')
    OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND t.class_teacher_of = class_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'principal')
    OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND t.class_teacher_of = class_id)
  );

CREATE TABLE IF NOT EXISTS public.app_settings (
  id              boolean PRIMARY KEY DEFAULT true,
  school_name     text    NOT NULL DEFAULT 'Vidyalaya Public School',
  locale          text    NOT NULL DEFAULT 'en-IN',
  currency        text    NOT NULL DEFAULT 'INR',
  enable_notices  boolean NOT NULL DEFAULT true,
  enable_fees     boolean NOT NULL DEFAULT true,
  enable_leaves   boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  CONSTRAINT app_settings_singleton CHECK (id)
);
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

INSERT INTO public.app_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app settings read" ON public.app_settings;
CREATE POLICY "app settings read" ON public.app_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "app settings write" ON public.app_settings;
CREATE POLICY "app settings write" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
