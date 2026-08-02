-- ============================================================================
-- Academic taxonomy v2 — full commerce bank concepts + chapters
-- Companion: src/academic/taxonomy (presentAcademicLabel / formatAcademicLabel)
-- Apply in Supabase SQL editor (idempotent upserts)
-- Chapter term_id = {slug}_{subject}_c{class} so 11/12 title repeats never collide
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
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('subject'::text, 'accountancy', 'Accountancy', '["accounts","accounting"]'::jsonb, 'rbse'::text),
    ('subject'::text, 'business_studies', 'Business Studies', '["bst"]'::jsonb, 'rbse'::text),
    ('subject'::text, 'economics', 'Economics', '["eco"]'::jsonb, 'rbse'::text),
    ('subject'::text, 'mathematics', 'Mathematics', '["maths","math"]'::jsonb, 'rbse'::text),
    ('subject'::text, 'english', 'English', '[]'::jsonb, 'rbse'::text),
    ('subject'::text, 'hindi', 'Hindi', '[]'::jsonb, 'rbse'::text),
    ('subject'::text, 'physics', 'Physics', '[]'::jsonb, 'rbse'::text),
    ('subject'::text, 'chemistry', 'Chemistry', '[]'::jsonb, 'rbse'::text),
    ('subject'::text, 'biology', 'Biology', '[]'::jsonb, 'rbse'::text),
    ('subject'::text, 'computer_science', 'Computer Science', '["cs"]'::jsonb, 'rbse'::text),
    ('subject'::text, 'informatics_practices', 'Informatics Practices', '["ip"]'::jsonb, 'rbse'::text),
    ('subject'::text, 'social_science', 'Social Science', '["sst","social studies"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

-- Chapters from live QB (term_id unique per subject+class)
INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
SELECT kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('chapter'::text, 'accounting_for_partnership_basic_concepts_accountancy_c12', 'Accounting for Partnership - Basic Concepts', '[]'::jsonb, 'rbse'::text, 12::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'accounting_for_share_capital_accountancy_c12', 'Accounting for Share Capital', '[]'::jsonb, 'rbse'::text, 12::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'accounting_ratios_accountancy_c12', 'Accounting Ratios', '[]'::jsonb, 'rbse'::text, 12::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'analysis_of_financial_statements_accountancy_c12', 'Analysis of Financial Statements', '[]'::jsonb, 'rbse'::text, 12::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'bank_reconciliation_statement_accountancy_c11', 'Bank Reconciliation Statement', '[]'::jsonb, 'rbse'::text, 11::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'cash_flow_statement_accountancy_c12', 'Cash Flow Statement', '[]'::jsonb, 'rbse'::text, 12::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'depreciation_provisions_and_reserves_accountancy_c11', 'Depreciation, Provisions and Reserves', '[]'::jsonb, 'rbse'::text, 11::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'dissolution_of_partnership_firm_accountancy_c12', 'Dissolution of Partnership Firm', '[]'::jsonb, 'rbse'::text, 12::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'financial_statements_i_accountancy_c11', 'Financial Statements - I', '[]'::jsonb, 'rbse'::text, 11::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'financial_statements_ii_accountancy_c11', 'Financial Statements - II', '[]'::jsonb, 'rbse'::text, 11::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'financial_statements_of_a_company_accountancy_c12', 'Financial Statements of a Company', '[]'::jsonb, 'rbse'::text, 12::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'introduction_to_accounting_accountancy_c11', 'Introduction to Accounting', '[]'::jsonb, 'rbse'::text, 11::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'issue_and_redemption_of_debentures_accountancy_c12', 'Issue and Redemption of Debentures', '[]'::jsonb, 'rbse'::text, 12::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'reconstitution_admission_accountancy_c12', 'Reconstitution - Admission', '[]'::jsonb, 'rbse'::text, 12::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'reconstitution_retirement_death_accountancy_c12', 'Reconstitution - Retirement/Death', '[]'::jsonb, 'rbse'::text, 12::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'recording_of_transactions_i_accountancy_c11', 'Recording of Transactions-I', '[]'::jsonb, 'rbse'::text, 11::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'recording_of_transactions_ii_accountancy_c11', 'Recording of Transactions-II', '[]'::jsonb, 'rbse'::text, 11::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'theory_base_of_accounting_accountancy_c11', 'Theory Base of Accounting', '[]'::jsonb, 'rbse'::text, 11::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'trial_balance_and_rectification_of_errors_accountancy_c11', 'Trial Balance and Rectification of Errors', '[]'::jsonb, 'rbse'::text, 11::int, 'Accountancy', 'accountancy'),
    ('chapter'::text, 'business_environment_business_studies_c12', 'Business Environment', '[]'::jsonb, 'rbse'::text, 12::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'business_services_business_studies_c11', 'Business Services', '[]'::jsonb, 'rbse'::text, 11::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'consumer_protection_business_studies_c12', 'Consumer Protection', '[]'::jsonb, 'rbse'::text, 12::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'controlling_business_studies_c12', 'Controlling', '[]'::jsonb, 'rbse'::text, 12::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'directing_business_studies_c12', 'Directing', '[]'::jsonb, 'rbse'::text, 12::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'emerging_modes_of_business_business_studies_c11', 'Emerging Modes of Business', '[]'::jsonb, 'rbse'::text, 11::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'financial_management_business_studies_c12', 'Financial Management', '[]'::jsonb, 'rbse'::text, 12::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'formation_of_a_company_business_studies_c11', 'Formation of a Company', '[]'::jsonb, 'rbse'::text, 11::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'forms_of_business_organisation_business_studies_c11', 'Forms of Business Organisation', '[]'::jsonb, 'rbse'::text, 11::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'internal_trade_business_studies_c11', 'Internal Trade', '[]'::jsonb, 'rbse'::text, 11::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'international_business_business_studies_c11', 'International Business', '[]'::jsonb, 'rbse'::text, 11::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'marketing_management_business_studies_c12', 'Marketing Management', '[]'::jsonb, 'rbse'::text, 12::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'msme_and_business_entrepreneurship_business_studies_c11', 'MSME and Business Entrepreneurship', '[]'::jsonb, 'rbse'::text, 11::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'nature_and_purpose_of_business_business_studies_c11', 'Nature and Purpose of Business', '[]'::jsonb, 'rbse'::text, 11::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'nature_and_significance_of_management_business_studies_c12', 'Nature and Significance of Management', '[]'::jsonb, 'rbse'::text, 12::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'organising_business_studies_c12', 'Organising', '[]'::jsonb, 'rbse'::text, 12::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'planning_business_studies_c12', 'Planning', '[]'::jsonb, 'rbse'::text, 12::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'principles_of_management_business_studies_c12', 'Principles of Management', '[]'::jsonb, 'rbse'::text, 12::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'private_public_and_global_enterprises_business_studies_c11', 'Private, Public and Global Enterprises', '[]'::jsonb, 'rbse'::text, 11::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'social_responsibilities_of_business_and_business_ethics_business_studies_c11', 'Social Responsibilities of Business and Business Ethics', '[]'::jsonb, 'rbse'::text, 11::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'sources_of_business_finance_business_studies_c11', 'Sources of Business Finance', '[]'::jsonb, 'rbse'::text, 11::int, 'Business Studies', 'business_studies')
  ) AS v(kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
SELECT kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('chapter'::text, 'staffing_business_studies_c12', 'Staffing', '[]'::jsonb, 'rbse'::text, 12::int, 'Business Studies', 'business_studies'),
    ('chapter'::text, 'collection_of_data_economics_c11', 'Collection of Data', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'comparative_development_experiences_economics_c11', 'Comparative Development Experiences', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'correlation_economics_c11', 'Correlation', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'determination_of_income_and_employment_economics_c12', 'Determination of Income and Employment', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'employment_economics_c11', 'Employment', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'environment_and_sustainable_development_economics_c11', 'Environment and Sustainable Development', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'government_budget_and_the_economy_economics_c12', 'Government Budget and the Economy', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'human_capital_formation_economics_c11', 'Human Capital Formation', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'index_numbers_economics_c11', 'Index Numbers', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'indian_economy_1950_1990_economics_c11', 'Indian Economy 1950-1990', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'indian_economy_on_the_eve_of_independence_economics_c11', 'Indian Economy on the Eve of Independence', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'introduction_economics_c11', 'Introduction', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'introduction_economics_c12', 'Introduction', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'introduction_to_macroeconomics_economics_c12', 'Introduction to Macroeconomics', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'lpg_an_appraisal_economics_c11', 'LPG - An Appraisal', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'market_equilibrium_economics_c12', 'Market Equilibrium', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'measures_of_central_tendency_economics_c11', 'Measures of Central Tendency', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'money_and_banking_economics_c12', 'Money and Banking', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'national_income_accounting_economics_c12', 'National Income Accounting', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'non_competitive_markets_economics_c12', 'Non-competitive Markets', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'open_economy_macroeconomics_economics_c12', 'Open Economy Macroeconomics', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'organisation_of_data_economics_c11', 'Organisation of Data', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'presentation_of_data_economics_c11', 'Presentation of Data', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'production_and_costs_economics_c12', 'Production and Costs', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'rural_development_economics_c11', 'Rural Development', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'the_theory_of_the_firm_under_perfect_competition_economics_c12', 'The Theory of the Firm under Perfect Competition', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'theory_of_consumer_behaviour_economics_c12', 'Theory of Consumer Behaviour', '[]'::jsonb, 'rbse'::text, 12::int, 'Economics', 'economics'),
    ('chapter'::text, 'use_of_statistical_tools_economics_c11', 'Use of Statistical Tools', '[]'::jsonb, 'rbse'::text, 11::int, 'Economics', 'economics'),
    ('chapter'::text, 'a_roadside_stand_english_c12', 'A Roadside Stand', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'a_thing_of_beauty_english_c12', 'A Thing of Beauty', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'aunt_jennifer_s_tigers_english_c12', 'Aunt Jennifer’s Tigers', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'birth_english_c11', 'Birth', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'business_english_english_c11', 'Business English', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'business_english_english_c12', 'Business English', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'comprehension_skills_english_c11', 'Comprehension Skills', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'comprehension_skills_english_c12', 'Comprehension Skills', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'deep_water_english_c12', 'Deep Water', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'discovering_tut_english_c11', 'Discovering Tut', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'going_places_english_c12', 'Going Places', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english')
  ) AS v(kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
SELECT kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('chapter'::text, 'grammar_articles_english_c11', 'Grammar - Articles', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'grammar_modals_english_c12', 'Grammar - Modals', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'grammar_prepositions_english_c11', 'Grammar - Prepositions', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'grammar_reported_speech_english_c12', 'Grammar - Reported Speech', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'grammar_subject_verb_agreement_english_c11', 'Grammar - Subject-Verb Agreement', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'grammar_tenses_english_c11', 'Grammar - Tenses', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'indigo_english_c12', 'Indigo', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'journey_to_the_end_of_the_earth_english_c12', 'Journey to the End of the Earth', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'keeping_quiet_english_c12', 'Keeping Quiet', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'lost_spring_english_c12', 'Lost Spring', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'mother_s_day_english_c11', 'Mother’s Day', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'my_mother_at_sixty_six_english_c12', 'My Mother at Sixty-Six', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'on_the_face_of_it_english_c12', 'On the Face of It', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'poets_and_pancakes_english_c12', 'Poets and Pancakes', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'silk_road_english_c11', 'Silk Road', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'the_address_english_c11', 'The Address', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'the_adventure_english_c11', 'The Adventure', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'the_ailing_planet_english_c11', 'The Ailing Planet', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'the_enemy_english_c12', 'The Enemy', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'the_interview_english_c12', 'The Interview', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'the_last_lesson_english_c12', 'The Last Lesson', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'the_portrait_of_a_lady_english_c11', 'The Portrait of a Lady', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'the_rattrap_english_c12', 'The Rattrap', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'the_summer_of_the_beautiful_white_horse_english_c11', 'The Summer of the Beautiful White Horse', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'the_tale_of_melon_city_english_c11', 'The Tale of Melon City', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'the_third_level_english_c12', 'The Third Level', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'the_tiger_king_english_c12', 'The Tiger King', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'vocabulary_english_c11', 'Vocabulary', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'vocabulary_english_c12', 'Vocabulary', '[]'::jsonb, 'rbse'::text, 12::int, 'English', 'english'),
    ('chapter'::text, 'we_re_not_afraid_to_die_english_c11', 'We’re Not Afraid to Die…', '[]'::jsonb, 'rbse'::text, 11::int, 'English', 'english'),
    ('chapter'::text, 'अतीत_में_दबे_पाँव_hindi_c12', 'अतीत में दबे पाँव', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'आओ_मिलकर_बचाएँ_hindi_c11', 'आओ मिलकर बचाएँ', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'आत्मपरिचय_hindi_c12', 'आत्मपरिचय', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'आलो_आँधारि_hindi_c11', 'आलो आँधारि', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'उषा_hindi_c12', 'उषा', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'कबीर_के_पद_hindi_c11', 'कबीर के पद', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'कविता_के_बहाने_hindi_c12', 'कविता के बहाने', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'काले_मेघा_पानी_दे_hindi_c12', 'काले मेघा पानी दे', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'काव्य_पद_hindi_c12', 'काव्य - पद', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'काव्य_सौंदर्य_hindi_c12', 'काव्य सौंदर्य', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi')
  ) AS v(kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
SELECT kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('chapter'::text, 'कैमरे_में_बंद_अपाहिज_hindi_c12', 'कैमरे में बंद अपाहिज', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'ग़ज़ल_hindi_c11', 'ग़ज़ल', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'गद्यांश_बोध_hindi_c12', 'गद्यांश बोध', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'गलता_लोहा_hindi_c11', 'गलता लोहा', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'घर_की_याद_hindi_c11', 'घर की याद', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'जामुन_का_पेड़_hindi_c11', 'जामुन का पेड़', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'जूझ_hindi_c12', 'जूझ', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'डायरी_के_पन्ने_hindi_c12', 'डायरी के पन्ने', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'नमक_का_दारोगा_hindi_c11', 'नमक का दारोगा', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'नाना_साहब_की_पुत्री_देवी_मैना_को_भस्म_कर_दिया_गया_hindi_c12', 'नाना साहब की पुत्री देवी मैना को भस्म कर दिया गया', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'पतंग_hindi_c12', 'पतंग', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'पत्र_लेखन_hindi_c12', 'पत्र लेखन', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'पहलवान_की_ढोलक_hindi_c12', 'पहलवान की ढोलक', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'बाजार_दर्शन_hindi_c12', 'बाजार दर्शन', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'बादल_राग_hindi_c12', 'बादल राग', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'भक्तिन_hindi_c12', 'भक्तिन', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'भारत_माता_hindi_c11', 'भारत माता', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'भारतीय_गायिकाओं_में_बेजोड़_लता_मंगेशकर_hindi_c11', 'भारतीय गायिकाओं में बेजोड़ - लता मंगेशकर', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'मियाँ_नसीरुद्दीन_hindi_c11', 'मियाँ नसीरुद्दीन', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'मीरा_के_पद_hindi_c11', 'मीरा के पद', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'राजस्थान_की_रजत_बूँदें_hindi_c11', 'राजस्थान की रजत बूँदें', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'वह_आँखें_hindi_c11', 'वह आँखें', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_अलंकार_hindi_c12', 'व्याकरण - अलंकार', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_अव्यय_hindi_c12', 'व्याकरण - अव्यय', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_उपसर्ग_hindi_c11', 'व्याकरण - उपसर्ग', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_काल_hindi_c11', 'व्याकरण - काल', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_काल_hindi_c12', 'व्याकरण - काल', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_पर्यायवाची_hindi_c11', 'व्याकरण - पर्यायवाची', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_पर्यायवाची_hindi_c12', 'व्याकरण - पर्यायवाची', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_प्रत्यय_hindi_c11', 'व्याकरण - प्रत्यय', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_मुहावरा_hindi_c11', 'व्याकरण - मुहावरा', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_मुहावरा_hindi_c12', 'व्याकरण - मुहावरा', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_रस_hindi_c12', 'व्याकरण - रस', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_वर्तनी_hindi_c11', 'व्याकरण - वर्तनी', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_वर्तनी_hindi_c12', 'व्याकरण - वर्तनी', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_वाक्य_hindi_c11', 'व्याकरण - वाक्य', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_वाक्य_शुद्धि_hindi_c12', 'व्याकरण - वाक्य शुद्धि', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_वाच्य_hindi_c12', 'व्याकरण - वाच्य', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_विलोम_hindi_c11', 'व्याकरण - विलोम', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_विलोम_hindi_c12', 'व्याकरण - विलोम', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi')
  ) AS v(kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
SELECT kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('chapter'::text, 'व्याकरण_संधि_hindi_c11', 'व्याकरण - संधि', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_संधि_hindi_c12', 'व्याकरण - संधि', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_समास_hindi_c11', 'व्याकरण - समास', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'व्याकरण_समास_hindi_c12', 'व्याकरण - समास', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'शुक्रतारे_के_समान_hindi_c12', 'शुक्रतारे के समान', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'श्रम_विभाजन_और_जाति_प्रथा_hindi_c12', 'श्रम विभाजन और जाति प्रथा', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'सहर्ष_स्वीकारा_है_hindi_c12', 'सहर्ष स्वीकारा है', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'सिल्वर_वैडिंग_hindi_c12', 'सिल्वर वैडिंग', '[]'::jsonb, 'rbse'::text, 12::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'स्पिति_में_बारिश_hindi_c11', 'स्पिति में बारिश', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'हे_भूख_hindi_c11', 'हे भूख!', '[]'::jsonb, 'rbse'::text, 11::int, 'Hindi', 'hindi'),
    ('chapter'::text, 'application_of_derivatives_mathematics_c12', 'Application of Derivatives', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'application_of_integrals_mathematics_c12', 'Application of Integrals', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'binomial_theorem_mathematics_c11', 'Binomial Theorem', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'complex_numbers_and_quadratic_equations_mathematics_c11', 'Complex Numbers and Quadratic Equations', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'conic_sections_mathematics_c11', 'Conic Sections', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'continuity_and_differentiability_mathematics_c12', 'Continuity and Differentiability', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'determinants_mathematics_c12', 'Determinants', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'differential_equations_mathematics_c12', 'Differential Equations', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'integrals_mathematics_c12', 'Integrals', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'introduction_to_three_dimensional_geometry_mathematics_c11', 'Introduction to Three Dimensional Geometry', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'inverse_trigonometric_functions_mathematics_c12', 'Inverse Trigonometric Functions', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'limits_and_derivatives_mathematics_c11', 'Limits and Derivatives', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'linear_inequalities_mathematics_c11', 'Linear Inequalities', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'linear_programming_mathematics_c12', 'Linear Programming', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'matrices_mathematics_c12', 'Matrices', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'permutations_and_combinations_mathematics_c11', 'Permutations and Combinations', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'probability_mathematics_c11', 'Probability', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'probability_mathematics_c12', 'Probability', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'relations_and_functions_mathematics_c11', 'Relations and Functions', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'relations_and_functions_mathematics_c12', 'Relations and Functions', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'sequences_and_series_mathematics_c11', 'Sequences and Series', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'sets_mathematics_c11', 'Sets', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'statistics_mathematics_c11', 'Statistics', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'straight_lines_mathematics_c11', 'Straight Lines', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'three_dimensional_geometry_mathematics_c12', 'Three Dimensional Geometry', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'trigonometric_functions_mathematics_c11', 'Trigonometric Functions', '[]'::jsonb, 'rbse'::text, 11::int, 'Mathematics', 'mathematics'),
    ('chapter'::text, 'vector_algebra_mathematics_c12', 'Vector Algebra', '[]'::jsonb, 'rbse'::text, 12::int, 'Mathematics', 'mathematics')
  ) AS v(kind, term_id, display_name, aliases, board, class_level, subject, parent_term_id)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  class_level = COALESCE(EXCLUDED.class_level, public.academic_taxonomy_terms.class_level),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  parent_term_id = COALESCE(EXCLUDED.parent_term_id, public.academic_taxonomy_terms.parent_term_id),
  updated_at = now();

-- Concepts / topics (bank + curated core)
INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('concept'::text, '1991', '1991 Economic Reforms', '["1991 Economic Reforms","1991 economic reforms","1991"]'::jsonb, 'rbse'::text),
    ('concept'::text, '4ps', '4Ps (Marketing Mix)', '["4Ps (Marketing Mix)","4ps (marketing mix)","4ps"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'addition_rule', 'Addition Rule', '["Addition Rule","addition rule","addition rule"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'addition_scalar', 'Addition Scalar', '["Addition Scalar","addition scalar","addition scalar"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'adjoint_inverse', 'Adjoint Inverse', '["Adjoint Inverse","adjoint inverse","adjoint inverse"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'adjustments', 'Adjustments', '["Adjustments","adjustments","adjustments"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'aggregates', 'National Income Aggregates', '["National Income Aggregates","national income aggregates","aggregates"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'agreement', 'Subject-Verb Agreement', '["Subject-Verb Agreement","subject-verb agreement","agreement"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'agriculture', 'Agriculture', '["Agriculture","agriculture","agriculture"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'algebra_of_complex', 'Algebra of Complex', '["Algebra of Complex","algebra of complex","algebra of complex"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'algebra_of_limits', 'Algebra of Limits', '["Algebra of Limits","algebra of limits","algebra of limits"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'analysis', 'Analysis', '["Analysis","analysis","analysis"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'angle_between_lines', 'Angle Between Lines', '["Angle Between Lines","angle between lines","angle between lines"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'angle_lines_planes', 'Angle Lines Planes', '["Angle Lines Planes","angle lines planes","angle lines planes"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'antiderivative', 'Antiderivative', '["Antiderivative","antiderivative","antiderivative"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'aoa', 'Articles of Association', '["Articles of Association","articles of association","aoa"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'ap', 'Arithmetic Progression', '["Arithmetic Progression","arithmetic progression","ap"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'ap_basics', 'Arithmetic Progression Basics', '["Arithmetic Progression Basics","arithmetic progression basics","ap basics"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'ap_sum', 'Sum of an AP', '["Sum of an AP","sum of an ap","ap sum"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'appraisal', 'Performance Appraisal', '["Performance Appraisal","performance appraisal","appraisal"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'approximations', 'Approximations', '["Approximations","approximations","approximations"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'area', 'Area', '["Area","area","area"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'area_between_curves', 'Area Between Curves', '["Area Between Curves","area between curves","area between curves"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'area_under_curve', 'Area Under Curve', '["Area Under Curve","area under curve","area under curve"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'arguments', 'Arguments', '["Arguments","arguments","arguments"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'articles', 'Articles', '["Articles","articles","articles"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'authorised', 'Authorised Capital', '["Authorised Capital","authorised capital","authorised"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'banking', 'Banking', '["Banking","banking","banking"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'basic', 'Basic', '["Basic","basic","basic"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'basic_derivatives', 'Basic Derivatives', '["Basic Derivatives","basic derivatives","basic derivatives"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'bayes', 'Bayes'' Theorem', '["Bayes'' Theorem","bayes'' theorem","bayes"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'bayes_setup', 'Bayes'' Theorem Setup', '["Bayes'' Theorem Setup","bayes'' theorem setup","bayes setup"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'benefits', 'Benefits', '["Benefits","benefits","benefits"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'binomial_coefficients', 'Binomial Coefficients', '["Binomial Coefficients","binomial coefficients","binomial coefficients"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'bivariate', 'Bivariate Data', '["Bivariate Data","bivariate data","bivariate"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'bop', 'Balance of Payments', '["Balance of Payments","balance of payments","bop"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'branches', 'Branches of Accounting', '["Branches of Accounting","branches of accounting","branches"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'budget', 'Budget', '["Budget","budget","budget"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'capital', 'Capital', '["Capital","capital","capital"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'cartesian_product', 'Cartesian Product', '["Cartesian Product","cartesian product","cartesian product"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('concept'::text, 'categories', 'Categories', '["Categories","categories","categories"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'chain_rule', 'Chain Rule', '["Chain Rule","chain rule","chain rule"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'chambers', 'Chambers of Commerce', '["Chambers of Commerce","chambers of commerce","chambers"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'character', 'Character', '["Character","character","character"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'characteristics', 'Characteristics', '["Characteristics","characteristics","characteristics"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'circle', 'Circle', '["Circle","circle","circle"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'circular_permutation', 'Circular Permutation', '["Circular Permutation","circular permutation","circular permutation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'classical', 'Classical', '["Classical","classical","classical"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'classical_probability', 'Classical Probability', '["Classical Probability","classical probability","classical probability"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'classification', 'Classification', '["Classification","classification","classification"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'cogs', 'Cost of Goods Sold', '["Cost of Goods Sold","cost of goods sold","cogs"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'colonial', 'Colonial Economy', '["Colonial Economy","colonial economy","colonial"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'combinations', 'Combinations', '["Combinations","combinations","combinations"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'commerce', 'Commerce', '["Commerce","commerce","commerce"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'communication', 'Communication', '["Communication","communication","communication"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'company', 'Company', '["Company","company","company"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'comparison', 'Comparison', '["Comparison","comparison","comparison"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'compensating', 'Compensating Errors', '["Compensating Errors","compensating errors","compensating"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'complementary_angles', 'Complementary Angles', '["Complementary Angles","complementary angles","complementary angles"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'complementary_events', 'Complementary Events', '["Complementary Events","complementary events","complementary events"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'composition', 'Composition', '["Composition","composition","composition"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'concepts', 'Concepts', '["Concepts","concepts","concepts"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'concision', 'Concision', '["Concision","concision","concision"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'concurrency', 'Concurrency', '["Concurrency","concurrency","concurrency"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'conditional', 'Conditional', '["Conditional","conditional","conditional"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'consistency', 'Consistency Concept', '["Consistency Concept","consistency concept","consistency"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'constraints', 'Constraints', '["Constraints","constraints","constraints"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'continuity', 'Continuity', '["Continuity","continuity","continuity"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'cooperative', 'Cooperative Society', '["Cooperative Society","cooperative society","cooperative"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'coordinates_3d', 'Coordinates 3D', '["Coordinates 3D","coordinates 3d","coordinates 3d"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'corner_point', 'Corner Point', '["Corner Point","corner point","corner point"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'costs', 'Costs', '["Costs","costs","costs"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'credit', 'Credit', '["Credit","credit","credit"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'cross_product', 'Cross Product', '["Cross Product","cross product","cross product"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'crr', 'Cash Reserve Ratio', '["Cash Reserve Ratio","cash reserve ratio","crr"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'csr', 'Corporate Social Responsibility', '["Corporate Social Responsibility","corporate social responsibility","csr"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'deadweight', 'Deadweight Loss', '["Deadweight Loss","deadweight loss","deadweight"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'decentralisation', 'Decentralisation', '["Decentralisation","decentralisation","decentralisation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'deficit', 'Budget Deficit', '["Budget Deficit","budget deficit","deficit"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'definite', 'Definite', '["Definite","definite","definite"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('concept'::text, 'definite_area', 'Definite Area', '["Definite Area","definite area","definite area"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'definite_integral', 'Definite Integral', '["Definite Integral","definite integral","definite integral"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'definition', 'Definition', '["Definition","definition","definition"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'delegation', 'Delegation', '["Delegation","delegation","delegation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'demand', 'Demand', '["Demand","demand","demand"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'demographic', 'Demographic Profile', '["Demographic Profile","demographic profile","demographic"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'depreciation', 'Depreciation', '["Depreciation","depreciation","depreciation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'derivative', 'Derivative', '["Derivative","derivative","derivative"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'derivative_definition', 'Derivative Definition', '["Derivative Definition","derivative definition","derivative definition"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'det2', '2×2 Determinant', '["2×2 Determinant","2×2 determinant","det2"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'determinant_2x2', 'Determinant 2x2', '["Determinant 2x2","determinant 2x2","determinant 2x2"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'determinant_3x3', 'Determinant 3x3', '["Determinant 3x3","determinant 3x3","determinant 3x3"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'deviations', 'Deviations', '["Deviations","deviations","deviations"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'device', 'Literary Device', '["Literary Device","literary device","device"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'differentiability', 'Differentiability', '["Differentiability","differentiability","differentiability"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'dilemma', 'Dilemma', '["Dilemma","dilemma","dilemma"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'dimensions', 'Dimensions of Business Environment', '["Dimensions of Business Environment","dimensions of business environment","dimensions"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'direction', 'Direction of Trade', '["Direction of Trade","direction of trade","direction"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'direction_cosines', 'Direction Cosines', '["Direction Cosines","direction cosines","direction cosines"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'direction_ratios', 'Direction Ratios', '["Direction Ratios","direction ratios","direction ratios"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'discriminant', 'Discriminant', '["Discriminant","discriminant","discriminant"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'disinvestment', 'Disinvestment', '["Disinvestment","disinvestment","disinvestment"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'dispersion_intro', 'Dispersion Intro', '["Dispersion Intro","dispersion intro","dispersion intro"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'distance', 'Distance', '["Distance","distance","distance"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'distance_3d', 'Distance 3D', '["Distance 3D","distance 3d","distance 3d"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'dividend', 'Dividend Decision', '["Dividend Decision","dividend decision","dividend"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'division_into_groups', 'Division Into Groups', '["Division Into Groups","division into groups","division into groups"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'domain', 'Domain', '["Domain","domain","domain"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'domain_range', 'Domain Range', '["Domain Range","domain range","domain range"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'domain_range_inv_trig', 'Domain Range Inv Trig', '["Domain Range Inv Trig","domain range inv trig","domain range inv trig"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'dot', 'Dot', '["Dot","dot","dot"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'dot_product', 'Dot Product', '["Dot Product","dot product","dot product"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'ecommerce', 'e-Commerce', '["e-Commerce","e-commerce","ecommerce"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'education', 'Education', '["Education","education","education"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'efficiency', 'Efficiency', '["Efficiency","efficiency","efficiency"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'elasticity', 'Elasticity', '["Elasticity","elasticity","elasticity"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'elements', 'Elements', '["Elements","elements","elements"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'ellipse', 'Ellipse', '["Ellipse","ellipse","ellipse"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'entrepreneur', 'Entrepreneurship', '["Entrepreneurship","entrepreneurship","entrepreneur"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'environment', 'Business Environment', '["Business Environment","business environment","environment"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('concept'::text, 'epayments', 'Electronic Payments', '["Electronic Payments","electronic payments","epayments"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'equilibrium', 'Equilibrium', '["Equilibrium","equilibrium","equilibrium"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'equivalence_relation', 'Equivalence Relation', '["Equivalence Relation","equivalence relation","equivalence relation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'errors', 'Errors', '["Errors","errors","errors"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'esprit', 'Esprit de Corps', '["Esprit de Corps","esprit de corps","esprit"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'ethics', 'Business Ethics', '["Business Ethics","business ethics","ethics"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'events', 'Events', '["Events","events","events"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'exclusive_inclusive', 'Exclusive Inclusive', '["Exclusive Inclusive","exclusive inclusive","exclusive inclusive"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'expansion', 'Expansion', '["Expansion","expansion","expansion"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'export', 'Export', '["Export","export","export"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'factorial', 'Factorial', '["Factorial","factorial","factorial"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'fayol', 'Fayol''s Principles', '["Fayol''s Principles","fayol''s principles","fayol"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'feasible', 'Feasible', '["Feasible","feasible","feasible"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'feasible_region', 'Feasible Region', '["Feasible Region","feasible region","feasible region"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'features', 'Features', '["Features","features","features"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'financing', 'Financing Activities', '["Financing Activities","financing activities","financing"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'focus', 'Focus', '["Focus","focus","focus"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'focus_directrix', 'Focus Directrix', '["Focus Directrix","focus directrix","focus directrix"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'formal', 'Formal Writing', '["Formal Writing","formal writing","formal"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'formal_email', 'Formal Email', '["Formal Email","formal email","formal email"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'forms_of_line', 'Forms of Line', '["Forms of Line","forms of line","forms of line"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'frequency', 'Frequency Distribution', '["Frequency Distribution","frequency distribution","frequency"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'function_def', 'Function Def', '["Function Def","function def","function def"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'function_definition', 'Function Definition', '["Function Definition","function definition","function definition"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'functions', 'Functions of Management', '["Functions of Management","functions of management","functions"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'general_particular', 'General Particular', '["General Particular","general particular","general particular"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'general_solutions', 'General Solutions', '["General Solutions","general solutions","general solutions"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'general_term', 'General Term', '["General Term","general term","general term"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'global_warming', 'Global Warming', '["Global Warming","global warming","global warming"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'globalisation', 'Globalisation', '["Globalisation","globalisation","globalisation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'goodwill', 'Goodwill', '["Goodwill","goodwill","goodwill"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'gp_basics', 'Geometric Progression Basics', '["Geometric Progression Basics","geometric progression basics","gp basics"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'gp_sum', 'Sum of a GP', '["Sum of a GP","sum of a gp","gp sum"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'graphical_solution', 'Graphical Solution', '["Graphical Solution","graphical solution","graphical solution"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'graphs', 'Graphs', '["Graphs","graphs","graphs"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'growth', 'Economic Growth', '["Economic Growth","economic growth","growth"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'health', 'Health', '["Health","health","health"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'histogram', 'Histogram', '["Histogram","histogram","histogram"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'homogeneous', 'Homogeneous', '["Homogeneous","homogeneous","homogeneous"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'horizontal', 'Horizontal Analysis', '["Horizontal Analysis","horizontal analysis","horizontal"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('concept'::text, 'huf', 'Hindu Undivided Family', '["Hindu Undivided Family","hindu undivided family","huf"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'hyperbola', 'Hyperbola', '["Hyperbola","hyperbola","hyperbola"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'i_squared', 'i Squared', '["i Squared","i squared","i squared"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'idea', 'Central Idea', '["Central Idea","central idea","idea"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'identities', 'Identities', '["Identities","identities","identities"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'identities_inv', 'Identities Inv', '["Identities Inv","identities inv","identities inv"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'identity', 'Identity', '["Identity","identity","identity"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'imaginary_unit', 'Imaginary Unit', '["Imaginary Unit","imaginary unit","imaginary unit"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'implicit_log', 'Implicit Log', '["Implicit Log","implicit log","implicit log"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'importance', 'Importance', '["Importance","importance","importance"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'incorporation', 'Incorporation', '["Incorporation","incorporation","incorporation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'increasing', 'Increasing', '["Increasing","increasing","increasing"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'increasing_decreasing', 'Increasing Decreasing', '["Increasing Decreasing","increasing decreasing","increasing decreasing"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'independent', 'Independent', '["Independent","independent","independent"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'industrial', 'Industrial Sector', '["Industrial Sector","industrial sector","industrial"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'industry', 'Industry', '["Industry","industry","industry"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'inference', 'Inference', '["Inference","inference","inference"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'infrastructure', 'Infrastructure', '["Infrastructure","infrastructure","infrastructure"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'insolvency', 'Insolvency', '["Insolvency","insolvency","insolvency"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'insurance', 'Insurance', '["Insurance","insurance","insurance"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'interest', 'Interest', '["Interest","interest","interest"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'intermediate', 'Intermediate Goods', '["Intermediate Goods","intermediate goods","intermediate"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'interpretation', 'Interpretation', '["Interpretation","interpretation","interpretation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'interval_notation', 'Interval Notation', '["Interval Notation","interval notation","interval notation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'inverse', 'Inverse', '["Inverse","inverse","inverse"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'investing', 'Investing Activities', '["Investing Activities","investing activities","investing"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'irony', 'Irony', '["Irony","irony","irony"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'issues', 'Issues', '["Issues","issues","issues"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'itinerant', 'Itinerant Retailers', '["Itinerant Retailers","itinerant retailers","itinerant"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'leadership', 'Leadership', '["Leadership","leadership","leadership"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'levels', 'Levels of Management', '["Levels of Management","levels of management","levels"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'liberalisation', 'Liberalisation', '["Liberalisation","liberalisation","liberalisation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'limit', 'Limit', '["Limit","limit","limit"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'limit_basics', 'Limit Basics', '["Limit Basics","limit basics","limit basics"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'limitations', 'Limitations', '["Limitations","limitations","limitations"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'line_3d', 'Line 3D', '["Line 3D","line 3d","line 3d"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'linear_first_order', 'Linear First Order', '["Linear First Order","linear first order","linear first order"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'linear_ineq_one_var', 'Linear Ineq One Var', '["Linear Ineq One Var","linear ineq one var","linear ineq one var"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'literary_device', 'Literary Device', '["Literary Device","literary device","literary device"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'long_term', 'Long-term Sources', '["Long-term Sources","long-term sources","long term"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('concept'::text, 'lpp_basics', 'LPP Basics', '["LPP Basics","lpp basics","lpp basics"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'magnitude', 'Magnitude', '["Magnitude","magnitude","magnitude"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'marketing', 'Marketing', '["Marketing","marketing","marketing"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'marshalling', 'Marshalling of Assets', '["Marshalling of Assets","marshalling of assets","marshalling"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'matching', 'Matching Concept', '["Matching Concept","matching concept","matching"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'matrix_types', 'Matrix Types', '["Matrix Types","matrix types","matrix types"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'max_min', 'Max Min', '["Max Min","max min","max min"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'maxima', 'Maxima', '["Maxima","maxima","maxima"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'mc', 'Marginal Cost', '["Marginal Cost","marginal cost","mc"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'mean', 'Mean', '["Mean","mean","mean"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'meaning', 'Meaning', '["Meaning","meaning","meaning"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'measures_central', 'Measures Central', '["Measures Central","measures central","measures central"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'median', 'Median', '["Median","median","median"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'memo', 'Memo', '["Memo","memo","memo"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'methods', 'Methods', '["Methods","methods","methods"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'middle_term', 'Middle Term', '["Middle Term","middle term","middle term"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'minors_cofactors', 'Minors Cofactors', '["Minors Cofactors","minors cofactors","minors cofactors"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'minutes', 'Minutes of Meeting', '["Minutes of Meeting","minutes of meeting","minutes"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'mnc', 'Multinational Corporation', '["Multinational Corporation","multinational corporation","mnc"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'moa', 'Memorandum of Association', '["Memorandum of Association","memorandum of association","moa"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'modals', 'Modals', '["Modals","modals","modals"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'mode', 'Mode', '["Mode","mode","mode"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'modes', 'Modes', '["Modes","modes","modes"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'modulus', 'Modulus', '["Modulus","modulus","modulus"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'modulus_argument', 'Modulus Argument', '["Modulus Argument","modulus argument","modulus argument"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'monopolistic', 'Monopolistic Competition', '["Monopolistic Competition","monopolistic competition","monopolistic"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'monopoly', 'Monopoly', '["Monopoly","monopoly","monopoly"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'motivation', 'Motivation', '["Motivation","motivation","motivation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'multiplication', 'Multiplication', '["Multiplication","multiplication","multiplication"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'multiplier', 'Multiplier', '["Multiplier","multiplier","multiplier"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'nCr', 'Combinations (nCr)', '["Combinations (nCr)","combinations (ncr)","nCr"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'nPr', 'Permutations (nPr)', '["Permutations (nPr)","permutations (npr)","nPr"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'nature', 'Nature', '["Nature","nature","nature"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'notes', 'Notes to Accounts', '["Notes to Accounts","notes to accounts","notes"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'objective', 'Objective', '["Objective","objective","objective"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'objective_function', 'Objective Function', '["Objective Function","objective function","objective function"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'objectives', 'Objectives', '["Objectives","objectives","objectives"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'ogive', 'Ogive', '["Ogive","ogive","ogive"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'oligopoly', 'Oligopoly', '["Oligopoly","oligopoly","oligopoly"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'one_one', 'One One', '["One One","one one","one one"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('concept'::text, 'onto', 'Onto', '["Onto","onto","onto"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'operating', 'Operating Activities', '["Operating Activities","operating activities","operating"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'operations', 'Operations', '["Operations","operations","operations"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'order', 'Order', '["Order","order","order"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'order_degree', 'Order Degree', '["Order Degree","order degree","order degree"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'outsourcing', 'Outsourcing', '["Outsourcing","outsourcing","outsourcing"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'outstanding', 'Outstanding Expenses', '["Outstanding Expenses","outstanding expenses","outstanding"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'overdraft', 'Bank Overdraft', '["Bank Overdraft","bank overdraft","overdraft"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'pakistan', 'Pakistan Comparison', '["Pakistan Comparison","pakistan comparison","pakistan"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'parabola', 'Parabola', '["Parabola","parabola","parabola"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'paradox', 'Paradox of Thrift', '["Paradox of Thrift","paradox of thrift","paradox"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'partial_fractions', 'Partial Fractions', '["Partial Fractions","partial fractions","partial fractions"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'participation', 'Labour Force Participation', '["Labour Force Participation","labour force participation","participation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'partnership', 'Partnership', '["Partnership","partnership","partnership"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'permutations', 'Permutations', '["Permutations","permutations","permutations"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'plane_3d', 'Plane 3D', '["Plane 3D","plane 3d","plane 3d"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'planning', 'Economic Planning', '["Economic Planning","economic planning","planning"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'plot', 'Plot', '["Plot","plot","plot"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'policy', 'Policy', '["Policy","policy","policy"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'policy_open', 'Open Market Operations', '["Open Market Operations","open market operations","policy open"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'pollution', 'Pollution', '["Pollution","pollution","pollution"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'poverty', 'Poverty', '["Poverty","poverty","poverty"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'power_set', 'Power Set', '["Power Set","power set","power set"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'ppf', 'Production Possibility Frontier', '["Production Possibility Frontier","production possibility frontier","ppf"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'ppp', 'Public-Private Partnership', '["Public-Private Partnership","public-private partnership","ppp"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'premium', 'Share Premium', '["Share Premium","share premium","premium"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'prepositions', 'Prepositions', '["Prepositions","prepositions","prepositions"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'present_perfect', 'Present Perfect', '["Present Perfect","present perfect","present perfect"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'primary', 'Primary Data', '["Primary Data","primary data","primary"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'principal_values', 'Principal Values', '["Principal Values","principal values","principal values"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'privatisation', 'Privatisation', '["Privatisation","privatisation","privatisation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'problems', 'Problems', '["Problems","problems","problems"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'process', 'Process', '["Process","process","process"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'product', 'Product', '["Product","product","product"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'project', 'Project Work', '["Project Work","project work","project"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'projection', 'Projection', '["Projection","projection","projection"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'promotion', 'Promotion', '["Promotion","promotion","promotion"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'properties', 'Properties', '["Properties","properties","properties"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'property', 'Property', '["Property","property","property"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'provisions', 'Provisions', '["Provisions","provisions","provisions"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('concept'::text, 'purpose', 'Purpose', '["Purpose","purpose","purpose"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'quadratic_roots', 'Quadratic Roots', '["Quadratic Roots","quadratic roots","quadratic roots"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'radian_measure', 'Radian Measure', '["Radian Measure","radian measure","radian measure"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'random_variable', 'Random Variable', '["Random Variable","random variable","random variable"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'range_arcsin', 'Range Arcsin', '["Range Arcsin","range arcsin","range arcsin"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'rate_of_change', 'Rate of Change', '["Rate of Change","rate of change","rate of change"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'realisation', 'Realisation Account', '["Realisation Account","realisation account","realisation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'redemption', 'Redemption', '["Redemption","redemption","redemption"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'redressal', 'Consumer Redressal', '["Consumer Redressal","consumer redressal","redressal"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'reforms', 'Economic Reforms', '["Economic Reforms","economic reforms","reforms"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'relation_types', 'Relation Types', '["Relation Types","relation types","relation types"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'relationship', 'Relationship', '["Relationship","relationship","relationship"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'report', 'Report', '["Report","report","report"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'reporting', 'Reported Speech', '["Reported Speech","reported speech","reporting"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'reserves', 'Reserves', '["Reserves","reserves","reserves"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'reserves_dist', 'Distribution of Reserves', '["Distribution of Reserves","distribution of reserves","reserves dist"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'resources', 'Resources', '["Resources","resources","resources"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'responsibilities', 'Social Responsibilities', '["Social Responsibilities","social responsibilities","responsibilities"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'retail', 'Retail Trade', '["Retail Trade","retail trade","retail"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'retained', 'Retained Earnings', '["Retained Earnings","retained earnings","retained"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'revaluation', 'Revaluation Account', '["Revaluation Account","revaluation account","revaluation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'revenue', 'Revenue', '["Revenue","revenue","revenue"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'rights', 'Rights', '["Rights","rights","rights"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'risk', 'Business Risk', '["Business Risk","business risk","risk"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'role', 'Role', '["Role","role","role"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'sample_space', 'Sample Space', '["Sample Space","sample space","sample space"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'scatter', 'Scatter Diagram', '["Scatter Diagram","scatter diagram","scatter"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'scope', 'Scope', '["Scope","scope","scope"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'secondary', 'Secondary Data', '["Secondary Data","secondary data","secondary"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'section_formula', 'Section Formula', '["Section Formula","section formula","section formula"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'sectors', 'Sectors of Economy', '["Sectors of Economy","sectors of economy","sectors"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'set_representation', 'Set Representation', '["Set Representation","set representation","set representation"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'setting', 'Setting', '["Setting","setting","setting"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'settlement', 'Settlement of Accounts', '["Settlement of Accounts","settlement of accounts","settlement"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'shapes', 'Shapes of Curves', '["Shapes of Curves","shapes of curves","shapes"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'shifts', 'Shifts in Demand and Supply', '["Shifts in Demand and Supply","shifts in demand and supply","shifts"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'short_term', 'Short-term Sources', '["Short-term Sources","short-term sources","short term"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'sin_values', 'Sin Values', '["Sin Values","sin values","sin values"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'slope', 'Slope', '["Slope","slope","slope"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'solution', 'Solution', '["Solution","solution","solution"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('concept'::text, 'sources', 'Sources', '["Sources","sources","sources"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'span', 'Span of Management', '["Span of Management","span of management","span"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'special_series', 'Special Series', '["Special Series","special series","special series"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'stakeholders', 'Stakeholders', '["Stakeholders","stakeholders","stakeholders"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'standard_integrals', 'Standard Integrals', '["Standard Integrals","standard integrals","standard integrals"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'standard_limits', 'Standard Limits', '["Standard Limits","standard limits","standard limits"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'startup', 'Startup', '["Startup","startup","startup"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'structure', 'Organisational Structure', '["Organisational Structure","organisational structure","structure"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'subset', 'Subset', '["Subset","subset","subset"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'substitution', 'Substitution', '["Substitution","substitution","substitution"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'supervision', 'Supervision', '["Supervision","supervision","supervision"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'supply', 'Supply', '["Supply","supply","supply"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'suspense', 'Suspense Account', '["Suspense Account","suspense account","suspense"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'sustainable', 'Sustainable Development', '["Sustainable Development","sustainable development","sustainable"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'symbol', 'Symbolism', '["Symbolism","symbolism","symbol"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'symmetric_skew', 'Symmetric Skew', '["Symmetric Skew","symmetric skew","symmetric skew"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'synonym', 'Synonyms', '["Synonyms","synonyms","synonym"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'system_inequalities', 'System Inequalities', '["System Inequalities","system inequalities","system inequalities"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'tangents_normals', 'Tangents Normals', '["Tangents Normals","tangents normals","tangents normals"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'taylor', 'Taylor''s Scientific Management', '["Taylor''s Scientific Management","taylor''s scientific management","taylor"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'techniques', 'Techniques', '["Techniques","techniques","techniques"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'theme', 'Theme', '["Theme","theme","theme"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'timing', 'Timing Differences', '["Timing Differences","timing differences","timing"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'tone', 'Tone', '["Tone","tone","tone"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'tools', 'Tools of Analysis', '["Tools of Analysis","tools of analysis","tools"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'trade', 'Foreign Trade', '["Foreign Trade","foreign trade","trade"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'training', 'Training', '["Training","training","training"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'transport', 'Transport', '["Transport","transport","transport"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'transpose', 'Transpose', '["Transpose","transpose","transpose"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'turnover', 'Turnover Ratios', '["Turnover Ratios","turnover ratios","turnover"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'types', 'Types', '["Types","types","types"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'types_discontinuity', 'Types Discontinuity', '["Types Discontinuity","types discontinuity","types discontinuity"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'types_of_functions', 'Types of Functions', '["Types of Functions","types of functions","types of functions"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'types_of_relations', 'Types of Relations', '["Types of Relations","types of relations","types of relations"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'types_of_sets', 'Types of Sets', '["Types of Sets","types of sets","types of sets"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'union', 'Union', '["Union","union","union"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'utility', 'Utility', '["Utility","utility","utility"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'variable_separable', 'Variable Separable', '["Variable Separable","variable separable","variable separable"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'variables', 'Variables', '["Variables","variables","variables"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'variables_types', 'Types of Variables', '["Types of Variables","types of variables","variables types"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('concept'::text, 'vectors_basics', 'Vectors Basics', '["Vectors Basics","vectors basics","vectors basics"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'venn_principle', 'Venn Principle', '["Venn Principle","venn principle","venn principle"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'vertical', 'Vertical Analysis', '["Vertical Analysis","vertical analysis","vertical"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'vocabulary_in_context', 'Vocabulary in Context', '["Vocabulary in Context","vocabulary in context","vocabulary in context"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'wdv', 'Written Down Value Method', '["Written Down Value Method","written down value method","wdv"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'welfare', 'Welfare', '["Welfare","welfare","welfare"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'wholesale', 'Wholesale Trade', '["Wholesale Trade","wholesale trade","wholesale"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'word_problems', 'Word Problems', '["Word Problems","word problems","word problems"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'wto_etc', 'WTO and International Organisations', '["WTO and International Organisations","wto and international organisations","wto etc"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'x_axis', 'X Axis', '["X Axis","x axis","x axis"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'y_axis', 'Y Axis', '["Y Axis","y axis","y axis"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'अव्यय', 'अव्यय', '["अव्यय","अव्यय","अव्यय"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'उपमा', 'उपमा', '["उपमा","उपमा","उपमा"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'उपसर्ग', 'उपसर्ग', '["उपसर्ग","उपसर्ग","उपसर्ग"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'औपचारिक', 'औपचारिक', '["औपचारिक","औपचारिक","औपचारिक"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'काल', 'काल', '["काल","काल","काल"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'काव्य', 'काव्य', '["काव्य","काव्य","काव्य"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'काव्य_सौंदर्य', 'काव्य_सौंदर्य', '["काव्य_सौंदर्य","काव्य_सौंदर्य","काव्य सौंदर्य"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'चरित्र', 'चरित्र', '["चरित्र","चरित्र","चरित्र"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'छंद_भाव', 'छंद_भाव', '["छंद_भाव","छंद_भाव","छंद भाव"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'तत्पुरुष', 'तत्पुरुष', '["तत्पुरुष","तत्पुरुष","तत्पुरुष"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'पर्याय', 'पर्याय', '["पर्याय","पर्याय","पर्याय"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'पाठ_बोध', 'पाठ_बोध', '["पाठ_बोध","पाठ_बोध","पाठ बोध"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'प्रत्यय', 'प्रत्यय', '["प्रत्यय","प्रत्यय","प्रत्यय"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'बिम्ब', 'बिम्ब', '["बिम्ब","बिम्ब","बिम्ब"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'भक्ति', 'भक्ति', '["भक्ति","भक्ति","भक्ति"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'भविष्य', 'भविष्य', '["भविष्य","भविष्य","भविष्य"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'भाव', 'भाव', '["भाव","भाव","भाव"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'मुहावरा', 'मुहावरा', '["मुहावरा","मुहावरा","मुहावरा"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'रस', 'रस', '["रस","रस","रस"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'लेखक_कवि', 'लेखक_कवि', '["लेखक_कवि","लेखक_कवि","लेखक कवि"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'लेखिका', 'लेखिका', '["लेखिका","लेखिका","लेखिका"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'वर्तनी', 'वर्तनी', '["वर्तनी","वर्तनी","वर्तनी"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'वाच्य', 'वाच्य', '["वाच्य","वाच्य","वाच्य"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'विधा', 'विधा', '["विधा","विधा","विधा"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'विलोम', 'विलोम', '["विलोम","विलोम","विलोम"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'विषय', 'विषय', '["विषय","विषय","विषय"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'व्यंग्य', 'व्यंग्य', '["व्यंग्य","व्यंग्य","व्यंग्य"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'व्यंजन', 'व्यंजन', '["व्यंजन","व्यंजन","व्यंजन"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'शीर्षक', 'शीर्षक', '["शीर्षक","शीर्षक","शीर्षक"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
ON CONFLICT (kind, term_id) DO UPDATE SET display_name = EXCLUDED.display_name, aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.academic_taxonomy_terms (kind, term_id, display_name, aliases, board)
SELECT kind, term_id, display_name, aliases, board
FROM (
  SELECT DISTINCT ON (kind, term_id) * FROM (VALUES
    ('concept'::text, 'शुद्ध_वाक्य', 'शुद्ध_वाक्य', '["शुद्ध_वाक्य","शुद्ध_वाक्य","शुद्ध वाक्य"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'शुद्धि', 'शुद्धि', '["शुद्धि","शुद्धि","शुद्धि"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'समास', 'समास', '["समास","समास","समास"]'::jsonb, 'rbse'::text),
    ('concept'::text, 'स्वर_संधि', 'स्वर_संधि', '["स्वर_संधि","स्वर_संधि","स्वर संधि"]'::jsonb, 'rbse'::text)
  ) AS v(kind, term_id, display_name, aliases, board)
  ORDER BY kind, term_id, length(display_name) DESC
) AS d
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
