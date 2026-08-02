# Gurukul Question Bank — RBSE Classification RESULT (v1)

**Status:** Taxonomy for user review — **no mass question insert** in this turn  
**Scope:** Class **11** and **12**, board **`rbse`**, NCERT-aligned chapter taxonomy  
**Date:** 2026-08-02  
**Companion:** `GURUKUL_MASTER_APP_DOCUMENT.md`  
**Repo path:** `docs/GURUKUL_QUESTION_BANK_RBSE_CLASSIFICATION.md`

---

## Executive summary (what you are approving)

| Metric | Count |
|--------|------:|
| Classes in v1 scope | 2 (11, 12) |
| Priority subjects (depth tables below) | **9** × 2 classes = **18** subject–class rows |
| Total chapters catalogued (NCERT post-rationalisation baseline) | **~236** |
| Deferred streams / subjects | Arts electives, Agriculture, CS/IP (listed, not chapter-deep) |
| Question types for RBSE v1 | MCQ, short, concept — **not** assertion–reason / case-based |
| Content strategy | Original NCERT-**aligned** items; do **not** scrape/redistribute NCERT full text |

**Approve this taxonomy → then seed Batch 1 (Section F).**

---

## A. School → Board model

### A.1 Field on `schools`

```text
schools.board  text  NOT NULL DEFAULT 'rbse'
  CHECK (board IN ('rbse', 'cbse', 'icse', 'other', 'both'))
```

- First tenant / Wisdom Campus: **`board = 'rbse'`**.
- Future CBSE schools: `board = 'cbse'`.
- `'both'` on a school is rare (multi-board campus); prefer one board per school.

### A.2 Fields on `question_bank` (taxonomy columns)

Existing today (abbrev.): `class_level`, `subject`, `chapter`, `topic`, `difficulty`, `question`, `options`, `correct_index`, …

**Add (schema-only, when approved):**

| Column | Type | Purpose |
|--------|------|---------|
| `board` | text NOT NULL DEFAULT `'both'` | `rbse` \| `cbse` \| `both` |
| `source_type` | text | `ncert_aligned` \| `ncert_exemplar_aligned` \| `teacher` \| `ai_generated` \| `licensed_import` \| `legacy` |
| `concept` | text nullable | Fine tag under chapter (fill as we seed) |
| `question_format` | text | `mcq` \| `short` \| `long` \| `numerical` \| `assertion_reason` \| `case_based` |

`topic` may alias `concept` initially; prefer converging on `concept` for Academic Engine mastery.

### A.3 Student filter rule (product truth)

```text
student.school.board → B

SELECT * FROM question_bank q
WHERE q.is_approved
  AND q.board IN (B, 'both')
  AND q.class_level = student.class
  AND lower(q.subject) = lower(requested_subject)
  AND (chapter filter optional)
  AND q.question_format IN allowed_formats_for(B)
```

**RBSE allowed formats (v1):** `mcq`, `short`, `numerical`, `long` (theory), `concept` (treat as short/MCQ tagging).  
**Defer to CBSE tag / Phase 5:** `assertion_reason`, `case_based`.

Rationale: RBSE senior-secondary papers emphasize NCERT-style objective/short/long; CBSE-style assertion–reasoning and long case-based packs should not pollute the RBSE bank by default.

### A.4 Question-type matrix

| Format | RBSE (`board=rbse` or `both`) | CBSE (`board=cbse` or `both`) |
|--------|-------------------------------|-------------------------------|
| MCQ (4-option) | ✅ primary | ✅ |
| Short answer / one-mark recall | ✅ | ✅ |
| Numerical / work-out | ✅ (Math, Physics, Accountancy, Chem) | ✅ |
| Long / structured theory | ✅ (optional in bank; UI later) | ✅ |
| Assertion–Reason | ❌ defer | ✅ Phase 5 |
| Case-based / passage | ❌ defer | ✅ Phase 5 |

---

## B. Research-backed Class 11 & 12 subjects (RBSE)

### B.1 Sources consulted (honesty)

