-- ============================================================================
-- Academic taxonomy v2 — full commerce bank concepts + chapters
-- Companion: src/academic/taxonomy (presentAcademicLabel / formatAcademicLabel)
-- Apply in Supabase SQL editor (idempotent upserts)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.academic_taxonomy_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('board','class_level','subject','chapter','topic','concept','question_type')),
  term_id text NOT NULL,
  display_name text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  board text NULL,
  class_level int NULL,
  subject text NULL,
  parent_term_id text NULL,
  description text NULL,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, term_id)
);

CREATE INDEX IF NOT EXISTS academic_taxonomy_terms_kind_idx
  ON public.academic_taxonomy_terms (kind);
CREATE INDEX IF NOT EXISTS academic_taxonomy_terms_subject_idx
  ON public.academic_taxonomy_terms (subject) WHERE subject IS NOT NULL;

ALTER TABLE public.academic_taxonomy_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academic_taxonomy_terms_select_authenticated ON public.academic_taxonomy_terms;
CREATE POLICY academic_taxonomy_terms_select_authenticated
  ON public.academic_taxonomy_terms FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS academic_taxonomy_terms_write_operators ON public.academic_taxonomy_terms;
CREATE POLICY academic_taxonomy_terms_write_operators
  ON public.academic_taxonomy_terms FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'teacher')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'teacher')
  );

