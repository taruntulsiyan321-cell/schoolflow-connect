-- ═══════════════════════════════════════════════════════════════════════════
-- EVERY CUET CHAPTER CARRIES ITS OFFICIAL SYLLABUS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- docs/TODO.md A2. The quality gate's reviewer judged "inside the syllabus"
-- from memory, and measured on 2026-10-09 its memory was wrong both ways: it
-- refused a sound question because it believed Computerised Accounting is
-- outside CUET (it is Unit V's option), and it passed a Mathematics question on
-- binary operations, which the syllabus does not list. So each chapter now
-- carries what the syllabus actually says, and the writer and the reviewer are
-- both given it (_shared/questionWriter.ts, _shared/questionRubric.ts).
--
-- 1. exam_syllabus_chapters.syllabus_text — the chapter's text in NTA's CUET
--    (UG) 2026 syllabus (101 English, 301 Accountancy, 305 Business Studies,
--    309 Economics, 319 Mathematics/Applied Mathematics, 501 General Test),
--    lightly cleaned of PDF breaks. A Mathematics chapter shared by Section B1
--    and B2 carries both: B1's text, then "Applied Mathematics adds: …".
-- 2. exam_syllabus_chapters.paper_asks — what the real paper asks in a chapter
--    whose official text is one line (English, the General Test): read from
--    the eleven papers classified for the blueprint (docs/cuet-blueprint.md,
--    docs/cuet-blueprint-evidence.tsv). NULL where the syllabus text suffices.
--
-- Matched by subject and chapter name to the CUET rows; every entry must match
-- exactly one, and every CUET chapter must end with its text.
--
-- ROLLBACK: rollback/20261149000000_every_cuet_chapter_carries_its_official_syllabus.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.exam_syllabus_chapters ADD COLUMN syllabus_text text;
ALTER TABLE public.exam_syllabus_chapters ADD COLUMN paper_asks text;

COMMENT ON COLUMN public.exam_syllabus_chapters.syllabus_text IS
  'The chapter''s text in the exam''s official syllabus (20261149000000; CUET: NTA 2026). Given to the question writer and the quality gate''s reviewer.';
COMMENT ON COLUMN public.exam_syllabus_chapters.paper_asks IS
  'What the real paper asks in this chapter, where the official text is one line (20261149000000; from the CUET blueprint''s evidence). NULL where the syllabus text suffices.';

CREATE TEMP TABLE _scope (subject text, chapter text, syllabus_text text, paper_asks text) ON COMMIT DROP;
INSERT INTO _scope (subject, chapter, syllabus_text, paper_asks) VALUES
    ('Accountancy', 'Accounting for Partnership',
     'Nature of Partnership Firm: Partnership deed (meaning, importance). Accounts of Partnership: Fixed v/s Fluctuating capital, Division of profit among partners, Profit and Loss Appropriation account, guarantee of profit to a partner, past adjustments.',
     NULL),
    ('Accountancy', 'Reconstitution of Partnership',
     'Changes in profit sharing ratio among the existing partners – Sacrificing ratio and Gaining ratio. Accounting for Revaluation of Assets and reassessment of Liabilities and Distribution of reserves and accumulated profits. Goodwill: Nature, Factors affecting and Methods of valuation: Average profit, Super profit and Capitalisation methods.',
     NULL),
    ('Accountancy', 'Admission of a New Partner',
     'Admission of a Partner: Effect of admission of partner, Change in profit sharing ratio, Accounting treatment for goodwill, Revaluation of assets and reassessment of liabilities, Reserves adjustment/distribution of (accumulated profits) and adjustment of capitals.',
     NULL),
    ('Accountancy', 'Retirement and Death of a Partner',
     'Retirement/Death of a Partner: Change in profit sharing ratio, Accounting treatment of goodwill, Revaluation of assets and reassessment of liabilities, Adjustment of Accumulated profits (Reserves), Preparation of deceased partner''s capital account and his executor''s account, Preparation of Loan Account.',
     NULL),
    ('Accountancy', 'Dissolution of a Partnership Firm',
     'Meaning, Settlement of accounts: Preparation of Realisation Account and related Accounts (excluding piecemeal distribution, sale to a company and insolvency of a Partner).',
     NULL),
    ('Accountancy', 'Accounting for Share Capital',
     'Features and type of companies. Share Capital: Meaning, Nature and Types. Accounting for Share Capital: Issue and Allotment of Equity and Preference Shares; Over subscription and Under subscription; Issue at par and premium; Calls in advance, Calls in arrears, Issue of shares for consideration other than cash. Accounting treatment of Forfeiture of Shares and Re-issue of forfeited shares. Presentation of share capital in company''s balance sheet.',
     NULL),
    ('Accountancy', 'Issue of Debentures',
     'Issue of Debenture – At par, premium and discount; Issue of debentures for consideration other than cash. Issue of debentures with terms of redemption, Debenture as collateral security – concept, Interest on debentures, writing off discount/Loss on issue of debenture. Presentation of Debentures in company''s balance sheet.',
     NULL),
    ('Accountancy', 'Financial Statements and Tools for Financial Analysis',
     'Financial Statements of a Company: Preparation of simple financial statements of a company in the prescribed form with major headings and sub headings. Financial Analysis: Meaning, Significance, Purpose and Limitations. Tools for Financial Analysis: Comparative statements, Common size statements.',
     NULL),
    ('Accountancy', 'Ratio Analysis',
     'Accounting Ratios: Meaning and Objectives and types: Liquidity Ratio, Solvency Ratio, Activity Ratio, Profitability Ratio.',
     NULL),
    ('Accountancy', 'Cash Flow Statement',
     'Cash Flow Statement: Meaning and Objectives, Preparation, Adjustments related to depreciation, amortization, dividend and tax, purchase and profit or loss on sale of non-current assets (as per revised standard issued by ICAI).',
     NULL),
    ('Accountancy', 'Computerised Accounting System',
     'Optional to Unit V (Analysis of Financial Statements): Overview of Concept and Types of Computerised Accounting System (CAS). Features of a Computerised Accounting System, Advantages, limitations. Structure of a Computerised Accounting System: chart of accounts, Codification and Hierarchy of account heads. Accounting information system (AIS). Accounting Applications of Electronic Spreadsheet. Features offered by Electronic Spreadsheet. Applications of Electronic Spreadsheet in generating accounting information, preparing reports using pivot Table, common errors in spreadsheet, depreciation schedule, loan repayment schedule, payroll accounting. Graphs and Charts in electronic spreadsheet for Business Data.',
     NULL),
    ('Business Studies', 'Nature and Significance of Management',
     'Management – concept, objectives, importance. Nature of management; Management as Science, Art, Profession. Levels of management – top, middle supervisory (First level). Management functions – planning, organising, staffing, directing and controlling. Coordination – nature and importance.',
     NULL),
    ('Business Studies', 'Principles of Management',
     'Principles of Management – meaning, nature and significance. Fayol''s principles of management. Taylor''s Scientific Management – Principles and Techniques.',
     NULL),
    ('Business Studies', 'Business Environment',
     'Business Environment – meaning and importance. Dimensions of Business Environment – Economic, Social, Technological, Political and Legal.',
     NULL),
    ('Business Studies', 'Planning',
     'Meaning, features, importance, limitations. Planning process. Types of Plans – Objectives, Strategy, Policy, Procedure, Method, Rule, Budget, Programme.',
     NULL),
    ('Business Studies', 'Organising',
     'Meaning and importance. Steps in the process of organising. Structure of organization – functional and divisional. Formal and informal organisation. Delegation: meaning, elements and importance. Decentralization: meaning and importance. Difference between delegation and decentralisation.',
     NULL),
    ('Business Studies', 'Staffing',
     'Meaning, need and importance of staffing. Staffing as a part of Human Resources Management. Steps in staffing process. Recruitment – meaning, process and sources, Merits and demerits of internal and external sources of recruitment. Selection – meaning and process. Training and Development – meaning, need, methods – on the job and off the job methods of training.',
     NULL),
    ('Business Studies', 'Directing',
     'Meaning, importance and principles. Elements of Direction: Supervision – meaning and importance; Motivation – meaning and importance, Maslow''s hierarchy of needs, Financial and non-financial incentives; Leadership – meaning, importance, style – authoritative, democratic and laissez-faire; Communication – meaning and importance, formal and informal communication, barriers to effective communication, how to overcome the barriers.',
     NULL),
    ('Business Studies', 'Controlling',
     'Meaning and importance. Relationship between planning and controlling. Steps in the process of control.',
     NULL),
    ('Business Studies', 'Financial Management',
     'Business finance – meaning, role, objectives of financial management. Financial decisions: investing, financing and dividend – Meaning and factors affecting. Financial planning – meaning and importance. Capital Structure – meaning and factors. Fixed and Working Capital – meaning and factors affecting their requirements.',
     NULL),
    ('Business Studies', 'Financial Markets',
     'Concept of Financial Market. Money Market: Concept, instruments. Capital market and its types (primary and secondary market). Stock Exchange – Functions, trading procedure. Depository services and demat account. Securities and Exchange Board of India (SEBI) – Objectives, Functions.',
     NULL),
    ('Business Studies', 'Marketing Management',
     'Marketing – meaning, functions, role and philosophies. Distinction between marketing and selling. Marketing mix – concept and elements: Product – nature, classification, branding, labeling and packaging; Physical distribution: meaning, role, Components, Channels of distribution – meaning, types, factors determining choice of channels; Promotion – meaning and role, promotion mix, Advertising, Personal selling, sales promotion and public relation, Role of Advertising, objections to Advertising; Price: factors influencing pricing.',
     NULL),
    ('Business Studies', 'Consumer Protection',
     'Meaning and concept. Meaning, Importance of consumer protection. The Consumer Protection Act, 2019. Consumer rights. Consumer responsibilities. Who can file a complaint? Ways and means of consumer protection – Consumer awareness and legal redressal with special reference to Consumer Protection Act 2019, Remedies available. Role of consumer organizations and NGOs.',
     NULL),
    ('Economics', 'Introduction and Theory of Consumer Behaviour',
     'What is microeconomics? Central problems of an economy. Consumer''s Equilibrium: meaning and attainment of equilibrium through Utility Approach: One and two commodity cases, Consumer''s Budget and Optimal choice of the consumer. Demand: market demand, determinants of demand, demand schedule, demand curve, movement along and shifts in the demand curve, price elasticity of demand, measurement of price elasticity of demand – percentage, total expenditure, factors determining price elasticity of demand for a good.',
     NULL),
    ('Economics', 'Production and Costs',
     'Production function: Short run and Long run production function. Shapes of TP, MP and AP curves. Cost and Revenue: Concepts of costs; short-run cost curves (fixed and variable costs; total, average and marginal costs); concepts of revenue – total, average and marginal revenue and their relationship. Producer''s equilibrium – with the help of MC and MR.',
     NULL),
    ('Economics', 'Theory of the Firm under Perfect Competition',
     'Features of perfect competition. Profit maximization. Price determination under perfect competition – equilibrium price, effects of shifts in demand and supply. Supply: market supply, determinants of supply, supply schedule, supply curve, movement along and shifts in supply curve, price elasticity of supply, measurement of price elasticity of supply.',
     NULL),
    ('Economics', 'Market Equilibrium and Simple Applications',
     'Market equilibrium, excess demand, excess supply. Applications: Price ceiling and Price flooring.',
     NULL),
    ('Economics', 'Introduction and National Income Accounting',
     'What is macroeconomics? Basic concepts in macroeconomics. Circular flow of income; Methods of calculating National Income – Value Added or Product method, Expenditure method, Income method. Aggregates related to National Income: Factor Cost, Basic Prices and Market Price. GDP and Welfare.',
     NULL),
    ('Economics', 'Money and Banking',
     'Money: meaning and functions, supply of money – Money Creation and Money Multiplier. Central bank and its functions (example of the Reserve Bank of India). Policy tools to control money supply.',
     NULL),
    ('Economics', 'Determination of Income and Employment',
     'Aggregate demand and its components. Determination of Income in two sector model. Problems of excess demand and deficient demand; measures to correct them – changes in government spending, taxes and money supply. Multiplier mechanism.',
     NULL),
    ('Economics', 'Government Budget and the Economy',
     'Government budget – meaning, objectives and components. Classification of receipts – revenue receipts and capital receipts. Classification of expenditure – revenue expenditure and capital expenditure. Balanced, Surplus and Deficit Budget – measures of government deficit.',
     NULL),
    ('Economics', 'Open Economy Macroeconomics',
     'Balance of payments account – meaning and components; Balance of payments – Surplus and Deficit. Foreign exchange rate – meaning of fixed and flexible rates and managed floating. Merits and demerits of exchange rate regimes. Determination of exchange rate. Managed Floating.',
     NULL),
    ('Economics', 'Development Policies and Experience (1947-90)',
     'A brief introduction of the state of Indian economy on the eve of independence. Indian economic system and common goals of Five Year Plans. Main features, problems and policies of agriculture (institutional aspects and new agricultural strategy), industry (IPR 1956; SSI – role and importance) and foreign trade.',
     NULL),
    ('Economics', 'Economic Reforms since 1991',
     'Economic Reforms since 1991: Features and appraisals of liberalisation, globalisation and privatisation (LPG policy).',
     NULL),
    ('Economics', 'Current Challenges facing the Indian Economy',
     'Human Capital Formation: How people become resource; Role of human capital in economic development; Growth of Education Sector in India. Rural development: Key issues – credit and marketing – role of cooperatives; agricultural market system, Agriculture diversification; alternative farming – organic farming. Employment: Growth and changes in work force participation rate in formal and informal sectors; problems and policies. Environment and Sustainable Development: Definition and Functions, State of India''s environment, Strategies for sustainable development.',
     NULL),
    ('Economics', 'Development Experience of India: A Comparison with Neighbours',
     'A comparison with neighbours. Issues: economic growth, population, sectoral development and other Human Development Indicators. Development Strategies.',
     NULL),
    ('Mathematics', 'Relations and Functions',
     'Types of relations: Reflexive, symmetric, transitive and equivalence relations. One to one and onto functions.',
     NULL),
    ('Mathematics', 'Inverse Trigonometric Functions',
     'Definition, range, domain, principal value branches. Graphs of inverse trigonometric functions.',
     NULL),
    ('Mathematics', 'Matrices',
     'Concept, notation, order, equality, types of matrices, zero matrix, transpose of a matrix, symmetric and skew symmetric matrices. Operations on matrices: Addition, multiplication and multiplication with a scalar. Simple properties of addition, multiplication and scalar multiplication. Non-commutativity of multiplication of matrices and existence of non-zero matrices whose product is the zero matrix (restrict to square matrices of order 2). Invertible matrices and proof of the uniqueness of inverse, if it exists (all matrices with real entries). Applied Mathematics adds: inverse of a matrix using cofactors and its properties ((AB)^-1 = B^-1 A^-1, (A^-1)^-1 = A, (A^T)^-1 = (A^-1)^T); solving a system of simultaneous equations (up to three variables, non-homogeneous).',
     NULL),
    ('Mathematics', 'Determinants',
     'Determinant of a square matrix (up to 3 × 3 matrices), minors, cofactors and applications of determinants in finding the area of a triangle. Adjoint and inverse of a square matrix. Consistency, inconsistency and number of solutions of system of linear equations by examples, solving system of linear equations in two or three variables (having unique solution) using inverse of a matrix. Applied Mathematics adds: elementary properties of determinants, singular and non-singular matrices, |AB| = |A||B|.',
     NULL),
    ('Mathematics', 'Continuity and Differentiability',
     'Continuity and differentiability, chain rule, derivatives of inverse trigonometric functions like sin^-1 x, cos^-1 x and tan^-1 x, derivative of implicit functions. Concepts of exponential, logarithmic functions. Derivatives of logarithmic and exponential functions. Logarithmic differentiation, derivative of functions expressed in parametric forms. Second-order derivatives.',
     NULL),
    ('Mathematics', 'Applications of Derivatives',
     'Rate of change of quantities, increasing/decreasing functions, maxima and minima (first derivative test motivated geometrically and second derivative test given as provable tool). Simple problems that illustrate basic principles and real-life situations. Applied Mathematics adds: marginal cost and marginal revenue using derivatives; absolute maximum and minimum values and applied problems.',
     NULL),
    ('Mathematics', 'Integrals',
     'Integration as inverse process of differentiation. Integration of a variety of functions by substitution, by partial fractions and by parts. Evaluation of simple integrals of the standard types: dx/(x^2 ± a^2), dx/sqrt(x^2 ± a^2), dx/(a^2 − x^2), dx/sqrt(a^2 − x^2), dx/(ax^2 + bx + c), dx/sqrt(ax^2 + bx + c), (px + q)dx/(ax^2 + bx + c), (px + q)dx/sqrt(ax^2 + bx + c), sqrt(a^2 ± x^2)dx, sqrt(x^2 − a^2)dx, sqrt(ax^2 + bx + c)dx. Fundamental Theorem of Calculus (without proof). Basic properties of definite integrals and evaluation of definite integrals.',
     NULL),
    ('Mathematics', 'Applications of the Integrals',
     'Applications in finding the area under simple curves, especially lines, circles/parabolas/ellipses (in standard form only). Applied Mathematics adds: consumer surplus and producer surplus by the definite integral.',
     NULL),
    ('Mathematics', 'Differential Equations',
     'Definition, order and degree, general and particular solutions of a differential equation. Solution of differential equations by method of separation of variables, solutions of homogeneous differential equations of first order and first degree. Solutions of linear differential equations of the type dy/dx + Py = Q (P, Q functions of x or constants) and dx/dy + Px = Q (P, Q functions of y or constants). Applied Mathematics adds: formulating differential equations and verifying a solution.',
     NULL),
    ('Mathematics', 'Vectors',
     'Vectors and scalars, magnitude and direction of a vector. Direction cosines and direction ratios of a vector. Types of vectors (equal, unit, zero, parallel and collinear vectors), position vector of a point, negative of a vector, components of a vector, addition of vectors, multiplication of a vector by a scalar, position vector of a point dividing a line segment in a given ratio. Definition, geometrical interpretation, properties and application of scalar (dot) product of vectors, vector (cross) product of vectors.',
     NULL),
    ('Mathematics', 'Three-dimensional Geometry',
     'Direction cosines and direction ratios of a line joining two points. Cartesian equation and vector equation of a line, skew lines, shortest distance between two lines. Angle between two lines.',
     NULL),
    ('Mathematics', 'Linear Programming',
     'Introduction, related terminology such as constraints, objective function, optimization, mathematical formulation of a linear programming problem and its different types, graphical method of solution for problems in two variables, feasible and infeasible regions (bounded or unbounded), feasible and infeasible solutions, optimal feasible solutions (up to three non-trivial constraints).',
     NULL),
    ('Mathematics', 'Probability',
     'Conditional probability, Multiplication theorem on probability, independent events, total probability, Bayes'' theorem.',
     NULL),
    ('Mathematics', 'Numbers, Quantification and Numerical Applications',
     'Modulo arithmetic: modulus of an integer, arithmetic operations using modular arithmetic rules. Congruence modulo: definition and problems. Alligation and mixture: the rule of alligation, mean price of a mixture. Numerical problems from real life. Boats and streams: upstream and downstream. Pipes and cisterns: time taken by two or more pipes to fill or empty a tank. Races and games: comparing performance by time and distance. Numerical inequalities: basic concepts, writing numerical inequalities.',
     NULL),
    ('Mathematics', 'Probability Distributions',
     'Random variables and their probability distributions; probability distribution of a discrete random variable. Mathematical expectation. Variance and standard deviation of a random variable. Binomial distribution: Bernoulli trials, mean, variance and S.D. Poisson distribution: conditions, mean and variance. Normal distribution: a continuous distribution, standard normal variate, area relationship between mean and standard deviation.',
     NULL),
    ('Mathematics', 'Time Based Data',
     'Time series as chronological data. Components of time series. Time series analysis for univariate data: practical problems based on statistical data. Secular trend: the long-term tendency. Methods of measuring trend.',
     NULL),
    ('Mathematics', 'Inferential Statistics',
     'Population and sample; representative and non-representative samples; simple random and systematic random sampling. Parameter and statistic and their relation; limitation of a statistic in estimating for a population; statistical significance and statistical inference; Central Limit Theorem; population – sampling distribution – sample. t-test (one sample t-test for a small group): hypothesis, null and alternate hypothesis, degrees of freedom, testing a null hypothesis and making inferences with the t-test statistic for one group.',
     NULL),
    ('Mathematics', 'Financial Mathematics',
     'Perpetuity and sinking funds: concepts, calculation of perpetuity, sinking fund versus saving account. Calculation of EMI by various methods. Rate of return and nominal rate of return. Compound Annual Growth Rate, and how it differs from annual growth rate. Linear method of depreciation: cost, residual value and useful life. Valuation of bonds: bond terms, value of a bond by the present value approach.',
     NULL),
    ('English', 'Reading Comprehension',
     'Reading Comprehension: There will be three types of passages (maximum 300 words): a. Factual b. Narrative c. Literary.',
     'A passage of up to 300 words — factual, narrative or literary — followed by questions on it: the meaning of a word or phrase as used in the passage, its central idea or best title, which statements are true or not true according to it, the author''s view or tone, and what can be inferred from it. Every question is answered from the passage; none asks about reading or passages in general.'),
    ('English', 'Verbal Ability',
     'Verbal Ability: a. Rearranging the parts b. Match the following c. Choosing the correct word d. Synonyms and Antonyms.',
     'Synonyms and antonyms of a given word; rearranging the parts of a sentence into the right order; matching idioms, phrasal verbs, prepositions or words with their meanings; choosing the correct word to fill a blank in a sentence. Questions test the language itself, never knowledge about grammar terms or literary theory.'),
    ('General Aptitude Test', 'General Knowledge and Current Affairs',
     'General Knowledge, Current Affairs.',
     NULL),
    ('General Aptitude Test', 'General Mental Ability and Numerical Ability',
     'General Mental Ability, Numerical Ability.',
     'Number series and letter-number series, coding and decoding by letter order, odd one out among words or terms, and the missing number in a grid — each with exactly one answer that follows from what is given. (The paper''s figure questions — mirror images, embedded figures, figure matrices — need images and are not written.)'),
    ('General Aptitude Test', 'Quantitative Reasoning',
     'Reasoning (Simple application of basic mathematical concepts: Quantitative arithmetic / algebra / geometry / mensuration / statistics).',
     'School mathematics at about Class 10 level: ages, ratio and proportion, profit and loss, simple interest, time and work, boats and streams, unit digits, arithmetic progressions, permutations and combinations, probability (dice, coins), distance between points, heights and distances, areas and solids (circles, cylinders), and mean, median and mode from a table.'),
    ('General Aptitude Test', 'Logical and Analytical Reasoning',
     'Logical and Analytical Reasoning.',
     'Calendars (the day of a date), clocks that gain or lose time, blood relations (plain or coded), directions and distances, positions in a row or a queue, and arrangements — each decided by the information given alone, with exactly one answer.'),
    ('General Aptitude Test', 'General Science and Environment Literacy',
     'General Science and Environment Literacy.',
     'Everyday science at about Class 10 level — motion, common chemicals and their uses, nutrients and the human body, weather and clouds — and the environment: conservation, threatened species and the IUCN Red List.');

DO $verify$
DECLARE
  _unmatched text;
BEGIN
  SELECT string_agg(sc.subject || ' › ' || sc.chapter, '; ') INTO _unmatched
    FROM _scope sc
   WHERE (SELECT count(*)
            FROM public.exam_syllabus_chapters esc
            JOIN public.competitive_exams e ON e.id = esc.exam_id AND e.code = 'cuet'
            JOIN public.chapters c ON c.id = esc.chapter_id AND c.name = sc.chapter
            JOIN public.curriculum_subjects s ON s.id = c.curriculum_subject_id AND s.name = sc.subject) <> 1;
  IF _unmatched IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: these do not match exactly one CUET chapter: %', _unmatched;
  END IF;
END $verify$;

UPDATE public.exam_syllabus_chapters esc
   SET syllabus_text = sc.syllabus_text, paper_asks = sc.paper_asks
  FROM _scope sc, public.competitive_exams e, public.chapters c, public.curriculum_subjects s
 WHERE e.code = 'cuet' AND esc.exam_id = e.id
   AND c.id = esc.chapter_id AND c.name = sc.chapter
   AND s.id = c.curriculum_subject_id AND s.name = sc.subject;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  _missing text;
BEGIN
  SELECT string_agg(c.name, '; ') INTO _missing
    FROM public.exam_syllabus_chapters esc
    JOIN public.competitive_exams e ON e.id = esc.exam_id AND e.code = 'cuet'
    JOIN public.chapters c ON c.id = esc.chapter_id
   WHERE coalesce(btrim(esc.syllabus_text), '') = '';
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: CUET chapters with no syllabus text: %', _missing;
  END IF;
  -- The two mistakes that made this necessary, read back from the rows.
  IF NOT EXISTS (SELECT 1 FROM public.exam_syllabus_chapters esc JOIN public.chapters c ON c.id = esc.chapter_id
                  WHERE c.name = 'Relations and Functions' AND esc.syllabus_text LIKE 'Types of relations:%'
                    AND esc.syllabus_text NOT ILIKE '%binary%')
     OR NOT EXISTS (SELECT 1 FROM public.exam_syllabus_chapters esc JOIN public.chapters c ON c.id = esc.chapter_id
                     WHERE c.name = 'Computerised Accounting System' AND esc.syllabus_text LIKE 'Optional to Unit V%') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the syllabus text was not stored as written';
  END IF;
END $verify$;

COMMIT;