| Source | What it supports | Caveat |
|--------|------------------|--------|
| [rajeduboard.rajasthan.gov.in books listing](https://rajeduboard.rajasthan.gov.in/books-2019/2024-25.htm) | RBSE distributes / lists **NCERT-titled** books for Class 11–12 (Physics, Chemistry, Biology, Maths, Accountancy, Business Studies, Economics, English Flamingo/Vistas, Hindi, etc.) | Book portal pages change by year; treat as “NCERT-based in Rajasthan practice,” not a legal license grant |
| Jagran Josh / Careers360 / Collegedunia / VSI Jaipur summaries of RBSE 11–12 syllabus | Stream subject lists (Science / Commerce / Arts); Hindi & English compulsory | Secondary aggregators sometimes disagree on “compulsory vs optional” wording |
| NCERT textbook chapter indices (via ncert.nic.in + chapter directories such as LearnCBSE) | Chapter titles for taxonomy | NCERT **rationalised** content (2023–24 onward); RBSE may lag or keep NPO Accountancy titles — see conflicts below |
| PW Live commerce syllabus pages | Commerce core: Accountancy, BST, Economics + Hindi/English; Maths optional | Aligns with user request |

**Conflict notes (do not hide):**

1. **Accountancy Class 12 — NPO chapter:** Older NCERT Part-1 included *Accounting for Not-for-Profit Organisation*; CBSE/NCERT rationalisation dropped it as a full chapter. RBSE book listings still often title the volume “Not-for-Profit Organisation and Partnership Accounts.” **v1 taxonomy:** keep Partnership + Company chapters as seed priority; mark NPO as `optional_rbse_verify` until an official RBSE PDF for the active year is checked.
2. **BST Class 12 — Financial Markets:** NCERT rationalisation dropped full *Financial Markets* chapter; Part II remains Financial Management, Marketing Management, Consumer Protection. Use **post-rationalisation** list.
3. **Biology Class 12:** Post-rationalisation = **13** chapters (not 16). Prefer 13.
4. **Hindi / English compulsory:** Aggregators agree Hindi + English are compulsory across streams; exact “Core vs Elective” book set is school-dependent. **v1:** seed **Hindi Core (Aroh + Vitan)** and **English Core (Hornbill/Snapshots → Flamingo/Vistas)**.

### B.2 Stream map (RBSE Class 11–12)

| Stream | Core / common | Typical optionals | NCERT-based in RBSE practice? |
|--------|---------------|-------------------|-------------------------------|
| **Science** | Physics, Chemistry, **Mathematics and/or Biology**, Hindi, English | Computer Science, Informatics Practices, Geology, PE | **Yes** — Physics/Chem/Bio/Maths NCERT volumes listed on RBSE book pages |
| **Commerce** | **Accountancy**, **Business Studies (BST)**, **Economics**, Hindi, English | Mathematics, IP / CS | **Yes** — Accountancy I/II, BST I/II, Economics NCERT |
| **Arts / Humanities** | Hindi, English + electives (History, Pol. Science, Geography, Sociology, Psychology, Public Admin, …) | Economics, Maths, languages | Mostly NCERT where subject exists; **out of v1 chapter depth** |
| **Agriculture** (RBSE-specific path) | Agriculture subjects + science mix | — | **Out of v1** |

### B.3 Subjects in **this** classification (v1 depth)

| Subject | Class 11 | Class 12 | Streams | Notes |
|---------|:--------:|:--------:|---------|-------|
| Accountancy | ✅ | ✅ | Commerce | Priority |
| Business Studies | ✅ | ✅ | Commerce | Priority |
| Economics | ✅ | ✅ | Commerce (+ Arts elective) | Priority |
| Mathematics | ✅ | ✅ | Science + Commerce optional | Priority |
| Physics | ✅ | ✅ | Science | Priority |
| Chemistry | ✅ | ✅ | Science | Priority |
| Biology | ✅ | ✅ | Science (PCB) | Priority |
| English (Compulsory / Core) | ✅ | ✅ | All | Priority |
| Hindi (Compulsory / Core) | ✅ | ✅ | All | Priority |

**Listed but not chapter-deep in v1:** Computer Science, Informatics Practices, Physical Education, Arts electives, Agriculture.

---

## C. Classification taxonomy RESULT

**Conventions**

- `Board` = `rbse` (items may also be tagged `both` when truly shared with CBSE NCERT).
- `source_type` proposed default = `ncert_aligned`.
- `Question types for RBSE` = MCQ + short (+ numerical where natural). No A/R or case-based.
- **Concepts:** sample 2–5 per chapter *or* “chapter-level first” — v1 RESULT is **chapter-complete**; concepts expand at seed time.
- Chapter titles follow **current rationalised NCERT** English titles unless noted.

### C.0 Roll-up counts

| Subject | Cl.11 ch | Cl.12 ch | Total ch |
|---------|---------:|---------:|---------:|
| Mathematics | 14 | 13 | 27 |
| Physics | 14 | 14 | 28 |
| Chemistry | 9 | 10 | 19 |
| Biology | 19 | 13 | 32 |
| Accountancy | 9 | 10* | 19 |
| Business Studies | 11 | 11 | 22 |
| Economics | 16 | 12 | 28 |
| English Core | 11† | 18‡ | 29 |
| Hindi Core | 16§ | 18§ | 34 |
| **TOTAL** | **119** | **119** | **~238** |

\*Accountancy 12: 4 partnership + 6 company/analysis (NPO optional — see B.1).  
†English 11: Hornbill prose (6) + Snapshots (5); poems tracked as separate items under Hornbill poetry if needed.  
‡English 12: Flamingo prose (8) + poetry (5) + Vistas (5) = 18 lesson units.  
§Hindi: Aroh + Vitan lesson counts vary by edition; numbers are approximate lesson units for bank folders.

---

### C.1 Mathematics

| Subject | Class | Board | NCERT book | Chapters (numbered) | Concepts (sample / chapter-level) | source_type | Question types (RBSE) |
|---------|------:|-------|------------|---------------------|-----------------------------------|-------------|------------------------|
| Mathematics | 11 | rbse | *Mathematics* Class XI | 1 Sets; 2 Relations and Functions; 3 Trigonometric Functions; 4 Complex Numbers and Quadratic Equations; 5 Linear Inequalities; 6 Permutations and Combinations; 7 Binomial Theorem; 8 Sequences and Series; 9 Straight Lines; 10 Conic Sections; 11 Introduction to Three Dimensional Geometry; 12 Limits and Derivatives; 13 Statistics; 14 Probability | Ch1: Venn, operations, power set; Ch3: identities, general solutions; Ch12: limit laws, derivative of polynomials — else **chapter-level** | ncert_aligned | MCQ, numerical, short |
| Mathematics | 12 | rbse | *Mathematics* Part I + II | 1 Relations and Functions; 2 Inverse Trigonometric Functions; 3 Matrices; 4 Determinants; 5 Continuity and Differentiability; 6 Application of Derivatives; 7 Integrals; 8 Application of Integrals; 9 Differential Equations; 10 Vector Algebra; 11 Three Dimensional Geometry; 12 Linear Programming; 13 Probability | Ch3: matrix ops, inverse; Ch7: indefinite/definite integrals; Ch13: Bayes, distributions — else chapter-level | ncert_aligned | MCQ, numerical, short |

---

### C.2 Physics

| Subject | Class | Board | NCERT book | Chapters | Concepts (sample) | source_type | Question types |
|---------|------:|-------|------------|----------|-------------------|-------------|----------------|
| Physics | 11 | rbse | Physics Part I + II | **I:** 1 Units and Measurement; 2 Motion in a Straight Line; 3 Motion in a Plane; 4 Laws of Motion; 5 Work, Energy and Power; 6 System of Particles and Rotational Motion; 7 Gravitation. **II:** 8 Mechanical Properties of Solids; 9 Mechanical Properties of Fluids; 10 Thermal Properties of Matter; 11 Thermodynamics; 12 Kinetic Theory; 13 Oscillations; 14 Waves | Ch4: Newton laws, friction; Ch5: work–energy theorem; Ch11: laws of thermo — else chapter-level | ncert_aligned | MCQ, numerical, short |
| Physics | 12 | rbse | Physics Part I + II | 1 Electric Charges and Fields; 2 Electrostatic Potential and Capacitance; 3 Current Electricity; 4 Moving Charges and Magnetism; 5 Magnetism and Matter; 6 Electromagnetic Induction; 7 Alternating Current; 8 Electromagnetic Waves; 9 Ray Optics and Optical Instruments; 10 Wave Optics; 11 Dual Nature of Radiation and Matter; 12 Atoms; 13 Nuclei; 14 Semiconductor Electronics | Ch3: Ohm, Kirchhoff, cells; Ch9: mirrors/lenses; Ch14: diodes, logic — else chapter-level | ncert_aligned | MCQ, numerical, short |

---

### C.3 Chemistry

| Subject | Class | Board | NCERT book | Chapters | Concepts (sample) | source_type | Question types |
|---------|------:|-------|------------|----------|-------------------|-------------|----------------|
| Chemistry | 11 | rbse | Chemistry Part I + II | 1 Some Basic Concepts of Chemistry; 2 Structure of Atom; 3 Classification of Elements and Periodicity; 4 Chemical Bonding and Molecular Structure; 5 Thermodynamics; 6 Equilibrium; 7 Redox Reactions; 8 Organic Chemistry – Some Basic Principles and Techniques; 9 Hydrocarbons | Ch1: mole, stoichiometry; Ch4: VSEPR, hybridisation; Ch9: alkanes/alkenes/alkynes — else chapter-level | ncert_aligned | MCQ, numerical, short |
| Chemistry | 12 | rbse | Chemistry Part I + II | 1 Solutions; 2 Electrochemistry; 3 Chemical Kinetics; 4 The d- and f-Block Elements; 5 Coordination Compounds; 6 Haloalkanes and Haloarenes; 7 Alcohols, Phenols and Ethers; 8 Aldehydes, Ketones and Carboxylic Acids; 9 Amines; 10 Biomolecules | Ch2: Nernst, conductance; Ch3: rate laws; Ch8: carbonyl reactions — else chapter-level | ncert_aligned | MCQ, numerical, short |

---

### C.4 Biology

| Subject | Class | Board | NCERT book | Chapters | Concepts (sample) | source_type | Question types |
|---------|------:|-------|------------|----------|-------------------|-------------|----------------|
| Biology | 11 | rbse | *Biology* Class XI | 1 The Living World; 2 Biological Classification; 3 Plant Kingdom; 4 Animal Kingdom; 5 Morphology of Flowering Plants; 6 Anatomy of Flowering Plants; 7 Structural Organisation in Animals; 8 Cell: The Unit of Life; 9 Biomolecules; 10 Cell Cycle and Cell Division; 11 Photosynthesis in Higher Plants; 12 Respiration in Plants; 13 Plant Growth and Development; 14 Breathing and Exchange of Gases; 15 Body Fluids and Circulation; 16 Excretory Products and Their Elimination; 17 Locomotion and Movement; 18 Neural Control and Coordination; 19 Chemical Coordination and Integration | Ch8: organelles; Ch10: mitosis/meiosis; Ch14: respiratory volumes — else chapter-level | ncert_aligned | MCQ, short |
| Biology | 12 | rbse | *Biology* Class XII (rationalised 13 ch) | 1 Sexual Reproduction in Flowering Plants; 2 Human Reproduction; 3 Reproductive Health; 4 Principles of Inheritance and Variation; 5 Molecular Basis of Inheritance; 6 Evolution; 7 Human Health and Disease; 8 Microbes in Human Welfare; 9 Biotechnology: Principles and Processes; 10 Biotechnology and its Applications; 11 Organisms and Populations; 12 Ecosystem; 13 Biodiversity and Conservation | Ch4: Mendel, linkage; Ch5: DNA replication; Ch9: tools of rDNA — else chapter-level | ncert_aligned | MCQ, short |

---

### C.5 Accountancy

| Subject | Class | Board | NCERT book | Chapters | Concepts (sample) | source_type | Question types |
|---------|------:|-------|------------|----------|-------------------|-------------|----------------|
| Accountancy | 11 | rbse | Financial Accounting I + Accountancy II | **FA-I:** 1 Introduction to Accounting; 2 Theory Base of Accounting; 3 Recording of Transactions-I; 4 Recording of Transactions-II; 5 Bank Reconciliation Statement; 6 Trial Balance and Rectification of Errors; 7 Depreciation, Provisions and Reserves. **II:** 8 Financial Statements – I; 9 Financial Statements – II | Ch3–4: journal, ledger, cash book; Ch5: BRS; Ch8–9: Trading/P&L/BS — else chapter-level | ncert_aligned | MCQ, numerical, short |
| Accountancy | 12 | rbse | Partnership Accounts + Company Accounts & Analysis | **Partnership:** 1 Accounting for Partnership — Basic Concepts; 2 Reconstitution — Admission; 3 Reconstitution — Retirement/Death; 4 Dissolution of Partnership Firm. **Company/Analysis:** 5 Accounting for Share Capital; 6 Issue and Redemption of Debentures; 7 Financial Statements of a Company; 8 Analysis of Financial Statements; 9 Accounting Ratios; 10 Cash Flow Statement. *(Optional verify: NPO — see §B.1)* | Ch1: profit-sharing, fixed/fluctuating capital; Ch5: share issue; Ch9: liquidity/solvency/profitability ratios; Ch10: ASC 3 cash flows — else chapter-level | ncert_aligned | MCQ, numerical, short |

---

### C.6 Business Studies (BST)

| Subject | Class | Board | NCERT book | Chapters | Concepts (sample) | source_type | Question types |
|---------|------:|-------|------------|----------|-------------------|-------------|----------------|
| Business Studies | 11 | rbse | *Business Studies* Class XI | 1 Nature and Purpose of Business; 2 Forms of Business Organisation; 3 Private, Public and Global Enterprises; 4 Business Services; 5 Emerging Modes of Business; 6 Social Responsibilities of Business and Business Ethics; 7 Formation of a Company; 8 Sources of Business Finance; 9 MSME and Business Entrepreneurship; 10 Internal Trade; 11 International Business | Ch2: sole prop / partnership / company; Ch8: equity vs debt; Ch10: wholesale/retail — else chapter-level | ncert_aligned | MCQ, short |
| Business Studies | 12 | rbse | BST Part I + II | **I:** 1 Nature and Significance of Management; 2 Principles of Management; 3 Business Environment; 4 Planning; 5 Organising; 6 Staffing; 7 Directing; 8 Controlling. **II:** 9 Financial Management; 10 Marketing Management; 11 Consumer Protection. *(Financial Markets dropped in NCERT rationalisation)* | Ch1: levels/functions of mgmt; Ch2: Fayol/Taylor; Ch9: capital structure, working capital; Ch10: 4Ps — else chapter-level | ncert_aligned | MCQ, short |

---

### C.7 Economics

| Subject | Class | Board | NCERT book | Chapters | Concepts (sample) | source_type | Question types |
|---------|------:|-------|------------|----------|-------------------|-------------|----------------|
| Economics | 11 | rbse | Statistics for Economics + Indian Economic Development | **Statistics:** 1 Introduction; 2 Collection of Data; 3 Organisation of Data; 4 Presentation of Data; 5 Measures of Central Tendency; 6 Correlation; 7 Index Numbers; 8 Use of Statistical Tools. **IED:** 9 Indian Economy on the Eve of Independence; 10 Indian Economy 1950–1990; 11 LPG — An Appraisal; 12 Human Capital Formation; 13 Rural Development; 14 Employment; 15 Environment and Sustainable Development; 16 Comparative Development Experiences | Ch5: mean/median/mode; Ch6: Karl Pearson; Ch11: liberalisation reforms — else chapter-level | ncert_aligned | MCQ, numerical (stats), short |
| Economics | 12 | rbse | Introductory Microeconomics + Introductory Macroeconomics | **Micro:** 1 Introduction; 2 Theory of Consumer Behaviour; 3 Production and Costs; 4 The Theory of the Firm under Perfect Competition; 5 Market Equilibrium; 6 Non-competitive Markets. **Macro:** 7 Introduction; 8 National Income Accounting; 9 Money and Banking; 10 Determination of Income and Employment; 11 Government Budget and the Economy; 12 Open Economy Macroeconomics | Ch2: utility, demand; Ch8: GDP methods; Ch10: AD–AS, multiplier — else chapter-level | ncert_aligned | MCQ, numerical, short |

---

### C.8 English (Compulsory / Core) — NCERT-aligned

| Subject | Class | Board | NCERT book | Chapters / lessons | Concepts (sample) | source_type | Question types |
|---------|------:|-------|------------|--------------------|-------------------|-------------|----------------|
| English | 11 | rbse | Hornbill + Snapshots | **Hornbill prose:** 1 The Portrait of a Lady; 2 We’re Not Afraid to Die…; 3 Discovering Tut; 4 The Ailing Planet; 5 The Adventure; 6 Silk Road. **Snapshots:** 7 The Summer of the Beautiful White Horse; 8 The Address; 9 Mother’s Day; 10 Birth; 11 The Tale of Melon City. *(Poetry units under Hornbill can be added as separate chapter keys when seeding lit MCQs.)* | Theme, character, vocabulary, grammar-in-context — chapter-level first | ncert_aligned | MCQ, short (comprehension) |
| English | 12 | rbse | Flamingo + Vistas | **Flamingo prose:** 1 The Last Lesson; 2 Lost Spring; 3 Deep Water; 4 The Rattrap; 5 Indigo; 6 Poets and Pancakes; 7 The Interview; 8 Going Places. **Flamingo poetry:** 9 My Mother at Sixty-Six; 10 Keeping Quiet; 11 A Thing of Beauty; 12 A Roadside Stand; 13 Aunt Jennifer’s Tigers. **Vistas:** 14 The Third Level; 15 The Tiger King; 16 Journey to the End of the Earth; 17 The Enemy; 18 On the Face of It *(+ Memories of Childhood if in active RBSE list)* | Theme, irony, poetic devices, extract-based MCQ — chapter-level | ncert_aligned | MCQ, short |

---

### C.9 Hindi (Compulsory / Core) — NCERT-aligned

| Subject | Class | Board | NCERT book | Chapters (lesson units — verify edition) | Concepts | source_type | Question types |
|---------|------:|-------|------------|------------------------------------------|----------|-------------|----------------|
| Hindi | 11 | rbse | आरोह (Aroh) + वितान (Vitan) | **Aroh (indicative Core set):** नमक का दारोगा; मियाँ नसीरुद्दीन; गलता लोहा / स्पिति में बारिश; जामुन का पेड़; भारत माता; कबीर के पद; मीरा के पद; वह आँखें; घर की याद; ग़ज़ल; हे भूख! …; आओ मिलकर बचाएँ — **plus poetry/prose as per active PDF**. **Vitan:** भारतीय गायिकाओं में बेजोड़ – लता मंगेशकर; राजस्थान की रजत बूँदें; आलो आँधारि | पाठ-बोध, शब्दार्थ, लेखक/कवि — chapter-level | ncert_aligned | MCQ, short |
| Hindi | 12 | rbse | आरोह + वितान | **Aroh** prose+poetry lesson set (~14–18 units per edition); **Vitan** supplementary (~3–4: e.g. सिल्वर वैडिंग; जूझ; अतीत में दबे पाँव; डायरी के पन्ने) | पाठ-बोध, काव्य-सौंदर्य, गद्यांश — chapter-level | ncert_aligned | MCQ, short |

**Hindi honesty:** Exact lesson lists drift between “revised / rationalised” PDFs and Hindi Elective (अंतरा / अंतराल). For RBSE school #1, confirm the school’s prescribed Core vs Elective pack before mass Hindi seeding. Taxonomy folders should use **stable keys** like `aroh_namak_ka_daroga`.

---

### C.10 Deferred subjects (names only)

| Subject | Classes | When |
|---------|---------|------|
| Computer Science | 11–12 | Phase 3+ |
| Informatics Practices | 11–12 | Phase 3+ |
| History, Political Science, Geography, Sociology, Psychology, Public Administration | 11–12 Arts | After Science/Commerce bank is live |
| Physical Education, Fine Arts, Agriculture* | 11–12 | Later |

\*Agriculture is an RBSE stream path — do not pretend it is CBSE.

---

## D. Content acquisition honesty

### D.1 What “gather from the net” **cannot** mean here

- **Cannot** mean bulk-download of NCERT textbook PDFs into Gurukul storage as a redistributed corpus.
- **Cannot** mean scraping commercial “important questions” sites and rebranding as Gurukul IP.
- **Cannot** mean copying Exemplar / textbook exercise wording verbatim at scale without a license or fair-use legal review.
- NCERT publishes textbooks; **copyright remains with NCERT** even when PDFs circulate freely for personal study.

### D.2 What v1 **should** mean

1. **Schema + taxonomy** (this document) — board, class, subject, chapter, concept, source_type, question_format.  
2. **Seed original NCERT-aligned MCQs** — written/generated to test the **same learning outcomes** as NCERT chapters, mapped to our chapter keys; store `source_type = ncert_aligned` (not “ncert_verbatim”).  
3. **Optional later:** licensed / official import pipeline (`licensed_import`) if a board/publisher deal exists.  
4. Teacher-authored and AI-generated items: `teacher` / `ai_generated`, still board-filtered, human-approved before `is_approved`.

### D.3 Practical sourcing for Batch 1

| Allowed | Not allowed |
|---------|-------------|
| SME / AI draft of original stems + options mapped to chapter | Paste full NCERT paragraphs as question stems |
| Paraphrased concept checks, numericals with original numbers | Mirror Exemplar Q numbers and identical distractors en masse |
| Cite “aligned to NCERT Class 12 Maths Ch.3” in metadata | Claim “official RBSE paper” without rights |

---

## E. Phased build plan

| Phase | Work | Done when |
|-------|------|-----------|
| **0** | Schema: `schools.board`; `question_bank.board`, `source_type`, `concept`, `question_format` (+ indexes). Filter RPCs by board. | Migration applied; no large seeds |
| **1** | Class 11–12 RBSE taxonomy (**this doc**) | **User approves RESULT** ← you are here |
| **2** | Seed Batch 1 (2–3 subjects) so questions **visible in app** | Student/teacher can filter and attempt |
| **3** | Remaining 11–12 priority subjects | Coverage ≥1 MCQ set per chapter (target) |
| **4** | Teacher add + AI generate → save to bank with approval | Workflow live |
| **5** | CBSE-specific formats (A/R, case-based) tagged `board=cbse` | CBSE tenants only |

**This turn:** doc only (prefer). Tiny board-column migration is optional and **not** required to approve taxonomy.

---

## F. Recommended first seed batch (for approval)

**Goal:** Prove end-to-end UX with real taxonomy keys — not fill the whole bank.

### Batch 1 proposal

| # | Subject | Class | Chapters | Items | Format | source_type |
|---|---------|------:|----------|------:|--------|-------------|
| 1 | **Mathematics** | 12 | Ch 1–3 (Relations & Functions; Inverse Trigonometric Functions; Matrices) | **20 MCQs each** (60) | mcq | ncert_aligned |
| 2 | **Accountancy** | 12 | Ch 1–2 Partnership basics + Admission | **15 MCQs + 5 numerical-MCQ each** (40) | mcq / numerical | ncert_aligned |
| 3 | **Physics** | 12 | Ch 1–3 (Charges & Fields; Potential & Capacitance; Current Electricity) | **20 MCQs each** (60) | mcq | ncert_aligned |

**Batch 1 total: ~160 questions**  
**Tags:** `board=rbse` (or `both` if intentionally shared), `class_level=12`, chapter string **exactly** matching §C titles.

### Why this batch

- Covers **Science + Commerce** so both streams see content.  
- Chapters 1–3 are early-year teaching material → teachers can use immediately.  
- Maths + Physics stress numerical MCQs; Accountancy shows commerce formats.  
- Small enough to review quality before Phase 3.

### Batch 1.1 (optional immediate follow-on)

- Class 12 BST Ch 1–3 (30 MCQs)  
- Class 12 Chemistry Ch 1–2 (40 MCQs)

---

## G. Existing schema gap (repo note)

Current `public.question_bank` has `class_level`, `subject`, `chapter`, `topic`, `difficulty`, … but **no `board` / `source_type` / `question_format`**.  
`public.schools` has branding fields but **no `board`** yet.

Phase 0 should add those columns before Batch 1 insert. Do **not** mass-seed until taxonomy + columns are approved.

---

## H. Approval checklist

- [ ] School.board model + filter rule (§A) accepted  
- [ ] RBSE subject list for 11–12 (§B) accepted (Arts deferred OK)  
- [ ] Chapter tables for 9 priority subjects (§C) accepted as v1 keys  
- [ ] Content honesty (§D) accepted — original aligned items only  
- [ ] Batch 1 composition (§F) accepted or amended  
- [ ] Proceed to Phase 0 migration + Phase 2 seed

---

## Appendix — Stable chapter keys (examples)

Use slug keys in code even if display titles are localised:

```text
math.12.ch03.matrices
accountancy.12.ch01.partnership_basic_concepts
physics.12.ch03.current_electricity
bst.12.ch01.nature_significance_management
```

Hindi/English keys should be lesson-slug based, medium-agnostic.

---

*End of RESULT — awaiting user approval before SQL seeds.*