-- Subjects
INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('subject', 'accountancy', 'Accountancy', '["accounts","accounting"]'::jsonb, 'rbse'),
  ('subject', 'business_studies', 'Business Studies', '["bst"]'::jsonb, 'rbse'),
  ('subject', 'economics', 'Economics', '["eco"]'::jsonb, 'rbse'),
  ('subject', 'mathematics', 'Mathematics', '["maths","math"]'::jsonb, 'rbse'),
  ('subject', 'english', 'English', '[]'::jsonb, 'rbse'),
  ('subject', 'hindi', 'Hindi', '[]'::jsonb, 'rbse'),
  ('subject', 'physics', 'Physics', '[]'::jsonb, 'rbse'),
  ('subject', 'chemistry', 'Chemistry', '[]'::jsonb, 'rbse'),
  ('subject', 'biology', 'Biology', '[]'::jsonb, 'rbse'),
  ('subject', 'computer_science', 'Computer Science', '["cs"]'::jsonb, 'rbse'),
  ('subject', 'informatics_practices', 'Informatics Practices', '["ip"]'::jsonb, 'rbse'),
  ('subject', 'social_science', 'Social Science', '["sst","social studies"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

-- Chapters from live QB
INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
VALUES
  ('chapter', 'accounting_for_partnership_basic_concepts', 'Accounting for Partnership - Basic Concepts', '[]'::jsonb, 'rbse', 12, 'Accountancy', 'accountancy'),
  ('chapter', 'accounting_for_share_capital', 'Accounting for Share Capital', '[]'::jsonb, 'rbse', 12, 'Accountancy', 'accountancy'),
  ('chapter', 'accounting_ratios', 'Accounting Ratios', '[]'::jsonb, 'rbse', 12, 'Accountancy', 'accountancy'),
  ('chapter', 'analysis_of_financial_statements', 'Analysis of Financial Statements', '[]'::jsonb, 'rbse', 12, 'Accountancy', 'accountancy'),
  ('chapter', 'bank_reconciliation_statement', 'Bank Reconciliation Statement', '[]'::jsonb, 'rbse', 11, 'Accountancy', 'accountancy'),
  ('chapter', 'cash_flow_statement', 'Cash Flow Statement', '[]'::jsonb, 'rbse', 12, 'Accountancy', 'accountancy'),
  ('chapter', 'depreciation_provisions_and_reserves', 'Depreciation, Provisions and Reserves', '[]'::jsonb, 'rbse', 11, 'Accountancy', 'accountancy'),
  ('chapter', 'dissolution_of_partnership_firm', 'Dissolution of Partnership Firm', '[]'::jsonb, 'rbse', 12, 'Accountancy', 'accountancy'),
  ('chapter', 'financial_statements_i', 'Financial Statements - I', '[]'::jsonb, 'rbse', 11, 'Accountancy', 'accountancy'),
  ('chapter', 'financial_statements_ii', 'Financial Statements - II', '[]'::jsonb, 'rbse', 11, 'Accountancy', 'accountancy'),
  ('chapter', 'financial_statements_of_a_company', 'Financial Statements of a Company', '[]'::jsonb, 'rbse', 12, 'Accountancy', 'accountancy'),
  ('chapter', 'introduction_to_accounting', 'Introduction to Accounting', '[]'::jsonb, 'rbse', 11, 'Accountancy', 'accountancy'),
  ('chapter', 'issue_and_redemption_of_debentures', 'Issue and Redemption of Debentures', '[]'::jsonb, 'rbse', 12, 'Accountancy', 'accountancy'),
  ('chapter', 'reconstitution_admission', 'Reconstitution - Admission', '[]'::jsonb, 'rbse', 12, 'Accountancy', 'accountancy'),
  ('chapter', 'reconstitution_retirement_death', 'Reconstitution - Retirement/Death', '[]'::jsonb, 'rbse', 12, 'Accountancy', 'accountancy'),
  ('chapter', 'recording_of_transactions_i', 'Recording of Transactions-I', '[]'::jsonb, 'rbse', 11, 'Accountancy', 'accountancy'),
  ('chapter', 'recording_of_transactions_ii', 'Recording of Transactions-II', '[]'::jsonb, 'rbse', 11, 'Accountancy', 'accountancy'),
  ('chapter', 'theory_base_of_accounting', 'Theory Base of Accounting', '[]'::jsonb, 'rbse', 11, 'Accountancy', 'accountancy'),
  ('chapter', 'trial_balance_and_rectification_of_errors', 'Trial Balance and Rectification of Errors', '[]'::jsonb, 'rbse', 11, 'Accountancy', 'accountancy'),
  ('chapter', 'business_environment', 'Business Environment', '[]'::jsonb, 'rbse', 12, 'Business Studies', 'business_studies'),
  ('chapter', 'business_services', 'Business Services', '[]'::jsonb, 'rbse', 11, 'Business Studies', 'business_studies'),
  ('chapter', 'consumer_protection', 'Consumer Protection', '[]'::jsonb, 'rbse', 12, 'Business Studies', 'business_studies'),
  ('chapter', 'controlling', 'Controlling', '[]'::jsonb, 'rbse', 12, 'Business Studies', 'business_studies'),
  ('chapter', 'directing', 'Directing', '[]'::jsonb, 'rbse', 12, 'Business Studies', 'business_studies'),
  ('chapter', 'emerging_modes_of_business', 'Emerging Modes of Business', '[]'::jsonb, 'rbse', 11, 'Business Studies', 'business_studies'),
  ('chapter', 'financial_management', 'Financial Management', '[]'::jsonb, 'rbse', 12, 'Business Studies', 'business_studies'),
  ('chapter', 'formation_of_a_company', 'Formation of a Company', '[]'::jsonb, 'rbse', 11, 'Business Studies', 'business_studies'),
  ('chapter', 'forms_of_business_organisation', 'Forms of Business Organisation', '[]'::jsonb, 'rbse', 11, 'Business Studies', 'business_studies'),
  ('chapter', 'internal_trade', 'Internal Trade', '[]'::jsonb, 'rbse', 11, 'Business Studies', 'business_studies'),
  ('chapter', 'international_business', 'International Business', '[]'::jsonb, 'rbse', 11, 'Business Studies', 'business_studies'),
  ('chapter', 'marketing_management', 'Marketing Management', '[]'::jsonb, 'rbse', 12, 'Business Studies', 'business_studies'),
  ('chapter', 'msme_and_business_entrepreneurship', 'MSME and Business Entrepreneurship', '[]'::jsonb, 'rbse', 11, 'Business Studies', 'business_studies'),
  ('chapter', 'nature_and_purpose_of_business', 'Nature and Purpose of Business', '[]'::jsonb, 'rbse', 11, 'Business Studies', 'business_studies'),
  ('chapter', 'nature_and_significance_of_management', 'Nature and Significance of Management', '[]'::jsonb, 'rbse', 12, 'Business Studies', 'business_studies'),
  ('chapter', 'organising', 'Organising', '[]'::jsonb, 'rbse', 12, 'Business Studies', 'business_studies'),
  ('chapter', 'planning', 'Planning', '[]'::jsonb, 'rbse', 12, 'Business Studies', 'business_studies'),
  ('chapter', 'principles_of_management', 'Principles of Management', '[]'::jsonb, 'rbse', 12, 'Business Studies', 'business_studies'),
  ('chapter', 'private_public_and_global_enterprises', 'Private, Public and Global Enterprises', '[]'::jsonb, 'rbse', 11, 'Business Studies', 'business_studies'),
  ('chapter', 'social_responsibilities_of_business_and_business_ethics', 'Social Responsibilities of Business and Business Ethics', '[]'::jsonb, 'rbse', 11, 'Business Studies', 'business_studies'),
  ('chapter', 'sources_of_business_finance', 'Sources of Business Finance', '[]'::jsonb, 'rbse', 11, 'Business Studies', 'business_studies')
ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
VALUES
  ('chapter', 'staffing', 'Staffing', '[]'::jsonb, 'rbse', 12, 'Business Studies', 'business_studies'),
  ('chapter', 'collection_of_data', 'Collection of Data', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'comparative_development_experiences', 'Comparative Development Experiences', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'correlation', 'Correlation', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'determination_of_income_and_employment', 'Determination of Income and Employment', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'employment', 'Employment', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'environment_and_sustainable_development', 'Environment and Sustainable Development', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'government_budget_and_the_economy', 'Government Budget and the Economy', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'human_capital_formation', 'Human Capital Formation', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'index_numbers', 'Index Numbers', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'indian_economy_1950_1990', 'Indian Economy 1950-1990', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'indian_economy_on_the_eve_of_independence', 'Indian Economy on the Eve of Independence', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'introduction', 'Introduction', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'introduction', 'Introduction', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'introduction_to_macroeconomics', 'Introduction to Macroeconomics', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'lpg_an_appraisal', 'LPG - An Appraisal', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'market_equilibrium', 'Market Equilibrium', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'measures_of_central_tendency', 'Measures of Central Tendency', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'money_and_banking', 'Money and Banking', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'national_income_accounting', 'National Income Accounting', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'non_competitive_markets', 'Non-competitive Markets', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'open_economy_macroeconomics', 'Open Economy Macroeconomics', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'organisation_of_data', 'Organisation of Data', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'presentation_of_data', 'Presentation of Data', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'production_and_costs', 'Production and Costs', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'rural_development', 'Rural Development', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'the_theory_of_the_firm_under_perfect_competition', 'The Theory of the Firm under Perfect Competition', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'theory_of_consumer_behaviour', 'Theory of Consumer Behaviour', '[]'::jsonb, 'rbse', 12, 'Economics', 'economics'),
  ('chapter', 'use_of_statistical_tools', 'Use of Statistical Tools', '[]'::jsonb, 'rbse', 11, 'Economics', 'economics'),
  ('chapter', 'a_roadside_stand', 'A Roadside Stand', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'a_thing_of_beauty', 'A Thing of Beauty', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'aunt_jennifer_s_tigers', 'Aunt Jennifer’s Tigers', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'birth', 'Birth', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'business_english', 'Business English', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'business_english', 'Business English', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'comprehension_skills', 'Comprehension Skills', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'comprehension_skills', 'Comprehension Skills', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'deep_water', 'Deep Water', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'discovering_tut', 'Discovering Tut', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'going_places', 'Going Places', '[]'::jsonb, 'rbse', 12, 'English', 'english')
ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
VALUES
  ('chapter', 'grammar_articles', 'Grammar - Articles', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'grammar_modals', 'Grammar - Modals', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'grammar_prepositions', 'Grammar - Prepositions', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'grammar_reported_speech', 'Grammar - Reported Speech', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'grammar_subject_verb_agreement', 'Grammar - Subject-Verb Agreement', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'grammar_tenses', 'Grammar - Tenses', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'indigo', 'Indigo', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'journey_to_the_end_of_the_earth', 'Journey to the End of the Earth', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'keeping_quiet', 'Keeping Quiet', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'lost_spring', 'Lost Spring', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'mother_s_day', 'Mother’s Day', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'my_mother_at_sixty_six', 'My Mother at Sixty-Six', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'on_the_face_of_it', 'On the Face of It', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'poets_and_pancakes', 'Poets and Pancakes', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'silk_road', 'Silk Road', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'the_address', 'The Address', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'the_adventure', 'The Adventure', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'the_ailing_planet', 'The Ailing Planet', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'the_enemy', 'The Enemy', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'the_interview', 'The Interview', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'the_last_lesson', 'The Last Lesson', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'the_portrait_of_a_lady', 'The Portrait of a Lady', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'the_rattrap', 'The Rattrap', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'the_summer_of_the_beautiful_white_horse', 'The Summer of the Beautiful White Horse', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'the_tale_of_melon_city', 'The Tale of Melon City', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'the_third_level', 'The Third Level', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'the_tiger_king', 'The Tiger King', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'vocabulary', 'Vocabulary', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'vocabulary', 'Vocabulary', '[]'::jsonb, 'rbse', 12, 'English', 'english'),
  ('chapter', 'we_re_not_afraid_to_die', 'We’re Not Afraid to Die…', '[]'::jsonb, 'rbse', 11, 'English', 'english'),
  ('chapter', 'अतीत_में_दबे_पाँव', 'अतीत में दबे पाँव', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'आओ_मिलकर_बचाएँ', 'आओ मिलकर बचाएँ', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'आत्मपरिचय', 'आत्मपरिचय', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'आलो_आँधारि', 'आलो आँधारि', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'उषा', 'उषा', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'कबीर_के_पद', 'कबीर के पद', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'कविता_के_बहाने', 'कविता के बहाने', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'काले_मेघा_पानी_दे', 'काले मेघा पानी दे', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'काव्य_पद', 'काव्य - पद', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'काव्य_सौंदर्य', 'काव्य सौंदर्य', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi')
ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
VALUES
  ('chapter', 'कैमरे_में_बंद_अपाहिज', 'कैमरे में बंद अपाहिज', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'ग़ज़ल', 'ग़ज़ल', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'गद्यांश_बोध', 'गद्यांश बोध', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'गलता_लोहा', 'गलता लोहा', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'घर_की_याद', 'घर की याद', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'जामुन_का_पेड़', 'जामुन का पेड़', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'जूझ', 'जूझ', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'डायरी_के_पन्ने', 'डायरी के पन्ने', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'नमक_का_दारोगा', 'नमक का दारोगा', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'नाना_साहब_की_पुत्री_देवी_मैना_को_भस्म_कर_दिया_गया', 'नाना साहब की पुत्री देवी मैना को भस्म कर दिया गया', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'पतंग', 'पतंग', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'पत्र_लेखन', 'पत्र लेखन', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'पहलवान_की_ढोलक', 'पहलवान की ढोलक', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'बाजार_दर्शन', 'बाजार दर्शन', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'बादल_राग', 'बादल राग', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'भक्तिन', 'भक्तिन', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'भारत_माता', 'भारत माता', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'भारतीय_गायिकाओं_में_बेजोड़_लता_मंगेशकर', 'भारतीय गायिकाओं में बेजोड़ - लता मंगेशकर', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'मियाँ_नसीरुद्दीन', 'मियाँ नसीरुद्दीन', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'मीरा_के_पद', 'मीरा के पद', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'राजस्थान_की_रजत_बूँदें', 'राजस्थान की रजत बूँदें', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'वह_आँखें', 'वह आँखें', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_अलंकार', 'व्याकरण - अलंकार', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_अव्यय', 'व्याकरण - अव्यय', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_उपसर्ग', 'व्याकरण - उपसर्ग', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_काल', 'व्याकरण - काल', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_काल', 'व्याकरण - काल', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_पर्यायवाची', 'व्याकरण - पर्यायवाची', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_पर्यायवाची', 'व्याकरण - पर्यायवाची', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_प्रत्यय', 'व्याकरण - प्रत्यय', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_मुहावरा', 'व्याकरण - मुहावरा', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_मुहावरा', 'व्याकरण - मुहावरा', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_रस', 'व्याकरण - रस', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_वर्तनी', 'व्याकरण - वर्तनी', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_वर्तनी', 'व्याकरण - वर्तनी', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_वाक्य', 'व्याकरण - वाक्य', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_वाक्य_शुद्धि', 'व्याकरण - वाक्य शुद्धि', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_वाच्य', 'व्याकरण - वाच्य', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_विलोम', 'व्याकरण - विलोम', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_विलोम', 'व्याकरण - विलोम', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi')
ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
VALUES
  ('chapter', 'व्याकरण_संधि', 'व्याकरण - संधि', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_संधि', 'व्याकरण - संधि', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_समास', 'व्याकरण - समास', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'व्याकरण_समास', 'व्याकरण - समास', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'शुक्रतारे_के_समान', 'शुक्रतारे के समान', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'श्रम_विभाजन_और_जाति_प्रथा', 'श्रम विभाजन और जाति प्रथा', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'सहर्ष_स्वीकारा_है', 'सहर्ष स्वीकारा है', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'सिल्वर_वैडिंग', 'सिल्वर वैडिंग', '[]'::jsonb, 'rbse', 12, 'Hindi', 'hindi'),
  ('chapter', 'स्पिति_में_बारिश', 'स्पिति में बारिश', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'हे_भूख', 'हे भूख!', '[]'::jsonb, 'rbse', 11, 'Hindi', 'hindi'),
  ('chapter', 'application_of_derivatives', 'Application of Derivatives', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'application_of_integrals', 'Application of Integrals', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'binomial_theorem', 'Binomial Theorem', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'complex_numbers_and_quadratic_equations', 'Complex Numbers and Quadratic Equations', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'conic_sections', 'Conic Sections', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'continuity_and_differentiability', 'Continuity and Differentiability', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'determinants', 'Determinants', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'differential_equations', 'Differential Equations', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'integrals', 'Integrals', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'introduction_to_three_dimensional_geometry', 'Introduction to Three Dimensional Geometry', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'inverse_trigonometric_functions', 'Inverse Trigonometric Functions', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'limits_and_derivatives', 'Limits and Derivatives', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'linear_inequalities', 'Linear Inequalities', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'linear_programming', 'Linear Programming', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'matrices', 'Matrices', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'permutations_and_combinations', 'Permutations and Combinations', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'probability', 'Probability', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'probability', 'Probability', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'relations_and_functions', 'Relations and Functions', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'relations_and_functions', 'Relations and Functions', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'sequences_and_series', 'Sequences and Series', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'sets', 'Sets', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'statistics', 'Statistics', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'straight_lines', 'Straight Lines', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'three_dimensional_geometry', 'Three Dimensional Geometry', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics'),
  ('chapter', 'trigonometric_functions', 'Trigonometric Functions', '[]'::jsonb, 'rbse', 11, 'Mathematics', 'mathematics'),
  ('chapter', 'vector_algebra', 'Vector Algebra', '[]'::jsonb, 'rbse', 12, 'Mathematics', 'mathematics')
ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();

-- Concepts / topics (bank + curated core)
INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('concept', '1991', '1991 Economic Reforms', '["1991 Economic Reforms","1991 economic reforms","1991"]'::jsonb, 'rbse'),
  ('concept', '4ps', '4Ps (Marketing Mix)', '["4Ps (Marketing Mix)","4ps (marketing mix)","4ps"]'::jsonb, 'rbse'),
  ('concept', 'addition_rule', 'Addition Rule', '["Addition Rule","addition rule","addition rule"]'::jsonb, 'rbse'),
  ('concept', 'addition_scalar', 'Addition Scalar', '["Addition Scalar","addition scalar","addition scalar"]'::jsonb, 'rbse'),
  ('concept', 'adjoint_inverse', 'Adjoint Inverse', '["Adjoint Inverse","adjoint inverse","adjoint inverse"]'::jsonb, 'rbse'),
  ('concept', 'adjustments', 'Adjustments', '["Adjustments","adjustments","adjustments"]'::jsonb, 'rbse'),
  ('concept', 'aggregates', 'National Income Aggregates', '["National Income Aggregates","national income aggregates","aggregates"]'::jsonb, 'rbse'),
  ('concept', 'agreement', 'Subject-Verb Agreement', '["Subject-Verb Agreement","subject-verb agreement","agreement"]'::jsonb, 'rbse'),
  ('concept', 'agriculture', 'Agriculture', '["Agriculture","agriculture","agriculture"]'::jsonb, 'rbse'),
  ('concept', 'algebra_of_complex', 'Algebra of Complex', '["Algebra of Complex","algebra of complex","algebra of complex"]'::jsonb, 'rbse'),
  ('concept', 'algebra_of_limits', 'Algebra of Limits', '["Algebra of Limits","algebra of limits","algebra of limits"]'::jsonb, 'rbse'),
  ('concept', 'analysis', 'Analysis', '["Analysis","analysis","analysis"]'::jsonb, 'rbse'),
  ('concept', 'angle_between_lines', 'Angle Between Lines', '["Angle Between Lines","angle between lines","angle between lines"]'::jsonb, 'rbse'),
  ('concept', 'angle_lines_planes', 'Angle Lines Planes', '["Angle Lines Planes","angle lines planes","angle lines planes"]'::jsonb, 'rbse'),
  ('concept', 'antiderivative', 'Antiderivative', '["Antiderivative","antiderivative","antiderivative"]'::jsonb, 'rbse'),
  ('concept', 'aoa', 'Articles of Association', '["Articles of Association","articles of association","aoa"]'::jsonb, 'rbse'),
  ('concept', 'ap', 'Arithmetic Progression', '["Arithmetic Progression","arithmetic progression","ap"]'::jsonb, 'rbse'),
  ('concept', 'ap_basics', 'Arithmetic Progression Basics', '["Arithmetic Progression Basics","arithmetic progression basics","ap basics"]'::jsonb, 'rbse'),
  ('concept', 'ap_sum', 'Sum of an AP', '["Sum of an AP","sum of an ap","ap sum"]'::jsonb, 'rbse'),
  ('concept', 'appraisal', 'Performance Appraisal', '["Performance Appraisal","performance appraisal","appraisal"]'::jsonb, 'rbse'),
  ('concept', 'approximations', 'Approximations', '["Approximations","approximations","approximations"]'::jsonb, 'rbse'),
  ('concept', 'area', 'Area', '["Area","area","area"]'::jsonb, 'rbse'),
  ('concept', 'area_between_curves', 'Area Between Curves', '["Area Between Curves","area between curves","area between curves"]'::jsonb, 'rbse'),
  ('concept', 'area_under_curve', 'Area Under Curve', '["Area Under Curve","area under curve","area under curve"]'::jsonb, 'rbse'),
  ('concept', 'arguments', 'Arguments', '["Arguments","arguments","arguments"]'::jsonb, 'rbse'),
  ('concept', 'articles', 'Articles', '["Articles","articles","articles"]'::jsonb, 'rbse'),
  ('concept', 'authorised', 'Authorised Capital', '["Authorised Capital","authorised capital","authorised"]'::jsonb, 'rbse'),
  ('concept', 'banking', 'Banking', '["Banking","banking","banking"]'::jsonb, 'rbse'),
  ('concept', 'basic', 'Basic', '["Basic","basic","basic"]'::jsonb, 'rbse'),
  ('concept', 'basic_derivatives', 'Basic Derivatives', '["Basic Derivatives","basic derivatives","basic derivatives"]'::jsonb, 'rbse'),
  ('concept', 'bayes', 'Bayes'' Theorem', '["Bayes'' Theorem","bayes'' theorem","bayes"]'::jsonb, 'rbse'),
  ('concept', 'bayes_setup', 'Bayes'' Theorem Setup', '["Bayes'' Theorem Setup","bayes'' theorem setup","bayes setup"]'::jsonb, 'rbse'),
  ('concept', 'benefits', 'Benefits', '["Benefits","benefits","benefits"]'::jsonb, 'rbse'),
  ('concept', 'binomial_coefficients', 'Binomial Coefficients', '["Binomial Coefficients","binomial coefficients","binomial coefficients"]'::jsonb, 'rbse'),
  ('concept', 'bivariate', 'Bivariate Data', '["Bivariate Data","bivariate data","bivariate"]'::jsonb, 'rbse'),
  ('concept', 'bop', 'Balance of Payments', '["Balance of Payments","balance of payments","bop"]'::jsonb, 'rbse'),
  ('concept', 'branches', 'Branches of Accounting', '["Branches of Accounting","branches of accounting","branches"]'::jsonb, 'rbse'),
  ('concept', 'budget', 'Budget', '["Budget","budget","budget"]'::jsonb, 'rbse'),
  ('concept', 'capital', 'Capital', '["Capital","capital","capital"]'::jsonb, 'rbse'),
  ('concept', 'cartesian_product', 'Cartesian Product', '["Cartesian Product","cartesian product","cartesian product"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('concept', 'categories', 'Categories', '["Categories","categories","categories"]'::jsonb, 'rbse'),
  ('concept', 'chain_rule', 'Chain Rule', '["Chain Rule","chain rule","chain rule"]'::jsonb, 'rbse'),
  ('concept', 'chambers', 'Chambers of Commerce', '["Chambers of Commerce","chambers of commerce","chambers"]'::jsonb, 'rbse'),
  ('concept', 'character', 'Character', '["Character","character","character"]'::jsonb, 'rbse'),
  ('concept', 'characteristics', 'Characteristics', '["Characteristics","characteristics","characteristics"]'::jsonb, 'rbse'),
  ('concept', 'circle', 'Circle', '["Circle","circle","circle"]'::jsonb, 'rbse'),
  ('concept', 'circular_permutation', 'Circular Permutation', '["Circular Permutation","circular permutation","circular permutation"]'::jsonb, 'rbse'),
  ('concept', 'classical', 'Classical', '["Classical","classical","classical"]'::jsonb, 'rbse'),
  ('concept', 'classical_probability', 'Classical Probability', '["Classical Probability","classical probability","classical probability"]'::jsonb, 'rbse'),
  ('concept', 'classification', 'Classification', '["Classification","classification","classification"]'::jsonb, 'rbse'),
  ('concept', 'cogs', 'Cost of Goods Sold', '["Cost of Goods Sold","cost of goods sold","cogs"]'::jsonb, 'rbse'),
  ('concept', 'colonial', 'Colonial Economy', '["Colonial Economy","colonial economy","colonial"]'::jsonb, 'rbse'),
  ('concept', 'combinations', 'Combinations', '["Combinations","combinations","combinations"]'::jsonb, 'rbse'),
  ('concept', 'commerce', 'Commerce', '["Commerce","commerce","commerce"]'::jsonb, 'rbse'),
  ('concept', 'communication', 'Communication', '["Communication","communication","communication"]'::jsonb, 'rbse'),
  ('concept', 'company', 'Company', '["Company","company","company"]'::jsonb, 'rbse'),
  ('concept', 'comparison', 'Comparison', '["Comparison","comparison","comparison"]'::jsonb, 'rbse'),
  ('concept', 'compensating', 'Compensating Errors', '["Compensating Errors","compensating errors","compensating"]'::jsonb, 'rbse'),
  ('concept', 'complementary_angles', 'Complementary Angles', '["Complementary Angles","complementary angles","complementary angles"]'::jsonb, 'rbse'),
  ('concept', 'complementary_events', 'Complementary Events', '["Complementary Events","complementary events","complementary events"]'::jsonb, 'rbse'),
  ('concept', 'composition', 'Composition', '["Composition","composition","composition"]'::jsonb, 'rbse'),
  ('concept', 'concepts', 'Concepts', '["Concepts","concepts","concepts"]'::jsonb, 'rbse'),
  ('concept', 'concision', 'Concision', '["Concision","concision","concision"]'::jsonb, 'rbse'),
  ('concept', 'concurrency', 'Concurrency', '["Concurrency","concurrency","concurrency"]'::jsonb, 'rbse'),
  ('concept', 'conditional', 'Conditional', '["Conditional","conditional","conditional"]'::jsonb, 'rbse'),
  ('concept', 'consistency', 'Consistency Concept', '["Consistency Concept","consistency concept","consistency"]'::jsonb, 'rbse'),
  ('concept', 'constraints', 'Constraints', '["Constraints","constraints","constraints"]'::jsonb, 'rbse'),
  ('concept', 'continuity', 'Continuity', '["Continuity","continuity","continuity"]'::jsonb, 'rbse'),
  ('concept', 'cooperative', 'Cooperative Society', '["Cooperative Society","cooperative society","cooperative"]'::jsonb, 'rbse'),
  ('concept', 'coordinates_3d', 'Coordinates 3D', '["Coordinates 3D","coordinates 3d","coordinates 3d"]'::jsonb, 'rbse'),
  ('concept', 'corner_point', 'Corner Point', '["Corner Point","corner point","corner point"]'::jsonb, 'rbse'),
  ('concept', 'costs', 'Costs', '["Costs","costs","costs"]'::jsonb, 'rbse'),
  ('concept', 'credit', 'Credit', '["Credit","credit","credit"]'::jsonb, 'rbse'),
  ('concept', 'cross_product', 'Cross Product', '["Cross Product","cross product","cross product"]'::jsonb, 'rbse'),
  ('concept', 'crr', 'Cash Reserve Ratio', '["Cash Reserve Ratio","cash reserve ratio","crr"]'::jsonb, 'rbse'),
  ('concept', 'csr', 'Corporate Social Responsibility', '["Corporate Social Responsibility","corporate social responsibility","csr"]'::jsonb, 'rbse'),
  ('concept', 'deadweight', 'Deadweight Loss', '["Deadweight Loss","deadweight loss","deadweight"]'::jsonb, 'rbse'),
  ('concept', 'decentralisation', 'Decentralisation', '["Decentralisation","decentralisation","decentralisation"]'::jsonb, 'rbse'),
  ('concept', 'deficit', 'Budget Deficit', '["Budget Deficit","budget deficit","deficit"]'::jsonb, 'rbse'),
  ('concept', 'definite', 'Definite', '["Definite","definite","definite"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('concept', 'definite_area', 'Definite Area', '["Definite Area","definite area","definite area"]'::jsonb, 'rbse'),
  ('concept', 'definite_integral', 'Definite Integral', '["Definite Integral","definite integral","definite integral"]'::jsonb, 'rbse'),
  ('concept', 'definition', 'Definition', '["Definition","definition","definition"]'::jsonb, 'rbse'),
  ('concept', 'delegation', 'Delegation', '["Delegation","delegation","delegation"]'::jsonb, 'rbse'),
  ('concept', 'demand', 'Demand', '["Demand","demand","demand"]'::jsonb, 'rbse'),
  ('concept', 'demographic', 'Demographic Profile', '["Demographic Profile","demographic profile","demographic"]'::jsonb, 'rbse'),
  ('concept', 'depreciation', 'Depreciation', '["Depreciation","depreciation","depreciation"]'::jsonb, 'rbse'),
  ('concept', 'derivative', 'Derivative', '["Derivative","derivative","derivative"]'::jsonb, 'rbse'),
  ('concept', 'derivative_definition', 'Derivative Definition', '["Derivative Definition","derivative definition","derivative definition"]'::jsonb, 'rbse'),
  ('concept', 'det2', '2×2 Determinant', '["2×2 Determinant","2×2 determinant","det2"]'::jsonb, 'rbse'),
  ('concept', 'determinant_2x2', 'Determinant 2x2', '["Determinant 2x2","determinant 2x2","determinant 2x2"]'::jsonb, 'rbse'),
  ('concept', 'determinant_3x3', 'Determinant 3x3', '["Determinant 3x3","determinant 3x3","determinant 3x3"]'::jsonb, 'rbse'),
  ('concept', 'deviations', 'Deviations', '["Deviations","deviations","deviations"]'::jsonb, 'rbse'),
  ('concept', 'device', 'Literary Device', '["Literary Device","literary device","device"]'::jsonb, 'rbse'),
  ('concept', 'differentiability', 'Differentiability', '["Differentiability","differentiability","differentiability"]'::jsonb, 'rbse'),
  ('concept', 'dilemma', 'Dilemma', '["Dilemma","dilemma","dilemma"]'::jsonb, 'rbse'),
  ('concept', 'dimensions', 'Dimensions of Business Environment', '["Dimensions of Business Environment","dimensions of business environment","dimensions"]'::jsonb, 'rbse'),
  ('concept', 'direction', 'Direction of Trade', '["Direction of Trade","direction of trade","direction"]'::jsonb, 'rbse'),
  ('concept', 'direction_cosines', 'Direction Cosines', '["Direction Cosines","direction cosines","direction cosines"]'::jsonb, 'rbse'),
  ('concept', 'direction_ratios', 'Direction Ratios', '["Direction Ratios","direction ratios","direction ratios"]'::jsonb, 'rbse'),
  ('concept', 'discriminant', 'Discriminant', '["Discriminant","discriminant","discriminant"]'::jsonb, 'rbse'),
  ('concept', 'disinvestment', 'Disinvestment', '["Disinvestment","disinvestment","disinvestment"]'::jsonb, 'rbse'),
  ('concept', 'dispersion_intro', 'Dispersion Intro', '["Dispersion Intro","dispersion intro","dispersion intro"]'::jsonb, 'rbse'),
  ('concept', 'distance', 'Distance', '["Distance","distance","distance"]'::jsonb, 'rbse'),
  ('concept', 'distance_3d', 'Distance 3D', '["Distance 3D","distance 3d","distance 3d"]'::jsonb, 'rbse'),
  ('concept', 'dividend', 'Dividend Decision', '["Dividend Decision","dividend decision","dividend"]'::jsonb, 'rbse'),
  ('concept', 'division_into_groups', 'Division Into Groups', '["Division Into Groups","division into groups","division into groups"]'::jsonb, 'rbse'),
  ('concept', 'domain', 'Domain', '["Domain","domain","domain"]'::jsonb, 'rbse'),
  ('concept', 'domain_range', 'Domain Range', '["Domain Range","domain range","domain range"]'::jsonb, 'rbse'),
  ('concept', 'domain_range_inv_trig', 'Domain Range Inv Trig', '["Domain Range Inv Trig","domain range inv trig","domain range inv trig"]'::jsonb, 'rbse'),
  ('concept', 'dot', 'Dot', '["Dot","dot","dot"]'::jsonb, 'rbse'),
  ('concept', 'dot_product', 'Dot Product', '["Dot Product","dot product","dot product"]'::jsonb, 'rbse'),
  ('concept', 'ecommerce', 'e-Commerce', '["e-Commerce","e-commerce","ecommerce"]'::jsonb, 'rbse'),
  ('concept', 'education', 'Education', '["Education","education","education"]'::jsonb, 'rbse'),
  ('concept', 'efficiency', 'Efficiency', '["Efficiency","efficiency","efficiency"]'::jsonb, 'rbse'),
  ('concept', 'elasticity', 'Elasticity', '["Elasticity","elasticity","elasticity"]'::jsonb, 'rbse'),
  ('concept', 'elements', 'Elements', '["Elements","elements","elements"]'::jsonb, 'rbse'),
  ('concept', 'ellipse', 'Ellipse', '["Ellipse","ellipse","ellipse"]'::jsonb, 'rbse'),
  ('concept', 'entrepreneur', 'Entrepreneurship', '["Entrepreneurship","entrepreneurship","entrepreneur"]'::jsonb, 'rbse'),
  ('concept', 'environment', 'Business Environment', '["Business Environment","business environment","environment"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('concept', 'epayments', 'Electronic Payments', '["Electronic Payments","electronic payments","epayments"]'::jsonb, 'rbse'),
  ('concept', 'equilibrium', 'Equilibrium', '["Equilibrium","equilibrium","equilibrium"]'::jsonb, 'rbse'),
  ('concept', 'equivalence_relation', 'Equivalence Relation', '["Equivalence Relation","equivalence relation","equivalence relation"]'::jsonb, 'rbse'),
  ('concept', 'errors', 'Errors', '["Errors","errors","errors"]'::jsonb, 'rbse'),
  ('concept', 'esprit', 'Esprit de Corps', '["Esprit de Corps","esprit de corps","esprit"]'::jsonb, 'rbse'),
  ('concept', 'ethics', 'Business Ethics', '["Business Ethics","business ethics","ethics"]'::jsonb, 'rbse'),
  ('concept', 'events', 'Events', '["Events","events","events"]'::jsonb, 'rbse'),
  ('concept', 'exclusive_inclusive', 'Exclusive Inclusive', '["Exclusive Inclusive","exclusive inclusive","exclusive inclusive"]'::jsonb, 'rbse'),
  ('concept', 'expansion', 'Expansion', '["Expansion","expansion","expansion"]'::jsonb, 'rbse'),
  ('concept', 'export', 'Export', '["Export","export","export"]'::jsonb, 'rbse'),
  ('concept', 'factorial', 'Factorial', '["Factorial","factorial","factorial"]'::jsonb, 'rbse'),
  ('concept', 'fayol', 'Fayol''s Principles', '["Fayol''s Principles","fayol''s principles","fayol"]'::jsonb, 'rbse'),
  ('concept', 'feasible', 'Feasible', '["Feasible","feasible","feasible"]'::jsonb, 'rbse'),
  ('concept', 'feasible_region', 'Feasible Region', '["Feasible Region","feasible region","feasible region"]'::jsonb, 'rbse'),
  ('concept', 'features', 'Features', '["Features","features","features"]'::jsonb, 'rbse'),
  ('concept', 'financing', 'Financing Activities', '["Financing Activities","financing activities","financing"]'::jsonb, 'rbse'),
  ('concept', 'focus', 'Focus', '["Focus","focus","focus"]'::jsonb, 'rbse'),
  ('concept', 'focus_directrix', 'Focus Directrix', '["Focus Directrix","focus directrix","focus directrix"]'::jsonb, 'rbse'),
  ('concept', 'formal', 'Formal Writing', '["Formal Writing","formal writing","formal"]'::jsonb, 'rbse'),
  ('concept', 'formal_email', 'Formal Email', '["Formal Email","formal email","formal email"]'::jsonb, 'rbse'),
  ('concept', 'forms_of_line', 'Forms of Line', '["Forms of Line","forms of line","forms of line"]'::jsonb, 'rbse'),
  ('concept', 'frequency', 'Frequency Distribution', '["Frequency Distribution","frequency distribution","frequency"]'::jsonb, 'rbse'),
  ('concept', 'function_def', 'Function Def', '["Function Def","function def","function def"]'::jsonb, 'rbse'),
  ('concept', 'function_definition', 'Function Definition', '["Function Definition","function definition","function definition"]'::jsonb, 'rbse'),
  ('concept', 'functions', 'Functions of Management', '["Functions of Management","functions of management","functions"]'::jsonb, 'rbse'),
  ('concept', 'general_particular', 'General Particular', '["General Particular","general particular","general particular"]'::jsonb, 'rbse'),
  ('concept', 'general_solutions', 'General Solutions', '["General Solutions","general solutions","general solutions"]'::jsonb, 'rbse'),
  ('concept', 'general_term', 'General Term', '["General Term","general term","general term"]'::jsonb, 'rbse'),
  ('concept', 'global_warming', 'Global Warming', '["Global Warming","global warming","global warming"]'::jsonb, 'rbse'),
  ('concept', 'globalisation', 'Globalisation', '["Globalisation","globalisation","globalisation"]'::jsonb, 'rbse'),
  ('concept', 'goodwill', 'Goodwill', '["Goodwill","goodwill","goodwill"]'::jsonb, 'rbse'),
  ('concept', 'gp_basics', 'Geometric Progression Basics', '["Geometric Progression Basics","geometric progression basics","gp basics"]'::jsonb, 'rbse'),
  ('concept', 'gp_sum', 'Sum of a GP', '["Sum of a GP","sum of a gp","gp sum"]'::jsonb, 'rbse'),
  ('concept', 'graphical_solution', 'Graphical Solution', '["Graphical Solution","graphical solution","graphical solution"]'::jsonb, 'rbse'),
  ('concept', 'graphs', 'Graphs', '["Graphs","graphs","graphs"]'::jsonb, 'rbse'),
  ('concept', 'growth', 'Economic Growth', '["Economic Growth","economic growth","growth"]'::jsonb, 'rbse'),
  ('concept', 'health', 'Health', '["Health","health","health"]'::jsonb, 'rbse'),
  ('concept', 'histogram', 'Histogram', '["Histogram","histogram","histogram"]'::jsonb, 'rbse'),
  ('concept', 'homogeneous', 'Homogeneous', '["Homogeneous","homogeneous","homogeneous"]'::jsonb, 'rbse'),
  ('concept', 'horizontal', 'Horizontal Analysis', '["Horizontal Analysis","horizontal analysis","horizontal"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('concept', 'huf', 'Hindu Undivided Family', '["Hindu Undivided Family","hindu undivided family","huf"]'::jsonb, 'rbse'),
  ('concept', 'hyperbola', 'Hyperbola', '["Hyperbola","hyperbola","hyperbola"]'::jsonb, 'rbse'),
  ('concept', 'i_squared', 'i Squared', '["i Squared","i squared","i squared"]'::jsonb, 'rbse'),
  ('concept', 'idea', 'Central Idea', '["Central Idea","central idea","idea"]'::jsonb, 'rbse'),
  ('concept', 'identities', 'Identities', '["Identities","identities","identities"]'::jsonb, 'rbse'),
  ('concept', 'identities_inv', 'Identities Inv', '["Identities Inv","identities inv","identities inv"]'::jsonb, 'rbse'),
  ('concept', 'identity', 'Identity', '["Identity","identity","identity"]'::jsonb, 'rbse'),
  ('concept', 'imaginary_unit', 'Imaginary Unit', '["Imaginary Unit","imaginary unit","imaginary unit"]'::jsonb, 'rbse'),
  ('concept', 'implicit_log', 'Implicit Log', '["Implicit Log","implicit log","implicit log"]'::jsonb, 'rbse'),
  ('concept', 'importance', 'Importance', '["Importance","importance","importance"]'::jsonb, 'rbse'),
  ('concept', 'incorporation', 'Incorporation', '["Incorporation","incorporation","incorporation"]'::jsonb, 'rbse'),
  ('concept', 'increasing', 'Increasing', '["Increasing","increasing","increasing"]'::jsonb, 'rbse'),
  ('concept', 'increasing_decreasing', 'Increasing Decreasing', '["Increasing Decreasing","increasing decreasing","increasing decreasing"]'::jsonb, 'rbse'),
  ('concept', 'independent', 'Independent', '["Independent","independent","independent"]'::jsonb, 'rbse'),
  ('concept', 'industrial', 'Industrial Sector', '["Industrial Sector","industrial sector","industrial"]'::jsonb, 'rbse'),
  ('concept', 'industry', 'Industry', '["Industry","industry","industry"]'::jsonb, 'rbse'),
  ('concept', 'inference', 'Inference', '["Inference","inference","inference"]'::jsonb, 'rbse'),
  ('concept', 'infrastructure', 'Infrastructure', '["Infrastructure","infrastructure","infrastructure"]'::jsonb, 'rbse'),
  ('concept', 'insolvency', 'Insolvency', '["Insolvency","insolvency","insolvency"]'::jsonb, 'rbse'),
  ('concept', 'insurance', 'Insurance', '["Insurance","insurance","insurance"]'::jsonb, 'rbse'),
  ('concept', 'interest', 'Interest', '["Interest","interest","interest"]'::jsonb, 'rbse'),
  ('concept', 'intermediate', 'Intermediate Goods', '["Intermediate Goods","intermediate goods","intermediate"]'::jsonb, 'rbse'),
  ('concept', 'interpretation', 'Interpretation', '["Interpretation","interpretation","interpretation"]'::jsonb, 'rbse'),
  ('concept', 'interval_notation', 'Interval Notation', '["Interval Notation","interval notation","interval notation"]'::jsonb, 'rbse'),
  ('concept', 'inverse', 'Inverse', '["Inverse","inverse","inverse"]'::jsonb, 'rbse'),
  ('concept', 'investing', 'Investing Activities', '["Investing Activities","investing activities","investing"]'::jsonb, 'rbse'),
  ('concept', 'irony', 'Irony', '["Irony","irony","irony"]'::jsonb, 'rbse'),
  ('concept', 'issues', 'Issues', '["Issues","issues","issues"]'::jsonb, 'rbse'),
  ('concept', 'itinerant', 'Itinerant Retailers', '["Itinerant Retailers","itinerant retailers","itinerant"]'::jsonb, 'rbse'),
  ('concept', 'leadership', 'Leadership', '["Leadership","leadership","leadership"]'::jsonb, 'rbse'),
  ('concept', 'levels', 'Levels of Management', '["Levels of Management","levels of management","levels"]'::jsonb, 'rbse'),
  ('concept', 'liberalisation', 'Liberalisation', '["Liberalisation","liberalisation","liberalisation"]'::jsonb, 'rbse'),
  ('concept', 'limit', 'Limit', '["Limit","limit","limit"]'::jsonb, 'rbse'),
  ('concept', 'limit_basics', 'Limit Basics', '["Limit Basics","limit basics","limit basics"]'::jsonb, 'rbse'),
  ('concept', 'limitations', 'Limitations', '["Limitations","limitations","limitations"]'::jsonb, 'rbse'),
  ('concept', 'line_3d', 'Line 3D', '["Line 3D","line 3d","line 3d"]'::jsonb, 'rbse'),
  ('concept', 'linear_first_order', 'Linear First Order', '["Linear First Order","linear first order","linear first order"]'::jsonb, 'rbse'),
  ('concept', 'linear_ineq_one_var', 'Linear Ineq One Var', '["Linear Ineq One Var","linear ineq one var","linear ineq one var"]'::jsonb, 'rbse'),
  ('concept', 'literary_device', 'Literary Device', '["Literary Device","literary device","literary device"]'::jsonb, 'rbse'),
  ('concept', 'long_term', 'Long-term Sources', '["Long-term Sources","long-term sources","long term"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('concept', 'lpp_basics', 'LPP Basics', '["LPP Basics","lpp basics","lpp basics"]'::jsonb, 'rbse'),
  ('concept', 'magnitude', 'Magnitude', '["Magnitude","magnitude","magnitude"]'::jsonb, 'rbse'),
  ('concept', 'marketing', 'Marketing', '["Marketing","marketing","marketing"]'::jsonb, 'rbse'),
  ('concept', 'marshalling', 'Marshalling of Assets', '["Marshalling of Assets","marshalling of assets","marshalling"]'::jsonb, 'rbse'),
  ('concept', 'matching', 'Matching Concept', '["Matching Concept","matching concept","matching"]'::jsonb, 'rbse'),
  ('concept', 'matrix_types', 'Matrix Types', '["Matrix Types","matrix types","matrix types"]'::jsonb, 'rbse'),
  ('concept', 'max_min', 'Max Min', '["Max Min","max min","max min"]'::jsonb, 'rbse'),
  ('concept', 'maxima', 'Maxima', '["Maxima","maxima","maxima"]'::jsonb, 'rbse'),
  ('concept', 'mc', 'Marginal Cost', '["Marginal Cost","marginal cost","mc"]'::jsonb, 'rbse'),
  ('concept', 'mean', 'Mean', '["Mean","mean","mean"]'::jsonb, 'rbse'),
  ('concept', 'meaning', 'Meaning', '["Meaning","meaning","meaning"]'::jsonb, 'rbse'),
  ('concept', 'measures_central', 'Measures Central', '["Measures Central","measures central","measures central"]'::jsonb, 'rbse'),
  ('concept', 'median', 'Median', '["Median","median","median"]'::jsonb, 'rbse'),
  ('concept', 'memo', 'Memo', '["Memo","memo","memo"]'::jsonb, 'rbse'),
  ('concept', 'methods', 'Methods', '["Methods","methods","methods"]'::jsonb, 'rbse'),
  ('concept', 'middle_term', 'Middle Term', '["Middle Term","middle term","middle term"]'::jsonb, 'rbse'),
  ('concept', 'minors_cofactors', 'Minors Cofactors', '["Minors Cofactors","minors cofactors","minors cofactors"]'::jsonb, 'rbse'),
  ('concept', 'minutes', 'Minutes of Meeting', '["Minutes of Meeting","minutes of meeting","minutes"]'::jsonb, 'rbse'),
  ('concept', 'mnc', 'Multinational Corporation', '["Multinational Corporation","multinational corporation","mnc"]'::jsonb, 'rbse'),
  ('concept', 'moa', 'Memorandum of Association', '["Memorandum of Association","memorandum of association","moa"]'::jsonb, 'rbse'),
  ('concept', 'modals', 'Modals', '["Modals","modals","modals"]'::jsonb, 'rbse'),
  ('concept', 'mode', 'Mode', '["Mode","mode","mode"]'::jsonb, 'rbse'),
  ('concept', 'modes', 'Modes', '["Modes","modes","modes"]'::jsonb, 'rbse'),
  ('concept', 'modulus', 'Modulus', '["Modulus","modulus","modulus"]'::jsonb, 'rbse'),
  ('concept', 'modulus_argument', 'Modulus Argument', '["Modulus Argument","modulus argument","modulus argument"]'::jsonb, 'rbse'),
  ('concept', 'monopolistic', 'Monopolistic Competition', '["Monopolistic Competition","monopolistic competition","monopolistic"]'::jsonb, 'rbse'),
  ('concept', 'monopoly', 'Monopoly', '["Monopoly","monopoly","monopoly"]'::jsonb, 'rbse'),
  ('concept', 'motivation', 'Motivation', '["Motivation","motivation","motivation"]'::jsonb, 'rbse'),
  ('concept', 'multiplication', 'Multiplication', '["Multiplication","multiplication","multiplication"]'::jsonb, 'rbse'),
  ('concept', 'multiplier', 'Multiplier', '["Multiplier","multiplier","multiplier"]'::jsonb, 'rbse'),
  ('concept', 'nCr', 'Combinations (nCr)', '["Combinations (nCr)","combinations (ncr)","nCr"]'::jsonb, 'rbse'),
  ('concept', 'nPr', 'Permutations (nPr)', '["Permutations (nPr)","permutations (npr)","nPr"]'::jsonb, 'rbse'),
  ('concept', 'nature', 'Nature', '["Nature","nature","nature"]'::jsonb, 'rbse'),
  ('concept', 'notes', 'Notes to Accounts', '["Notes to Accounts","notes to accounts","notes"]'::jsonb, 'rbse'),
  ('concept', 'objective', 'Objective', '["Objective","objective","objective"]'::jsonb, 'rbse'),
  ('concept', 'objective_function', 'Objective Function', '["Objective Function","objective function","objective function"]'::jsonb, 'rbse'),
  ('concept', 'objectives', 'Objectives', '["Objectives","objectives","objectives"]'::jsonb, 'rbse'),
  ('concept', 'ogive', 'Ogive', '["Ogive","ogive","ogive"]'::jsonb, 'rbse'),
  ('concept', 'oligopoly', 'Oligopoly', '["Oligopoly","oligopoly","oligopoly"]'::jsonb, 'rbse'),
  ('concept', 'one_one', 'One One', '["One One","one one","one one"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('concept', 'onto', 'Onto', '["Onto","onto","onto"]'::jsonb, 'rbse'),
  ('concept', 'operating', 'Operating Activities', '["Operating Activities","operating activities","operating"]'::jsonb, 'rbse'),
  ('concept', 'operations', 'Operations', '["Operations","operations","operations"]'::jsonb, 'rbse'),
  ('concept', 'order', 'Order', '["Order","order","order"]'::jsonb, 'rbse'),
  ('concept', 'order_degree', 'Order Degree', '["Order Degree","order degree","order degree"]'::jsonb, 'rbse'),
  ('concept', 'outsourcing', 'Outsourcing', '["Outsourcing","outsourcing","outsourcing"]'::jsonb, 'rbse'),
  ('concept', 'outstanding', 'Outstanding Expenses', '["Outstanding Expenses","outstanding expenses","outstanding"]'::jsonb, 'rbse'),
  ('concept', 'overdraft', 'Bank Overdraft', '["Bank Overdraft","bank overdraft","overdraft"]'::jsonb, 'rbse'),
  ('concept', 'pakistan', 'Pakistan Comparison', '["Pakistan Comparison","pakistan comparison","pakistan"]'::jsonb, 'rbse'),
  ('concept', 'parabola', 'Parabola', '["Parabola","parabola","parabola"]'::jsonb, 'rbse'),
  ('concept', 'paradox', 'Paradox of Thrift', '["Paradox of Thrift","paradox of thrift","paradox"]'::jsonb, 'rbse'),
  ('concept', 'partial_fractions', 'Partial Fractions', '["Partial Fractions","partial fractions","partial fractions"]'::jsonb, 'rbse'),
  ('concept', 'participation', 'Labour Force Participation', '["Labour Force Participation","labour force participation","participation"]'::jsonb, 'rbse'),
  ('concept', 'partnership', 'Partnership', '["Partnership","partnership","partnership"]'::jsonb, 'rbse'),
  ('concept', 'permutations', 'Permutations', '["Permutations","permutations","permutations"]'::jsonb, 'rbse'),
  ('concept', 'plane_3d', 'Plane 3D', '["Plane 3D","plane 3d","plane 3d"]'::jsonb, 'rbse'),
  ('concept', 'planning', 'Economic Planning', '["Economic Planning","economic planning","planning"]'::jsonb, 'rbse'),
  ('concept', 'plot', 'Plot', '["Plot","plot","plot"]'::jsonb, 'rbse'),
  ('concept', 'policy', 'Policy', '["Policy","policy","policy"]'::jsonb, 'rbse'),
  ('concept', 'policy_open', 'Open Market Operations', '["Open Market Operations","open market operations","policy open"]'::jsonb, 'rbse'),
  ('concept', 'pollution', 'Pollution', '["Pollution","pollution","pollution"]'::jsonb, 'rbse'),
  ('concept', 'poverty', 'Poverty', '["Poverty","poverty","poverty"]'::jsonb, 'rbse'),
  ('concept', 'power_set', 'Power Set', '["Power Set","power set","power set"]'::jsonb, 'rbse'),
  ('concept', 'ppf', 'Production Possibility Frontier', '["Production Possibility Frontier","production possibility frontier","ppf"]'::jsonb, 'rbse'),
  ('concept', 'ppp', 'Public-Private Partnership', '["Public-Private Partnership","public-private partnership","ppp"]'::jsonb, 'rbse'),
  ('concept', 'premium', 'Share Premium', '["Share Premium","share premium","premium"]'::jsonb, 'rbse'),
  ('concept', 'prepositions', 'Prepositions', '["Prepositions","prepositions","prepositions"]'::jsonb, 'rbse'),
  ('concept', 'present_perfect', 'Present Perfect', '["Present Perfect","present perfect","present perfect"]'::jsonb, 'rbse'),
  ('concept', 'primary', 'Primary Data', '["Primary Data","primary data","primary"]'::jsonb, 'rbse'),
  ('concept', 'principal_values', 'Principal Values', '["Principal Values","principal values","principal values"]'::jsonb, 'rbse'),
  ('concept', 'privatisation', 'Privatisation', '["Privatisation","privatisation","privatisation"]'::jsonb, 'rbse'),
  ('concept', 'problems', 'Problems', '["Problems","problems","problems"]'::jsonb, 'rbse'),
  ('concept', 'process', 'Process', '["Process","process","process"]'::jsonb, 'rbse'),
  ('concept', 'product', 'Product', '["Product","product","product"]'::jsonb, 'rbse'),
  ('concept', 'project', 'Project Work', '["Project Work","project work","project"]'::jsonb, 'rbse'),
  ('concept', 'projection', 'Projection', '["Projection","projection","projection"]'::jsonb, 'rbse'),
  ('concept', 'promotion', 'Promotion', '["Promotion","promotion","promotion"]'::jsonb, 'rbse'),
  ('concept', 'properties', 'Properties', '["Properties","properties","properties"]'::jsonb, 'rbse'),
  ('concept', 'property', 'Property', '["Property","property","property"]'::jsonb, 'rbse'),
  ('concept', 'provisions', 'Provisions', '["Provisions","provisions","provisions"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('concept', 'purpose', 'Purpose', '["Purpose","purpose","purpose"]'::jsonb, 'rbse'),
  ('concept', 'quadratic_roots', 'Quadratic Roots', '["Quadratic Roots","quadratic roots","quadratic roots"]'::jsonb, 'rbse'),
  ('concept', 'radian_measure', 'Radian Measure', '["Radian Measure","radian measure","radian measure"]'::jsonb, 'rbse'),
  ('concept', 'random_variable', 'Random Variable', '["Random Variable","random variable","random variable"]'::jsonb, 'rbse'),
  ('concept', 'range_arcsin', 'Range Arcsin', '["Range Arcsin","range arcsin","range arcsin"]'::jsonb, 'rbse'),
  ('concept', 'rate_of_change', 'Rate of Change', '["Rate of Change","rate of change","rate of change"]'::jsonb, 'rbse'),
  ('concept', 'realisation', 'Realisation Account', '["Realisation Account","realisation account","realisation"]'::jsonb, 'rbse'),
  ('concept', 'redemption', 'Redemption', '["Redemption","redemption","redemption"]'::jsonb, 'rbse'),
  ('concept', 'redressal', 'Consumer Redressal', '["Consumer Redressal","consumer redressal","redressal"]'::jsonb, 'rbse'),
  ('concept', 'reforms', 'Economic Reforms', '["Economic Reforms","economic reforms","reforms"]'::jsonb, 'rbse'),
  ('concept', 'relation_types', 'Relation Types', '["Relation Types","relation types","relation types"]'::jsonb, 'rbse'),
  ('concept', 'relationship', 'Relationship', '["Relationship","relationship","relationship"]'::jsonb, 'rbse'),
  ('concept', 'report', 'Report', '["Report","report","report"]'::jsonb, 'rbse'),
  ('concept', 'reporting', 'Reported Speech', '["Reported Speech","reported speech","reporting"]'::jsonb, 'rbse'),
  ('concept', 'reserves', 'Reserves', '["Reserves","reserves","reserves"]'::jsonb, 'rbse'),
  ('concept', 'reserves_dist', 'Distribution of Reserves', '["Distribution of Reserves","distribution of reserves","reserves dist"]'::jsonb, 'rbse'),
  ('concept', 'resources', 'Resources', '["Resources","resources","resources"]'::jsonb, 'rbse'),
  ('concept', 'responsibilities', 'Social Responsibilities', '["Social Responsibilities","social responsibilities","responsibilities"]'::jsonb, 'rbse'),
  ('concept', 'retail', 'Retail Trade', '["Retail Trade","retail trade","retail"]'::jsonb, 'rbse'),
  ('concept', 'retained', 'Retained Earnings', '["Retained Earnings","retained earnings","retained"]'::jsonb, 'rbse'),
  ('concept', 'revaluation', 'Revaluation Account', '["Revaluation Account","revaluation account","revaluation"]'::jsonb, 'rbse'),
  ('concept', 'revenue', 'Revenue', '["Revenue","revenue","revenue"]'::jsonb, 'rbse'),
  ('concept', 'rights', 'Rights', '["Rights","rights","rights"]'::jsonb, 'rbse'),
  ('concept', 'risk', 'Business Risk', '["Business Risk","business risk","risk"]'::jsonb, 'rbse'),
  ('concept', 'role', 'Role', '["Role","role","role"]'::jsonb, 'rbse'),
  ('concept', 'sample_space', 'Sample Space', '["Sample Space","sample space","sample space"]'::jsonb, 'rbse'),
  ('concept', 'scatter', 'Scatter Diagram', '["Scatter Diagram","scatter diagram","scatter"]'::jsonb, 'rbse'),
  ('concept', 'scope', 'Scope', '["Scope","scope","scope"]'::jsonb, 'rbse'),
  ('concept', 'secondary', 'Secondary Data', '["Secondary Data","secondary data","secondary"]'::jsonb, 'rbse'),
  ('concept', 'section_formula', 'Section Formula', '["Section Formula","section formula","section formula"]'::jsonb, 'rbse'),
  ('concept', 'sectors', 'Sectors of Economy', '["Sectors of Economy","sectors of economy","sectors"]'::jsonb, 'rbse'),
  ('concept', 'set_representation', 'Set Representation', '["Set Representation","set representation","set representation"]'::jsonb, 'rbse'),
  ('concept', 'setting', 'Setting', '["Setting","setting","setting"]'::jsonb, 'rbse'),
  ('concept', 'settlement', 'Settlement of Accounts', '["Settlement of Accounts","settlement of accounts","settlement"]'::jsonb, 'rbse'),
  ('concept', 'shapes', 'Shapes of Curves', '["Shapes of Curves","shapes of curves","shapes"]'::jsonb, 'rbse'),
  ('concept', 'shifts', 'Shifts in Demand and Supply', '["Shifts in Demand and Supply","shifts in demand and supply","shifts"]'::jsonb, 'rbse'),
  ('concept', 'short_term', 'Short-term Sources', '["Short-term Sources","short-term sources","short term"]'::jsonb, 'rbse'),
  ('concept', 'sin_values', 'Sin Values', '["Sin Values","sin values","sin values"]'::jsonb, 'rbse'),
  ('concept', 'slope', 'Slope', '["Slope","slope","slope"]'::jsonb, 'rbse'),
  ('concept', 'solution', 'Solution', '["Solution","solution","solution"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('concept', 'sources', 'Sources', '["Sources","sources","sources"]'::jsonb, 'rbse'),
  ('concept', 'span', 'Span of Management', '["Span of Management","span of management","span"]'::jsonb, 'rbse'),
  ('concept', 'special_series', 'Special Series', '["Special Series","special series","special series"]'::jsonb, 'rbse'),
  ('concept', 'stakeholders', 'Stakeholders', '["Stakeholders","stakeholders","stakeholders"]'::jsonb, 'rbse'),
  ('concept', 'standard_integrals', 'Standard Integrals', '["Standard Integrals","standard integrals","standard integrals"]'::jsonb, 'rbse'),
  ('concept', 'standard_limits', 'Standard Limits', '["Standard Limits","standard limits","standard limits"]'::jsonb, 'rbse'),
  ('concept', 'startup', 'Startup', '["Startup","startup","startup"]'::jsonb, 'rbse'),
  ('concept', 'structure', 'Organisational Structure', '["Organisational Structure","organisational structure","structure"]'::jsonb, 'rbse'),
  ('concept', 'subset', 'Subset', '["Subset","subset","subset"]'::jsonb, 'rbse'),
  ('concept', 'substitution', 'Substitution', '["Substitution","substitution","substitution"]'::jsonb, 'rbse'),
  ('concept', 'supervision', 'Supervision', '["Supervision","supervision","supervision"]'::jsonb, 'rbse'),
  ('concept', 'supply', 'Supply', '["Supply","supply","supply"]'::jsonb, 'rbse'),
  ('concept', 'suspense', 'Suspense Account', '["Suspense Account","suspense account","suspense"]'::jsonb, 'rbse'),
  ('concept', 'sustainable', 'Sustainable Development', '["Sustainable Development","sustainable development","sustainable"]'::jsonb, 'rbse'),
  ('concept', 'symbol', 'Symbolism', '["Symbolism","symbolism","symbol"]'::jsonb, 'rbse'),
  ('concept', 'symmetric_skew', 'Symmetric Skew', '["Symmetric Skew","symmetric skew","symmetric skew"]'::jsonb, 'rbse'),
  ('concept', 'synonym', 'Synonyms', '["Synonyms","synonyms","synonym"]'::jsonb, 'rbse'),
  ('concept', 'system_inequalities', 'System Inequalities', '["System Inequalities","system inequalities","system inequalities"]'::jsonb, 'rbse'),
  ('concept', 'tangents_normals', 'Tangents Normals', '["Tangents Normals","tangents normals","tangents normals"]'::jsonb, 'rbse'),
  ('concept', 'taylor', 'Taylor''s Scientific Management', '["Taylor''s Scientific Management","taylor''s scientific management","taylor"]'::jsonb, 'rbse'),
  ('concept', 'techniques', 'Techniques', '["Techniques","techniques","techniques"]'::jsonb, 'rbse'),
  ('concept', 'theme', 'Theme', '["Theme","theme","theme"]'::jsonb, 'rbse'),
  ('concept', 'timing', 'Timing Differences', '["Timing Differences","timing differences","timing"]'::jsonb, 'rbse'),
  ('concept', 'tone', 'Tone', '["Tone","tone","tone"]'::jsonb, 'rbse'),
  ('concept', 'tools', 'Tools of Analysis', '["Tools of Analysis","tools of analysis","tools"]'::jsonb, 'rbse'),
  ('concept', 'trade', 'Foreign Trade', '["Foreign Trade","foreign trade","trade"]'::jsonb, 'rbse'),
  ('concept', 'training', 'Training', '["Training","training","training"]'::jsonb, 'rbse'),
  ('concept', 'transport', 'Transport', '["Transport","transport","transport"]'::jsonb, 'rbse'),
  ('concept', 'transpose', 'Transpose', '["Transpose","transpose","transpose"]'::jsonb, 'rbse'),
  ('concept', 'turnover', 'Turnover Ratios', '["Turnover Ratios","turnover ratios","turnover"]'::jsonb, 'rbse'),
  ('concept', 'types', 'Types', '["Types","types","types"]'::jsonb, 'rbse'),
  ('concept', 'types_discontinuity', 'Types Discontinuity', '["Types Discontinuity","types discontinuity","types discontinuity"]'::jsonb, 'rbse'),
  ('concept', 'types_of_functions', 'Types of Functions', '["Types of Functions","types of functions","types of functions"]'::jsonb, 'rbse'),
  ('concept', 'types_of_relations', 'Types of Relations', '["Types of Relations","types of relations","types of relations"]'::jsonb, 'rbse'),
  ('concept', 'types_of_sets', 'Types of Sets', '["Types of Sets","types of sets","types of sets"]'::jsonb, 'rbse'),
  ('concept', 'union', 'Union', '["Union","union","union"]'::jsonb, 'rbse'),
  ('concept', 'utility', 'Utility', '["Utility","utility","utility"]'::jsonb, 'rbse'),
  ('concept', 'variable_separable', 'Variable Separable', '["Variable Separable","variable separable","variable separable"]'::jsonb, 'rbse'),
  ('concept', 'variables', 'Variables', '["Variables","variables","variables"]'::jsonb, 'rbse'),
  ('concept', 'variables_types', 'Types of Variables', '["Types of Variables","types of variables","variables types"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('concept', 'vectors_basics', 'Vectors Basics', '["Vectors Basics","vectors basics","vectors basics"]'::jsonb, 'rbse'),
  ('concept', 'venn_principle', 'Venn Principle', '["Venn Principle","venn principle","venn principle"]'::jsonb, 'rbse'),
  ('concept', 'vertical', 'Vertical Analysis', '["Vertical Analysis","vertical analysis","vertical"]'::jsonb, 'rbse'),
  ('concept', 'vocabulary_in_context', 'Vocabulary in Context', '["Vocabulary in Context","vocabulary in context","vocabulary in context"]'::jsonb, 'rbse'),
  ('concept', 'wdv', 'Written Down Value Method', '["Written Down Value Method","written down value method","wdv"]'::jsonb, 'rbse'),
  ('concept', 'welfare', 'Welfare', '["Welfare","welfare","welfare"]'::jsonb, 'rbse'),
  ('concept', 'wholesale', 'Wholesale Trade', '["Wholesale Trade","wholesale trade","wholesale"]'::jsonb, 'rbse'),
  ('concept', 'word_problems', 'Word Problems', '["Word Problems","word problems","word problems"]'::jsonb, 'rbse'),
  ('concept', 'wto_etc', 'WTO and International Organisations', '["WTO and International Organisations","wto and international organisations","wto etc"]'::jsonb, 'rbse'),
  ('concept', 'x_axis', 'X Axis', '["X Axis","x axis","x axis"]'::jsonb, 'rbse'),
  ('concept', 'y_axis', 'Y Axis', '["Y Axis","y axis","y axis"]'::jsonb, 'rbse'),
  ('concept', 'अव्यय', 'अव्यय', '["अव्यय","अव्यय","अव्यय"]'::jsonb, 'rbse'),
  ('concept', 'उपमा', 'उपमा', '["उपमा","उपमा","उपमा"]'::jsonb, 'rbse'),
  ('concept', 'उपसर्ग', 'उपसर्ग', '["उपसर्ग","उपसर्ग","उपसर्ग"]'::jsonb, 'rbse'),
  ('concept', 'औपचारिक', 'औपचारिक', '["औपचारिक","औपचारिक","औपचारिक"]'::jsonb, 'rbse'),
  ('concept', 'काल', 'काल', '["काल","काल","काल"]'::jsonb, 'rbse'),
  ('concept', 'काव्य', 'काव्य', '["काव्य","काव्य","काव्य"]'::jsonb, 'rbse'),
  ('concept', 'काव्य_सौंदर्य', 'काव्य_सौंदर्य', '["काव्य_सौंदर्य","काव्य_सौंदर्य","काव्य सौंदर्य"]'::jsonb, 'rbse'),
  ('concept', 'चरित्र', 'चरित्र', '["चरित्र","चरित्र","चरित्र"]'::jsonb, 'rbse'),
  ('concept', 'छंद_भाव', 'छंद_भाव', '["छंद_भाव","छंद_भाव","छंद भाव"]'::jsonb, 'rbse'),
  ('concept', 'तत्पुरुष', 'तत्पुरुष', '["तत्पुरुष","तत्पुरुष","तत्पुरुष"]'::jsonb, 'rbse'),
  ('concept', 'पर्याय', 'पर्याय', '["पर्याय","पर्याय","पर्याय"]'::jsonb, 'rbse'),
  ('concept', 'पाठ_बोध', 'पाठ_बोध', '["पाठ_बोध","पाठ_बोध","पाठ बोध"]'::jsonb, 'rbse'),
  ('concept', 'प्रत्यय', 'प्रत्यय', '["प्रत्यय","प्रत्यय","प्रत्यय"]'::jsonb, 'rbse'),
  ('concept', 'बिम्ब', 'बिम्ब', '["बिम्ब","बिम्ब","बिम्ब"]'::jsonb, 'rbse'),
  ('concept', 'भक्ति', 'भक्ति', '["भक्ति","भक्ति","भक्ति"]'::jsonb, 'rbse'),
  ('concept', 'भविष्य', 'भविष्य', '["भविष्य","भविष्य","भविष्य"]'::jsonb, 'rbse'),
  ('concept', 'भाव', 'भाव', '["भाव","भाव","भाव"]'::jsonb, 'rbse'),
  ('concept', 'मुहावरा', 'मुहावरा', '["मुहावरा","मुहावरा","मुहावरा"]'::jsonb, 'rbse'),
  ('concept', 'रस', 'रस', '["रस","रस","रस"]'::jsonb, 'rbse'),
  ('concept', 'लेखक_कवि', 'लेखक_कवि', '["लेखक_कवि","लेखक_कवि","लेखक कवि"]'::jsonb, 'rbse'),
  ('concept', 'लेखिका', 'लेखिका', '["लेखिका","लेखिका","लेखिका"]'::jsonb, 'rbse'),
  ('concept', 'वर्तनी', 'वर्तनी', '["वर्तनी","वर्तनी","वर्तनी"]'::jsonb, 'rbse'),
  ('concept', 'वाच्य', 'वाच्य', '["वाच्य","वाच्य","वाच्य"]'::jsonb, 'rbse'),
  ('concept', 'विधा', 'विधा', '["विधा","विधा","विधा"]'::jsonb, 'rbse'),
  ('concept', 'विलोम', 'विलोम', '["विलोम","विलोम","विलोम"]'::jsonb, 'rbse'),
  ('concept', 'विषय', 'विषय', '["विषय","विषय","विषय"]'::jsonb, 'rbse'),
  ('concept', 'व्यंग्य', 'व्यंग्य', '["व्यंग्य","व्यंग्य","व्यंग्य"]'::jsonb, 'rbse'),
  ('concept', 'व्यंजन', 'व्यंजन', '["व्यंजन","व्यंजन","व्यंजन"]'::jsonb, 'rbse'),
  ('concept', 'शीर्षक', 'शीर्षक', '["शीर्षक","शीर्षक","शीर्षक"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
VALUES
  ('concept', 'शुद्ध_वाक्य', 'शुद्ध_वाक्य', '["शुद्ध_वाक्य","शुद्ध_वाक्य","शुद्ध वाक्य"]'::jsonb, 'rbse'),
  ('concept', 'शुद्धि', 'शुद्धि', '["शुद्धि","शुद्धि","शुद्धि"]'::jsonb, 'rbse'),
  ('concept', 'समास', 'समास', '["समास","समास","समास"]'::jsonb, 'rbse'),
  ('concept', 'स्वर_संधि', 'स्वर_संधि', '["स्वर_संधि","स्वर_संधि","स्वर संधि"]'::jsonb, 'rbse')
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

-- Normalize chapter display text (mojibake / unicode dashes)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_fix_academic_display_text'
  ) THEN
    UPDATE public.question_bank
    SET chapter = public._fix_academic_display_text(chapter)
    WHERE chapter IS NOT NULL
      AND (chapter LIKE '%â€%' OR chapter LIKE '%Â%' OR chapter ~ '[‐‑‒–—―−]');
  ELSE
    UPDATE public.question_bank
    SET chapter = trim(both from regexp_replace(
      regexp_replace(chapter, '[‐‑‒–—―−]', '-', 'g'),
      '\s+', ' ', 'g'))
    WHERE chapter IS NOT NULL AND chapter ~ '[‐‑‒–—―−]';
  END IF;
END $$;

-- Slugify topic/concept when they match taxonomy term ids
UPDATE public.question_bank qb
SET concept = lower(regexp_replace(regexp_replace(btrim(qb.concept), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
WHERE qb.concept IS NOT NULL
  AND qb.concept ~ '[A-Z ]'
  AND length(btrim(qb.concept)) BETWEEN 2 AND 80
  AND EXISTS (
    SELECT 1 FROM public.academic_taxonomy_terms t
    WHERE t.kind = 'concept'
      AND (
        t.term_id = lower(regexp_replace(regexp_replace(btrim(qb.concept), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
        OR lower(t.display_name) = lower(btrim(qb.concept))
      )
  );

UPDATE public.question_bank qb
SET topic = lower(regexp_replace(regexp_replace(btrim(qb.topic), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
WHERE qb.topic IS NOT NULL
  AND qb.topic ~ '[A-Z ]'
  AND length(btrim(qb.topic)) BETWEEN 2 AND 80
  AND EXISTS (
    SELECT 1 FROM public.academic_taxonomy_terms t
    WHERE t.kind IN ('concept', 'topic')
      AND (
        t.term_id = lower(regexp_replace(regexp_replace(btrim(qb.topic), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
        OR lower(t.display_name) = lower(btrim(qb.topic))
      )
  );
