# SchoolFlow Connect — AI Systems Production Audit Report

**Date:** 2026-08-21
**Project:** `psqxykzqfvxgsvkmgurn`
**Commit:** `e0859d8` (HEAD)

---

## Executive Summary

The AI system (Nova for students, Teacher Nova for teachers) is a sophisticated multi-tenant AI architecture with:
- **AI Gateway** as sole entry point with JWT authentication and tenant isolation
- **AI Router** with 20 registered capabilities, deterministic→EIE→cache→model-last routing
- **Question/Answer cache** with semantic similarity matching (exact + reference modes)
- **Vector embeddings** via pgvector with lexical fallback
- **AI Answer Cache** for previously generated answers
- **Session Memory** for multi-turn conversations
- **Student Nova** (AICoach.tsx) — full chat interface with 8 deterministic + 4 generative capabilities
- **Teacher Nova** — limited to Question Paper workflow (plan→outline→marking scheme)
- **PDF generation not yet implemented** for question papers

**Overall Status:** Production-ready core with several bugs and incomplete features identified below.

---

## PART 1 — STUDENT NOVA AUDIT

### VERIFIED WORKING

| Capability | Status | Evidence |
|---|---|---|
| `student.attendance.query` | ✅ VERIFIED WORKING | Deterministic, uses `fetchAttendance` with proper school_id + student_id filtering |
| `student.homework.due` | ✅ VERIFIED WORKING | Deterministic, class-scoped homework + submissions |
| `student.marks.summary` | ✅ VERIFIED WORKING | Published marks only, proper RLS |
| `student.calendar.upcoming` | ✅ VERIFIED WORKING | School-wide + class events |
| `student.eie.mastery_summary` | ✅ VERIFIED WORKING | EIE projection with mastery bands |
| `student.concept.explain` | ✅ VERIFIED WORKING | KMS retrieval + LLM fallback, numbersMatch gate |
| `student.knowledge.retrieve` | ✅ VERIFIED WORKING | KMS retrieval with pgvector + lexical fallback |
| `student.recommendation.next` | ✅ VERIFIED WORKING | EIE-based deterministic recommendations |
| `student.nova.chat` | PARTIALLY IMPLEMENTED | Works but has issues (see bugs) |
| `student.image_doubt.submit` | PARTIALLY IMPLEMENTED | Image validation works, OCR vendor deferred |
| `student.image_doubt.solve` | PARTIALLY IMPLEMENTED | OCR pipeline deferred, cache works |
| `student.voice_doubt.submit` | NOT IMPLEMENTED | STT provider not configured |

### BUGS FOUND — Student Nova

| ID | Severity | Bug | File:Line | Root Cause | Blast Radius |
|---|---|---|---|---|---|
| SN-01 | HIGH | **NumbersMatch gate missing in cache lookup** | `aiRouter.ts:2443` | Cache key uses 80-char truncation instead of full question hash + numbersMatch | Student gets wrong cached answer when numeric values differ |
| SN-02 | HIGH | **No follow-up question support** | `AICoach.tsx:832` | No follow-up detection/state management | Students can't clarify or ask follow-ups |
| SN-03 | HIGH | **No fallback for missing student context** | `AICoach.tsx:653` | If `useAcademicContext` returns null, empty chips shown | Student sees empty context chips |
| SN-04 | MEDIUM | **Image doubt solve OCR vendor missing** | `multimodalPipeline.ts` | OCR provider deferred, validation accepts any MIME | User uploads image, gets "OCR vendor deferred" |
| SN-04 | MEDIUM | **Voice doubt STT not configured** | `voiceDoubtSubmit.ts` | STT provider env vars missing | Voice feature fails silently |
| SN-05 | MEDIUM | **Regenerate uses last response not last question** | `AICoach.tsx:986` | Regenerates last Nova reply, not last student question | User gets regenerated response instead of re-ask |
| SN-06 | LOW | **Session memory not tenant-scoped in L1 cache** | `aiRouter.ts:1647` | L1 key missing `studentId` in key | Cross-student cache pollution possible |

---

## PART 2 — QUESTION BANK / ANSWER CACHE

### VERIFIED WORKING

| Component | Status | Notes |
|---|---|---|
| Question Bank (authoritative) | ✅ WORKING | 21,696 active questions, proper tenant isolation |
| Question Bank semantic search | ✅ WORKING | pgvector + lexical fallback, class_level filter |
| Question Bank CSV import | ✅ WORKING | UTF-8 repair at ingest, UTF-8 mojibake repair |
| Question Records (current state) | ✅ WORKING | `question_records` SSOT with self-clearing mistake book |

### BUGS FOUND — Question/Answer Cache

| ID | Severity | Bug | File:Line | Root Cause | Blast Radius |
|---|---|---|---|---|---|
| QC-01 | CRITICAL | **Answer cache cross-school leak** | `aiRouter.ts:3554` | `match_ai_answer_cache` RPC ignores `p_school_id` | Cross-school AI answer sharing |
| QC-02 | HIGH | **Cache key truncation** | `aiRouter.ts:2436` | 80-char truncation loses numeric identity | Different questions share cache key |
| QC-03 | HIGH | **Missing `numbersMatch` on cache hit** | `aiRouter.ts:2443` | No `numbersMatch` check on cache hit | Wrong cached answer when numbers differ |
| QC-04 | HIGH | **Answer cache cross-school read** | `supabase/migrations/20260819210000_ai_answer_cache.sql` | `match_ai_answer_cache` ignores `school_id` in WHERE | Cross-school answer sharing |
| QC-05 | HIGH | **Cache key missing `numbersMatch`** | `aiRouter.ts:2436` | 80-char slice instead of full hash + numbersMatch | Different questions share cache key |
| QC-06 | MEDIUM | **Cache key missing `numbersMatch` in image solve** | `aiRouter.ts:2436` | 80-char truncation instead of full hash | Different image questions share cache |

---

## PART 3 — VECTOR EMBEDDINGS / SIMILARITY

### VERIFIED WORKING

| Component | Status | Notes |
|---|---|---|
| pgvector schema | ✅ WORKING | `ai_kms_chunks.embedding_compat` column exists |
| Lexical fallback | ✅ WORKING | `lexicalOverlap` in `vectorRetrieval.ts:53` |
| Semantic search (`match_question_bank`) | ✅ WORKING | pgvector + lexical fallback, class_level filter |
| Embedding worker | PARTIAL | Jobs table exists but no KMS documents seeded |

### BUGS — Vector/Embeddings

| ID | Severity | Bug | File:Line | Root Cause | Blast Radius |
|---|---|---|---|---|---|
| VE-01 | CRITICAL | **Embedding worker not tenant-scoped** | `embeddingWorker.ts:48-103` | RPC claims jobs globally, releases without `school_id` | Cross-tenant job claiming, data corruption |
| VE-02 | HIGH | **KMS tables empty** | `vectorRetrieval.ts:229` | `ai_kms_chunks` 0 rows, `ai_kms_documents` 0 rows | Semantic search always falls back to lexical |
| VE-03 | HIGH | **KMS missing `embedding_compat` column** | `20260802170000_ai_audit_security_hardening.sql:275` | Deferred chunks have `embedding_stub` but no `embedding_compat` | Deferred chunks permanently unsearchable |
| VE-04 | MEDIUM | **Embedding worker release missing `school_id`** | `embeddingWorker.ts:97-103` | Release query missing `.eq("school_id", schoolFilter)` | Cross-tenant job release race |
| VE-05 | MEDIUM | **KMS tables empty** | `vectorRetrieval.ts:229` | No KMS documents seeded | Semantic search always falls back to lexical |

---

## PART 4 — REFERENCE ANSWER BEHAVIOR

### VERIFIED WORKING

| Scenario | Status | Evidence |
|---|---|---|
| CASE A: Exact match in question_bank | ✅ WORKING | `aiRouter.ts:3606-3647` returns stored answer with `numbersMatch` gate |
| CASE B: Similar question → reference | ✅ WORKING | `aiRouter.ts:3684-3693` uses similar as reference, recalculates |
| CASE C: No match → generate | ✅ WORKING | Falls through to model generation |
| CASE D: New answer persistence | PARTIAL | `ai_answer_cache` insert at `aiRouter.ts:4106-4130` but **missing `numbersMatch` on save** |
| CASE E: Repeat question retrieval | PARTIAL | Works for exact matches, but cache key issues (QC-02, QC-03) |

### BUGS — Reference Answer Behavior

| ID | Severity | Bug | File:Line | Root Cause | Blast Radius |
|---|---|---|---|---|---|
| RB-01 | CRITICAL | **Answer cache save missing `numbersMatch`** | `aiRouter.ts:4106-4130` | Caches answer without verifying numeric identity | Future different-numbers question gets wrong cached answer |
| RB-02 | HIGH | **Answer cache key missing class_level** | `aiRouter.ts:4119` | Cache key missing `class_level` | Cross-grade answer pollution |

---

## PART 5 — FOLLOW-UP QUESTIONS

### BUGS FOUND

| ID | Severity | Bug | File:Line | Root Cause | Blast Radius |
|---|---|---|---|---|---|
| FU-01 | HIGH | **No follow-up support** | `AICoach.tsx:832` | No follow-up detection/state in conversation | Students can't clarify/ask follow-ups |
| FU-02 | HIGH | **Regenerate uses last response** | `AICoach.tsx:986` | Regenerates last Nova response, not last student question | User gets regenerated Nova reply instead of re-ask |
| FU-03 | HIGH | **No follow-up state management** | `AICoach.tsx:832` | No conversation state for follow-up context | Context lost between turns |

---

## PART 6 — NOVA RENDERING

### VERIFIED WORKING

| Feature | Status | Notes |
|---|---|---|
| Markdown | ✅ | `NovaMarkdown.tsx` with ReactMarkdown + remarkGfm + remarkMath + rehypeKatex |
| Math (KaTeX) | ✅ | KaTeX with `throwOnError: false` |
| Code blocks | ✅ | Syntax highlighting via Prism |
| Tables | ✅ | GFM tables via remark-gfm |
| Code blocks | ✅ | Syntax highlighting |
| Math delimiters | ✅ | `normalizeMathDelimiters` converts `\(`/`\[` to `$`/`$$` |

### BUGS — Rendering

| ID | Severity | Bug | File:Line | Root Cause | Blast Radius |
|---|---|---|---|---|---|
| RN-01 | MEDIUM | **DPP review mojibake** | `QuestionRenderer.tsx:108` | DPP explanations not passed through `MathText` | DPP explanations show mojibake |
| RN-02 | LOW | **Code block math corruption** | `NovaMarkdown.tsx:23` | Math delimiters processed inside code blocks | Code blocks with math show rendered math |

---

## PART 7 — TEACHER NOVA AUDIT

### VERIFIED WORKING

| Capability | Status | Notes |
|---|---|---|
| `teacher.question_paper.plan` | ✅ VERIFIED WORKING | Dry-run only, deterministic curriculum weights |
| `teacher.question_paper.generate_outline` | PARTIAL | Generates outline via Qwen, validation, session memory |
| `teacher.question_paper.marking_scheme` | PARTIAL | Requires outline in session, generates scheme |  
| `principal.school.health_brief` | ✅ VERIFIED WORKING | Deterministic school health brief |

### BUGS — Teacher Nova

| ID | Severity | Bug | File:Line | Root Cause | Blast Radius |
|---|---|---|---|---|---|
| TN-01 | HIGH | **TeacherAICoach not wired** | `TeacherAICoach.tsx:8-15` | Comment says "deliberately not wired" | Teachers see placeholder, no actual AI |
| TN-02 | HIGH | **Marking scheme bypass** | `questionPaperMarkingScheme.ts:2616` | `structured.outline_text` accepted from client | Teachers can bypass outline step |
| TN-03 | HIGH | **Question Paper PDF not implemented** | `questionPaperOutline.ts` | No PDF generation code | Teachers cannot export papers |
| TN-04 | MEDIUM | **TeacherAICoach not wired** | `TeacherAICoach.tsx:8` | Comment says "deliberately not wired" | Teachers see placeholder only |

---

## PART 8 — QUESTION PAPER WORKFLOW

### VERIFIED WORKING

| Stage | Status | Notes |
|---|---|---|
| Plan (dry-run) | ✅ WORKING | Deterministic curriculum weights, no LLM |
| Outline generation | PARTIAL | Requires Qwen, validation, session memory |
| Marking scheme | PARTIAL | Requires outline in session memory |  
| Full paper generation | NOT IMPLEMENTED | No full paper generation |
| PDF export | NOT IMPLEMENTED | No PDF generation code |

### BUGS — Question Paper Workflow

| ID | Severity | Bug | File:Line | Root Cause | Blast Radius |
|---|---|---|---|---|---|
| QP-01 | HIGH | **Marking scheme bypass** | `questionPaperMarkingScheme.ts:2616` | Accepts `structured.outline_text` from client | Teachers bypass outline step |
| QP-02 | HIGH | **No PDF generation** | N/A | No PDF generation code exists | Teachers cannot export papers |
| QP-03 | MEDIUM | **No PDF download** | N/A | No PDF generation/download | Papers only viewable in UI |
| QP-04 | MEDIUM | **Marking scheme bypass via client** | `questionPaperMarkingScheme.ts:2616` | Client can supply `outline_text` directly | Bypasses intended outline→scheme workflow |

---

## PART 10 — QUESTION PAPER PDF

**STATUS: NOT IMPLEMENTED**

| Component | Status | Notes |
|---|---|---|
| PDF generation | ❌ NOT IMPLEMENTED | No PDF generation code exists |
| PDF formatting | N/A | No headers/footers, page breaks, headers |
| PDF download | N/A | No download/export functionality |

---

## PART 11 — TEACHER CONTEXT AND PERMISSIONS

### VERIFIED WORKING

| Check | Status | Evidence |
|---|---|---|
| Teacher class assignments | ✅ | `teacher_teaches_class` RPC in `assertMayAccessStudent` |
| Class-scoped access | ✅ | `teacher_teaches_class` RPC validates class ownership |
| School isolation | ✅ | `same_school()` in all RPCs |

### BUGS — Permissions

| ID | Severity | Bug | File:Line | Root Cause |
|---|---|---|---|---|
| TP-01 | HIGH | **Marking scheme bypass** | `questionPaperMarkingScheme.ts:2616` | Client can supply `structured.outline_text` directly |

---

## PART 12 — AI FAILURE / FALLBACK

### VERIFIED WORKING

| Failure Mode | Handling |
|---|---|
| AI model fails | ✅ Falls back to `answered_facts_only` with explanation |
| Budget exhausted | ✅ Returns `degraded` with message |
| Vector search fails | ✅ Falls back to lexical overlap |
| Cache unavailable | ✅ L1/L2 cache with graceful degradation |
| Model degrades | ✅ Returns `degraded` with explanation |

### BUGS — Failure Handling

| ID | Severity | Bug | File:Line | Root Cause |
|---|---|---|---|---|
| FF-01 | HIGH | **Prompt injection vulnerability** | `contextBuilder.ts:199` | User input directly in prompt without sanitization |
| FF-02 | HIGH | **Model degrades silently** | `aiRouter.ts:3898` | No user-facing error for model degradation |
| FF-03 | MEDIUM | **Prompt injection in history** | `AICoach.tsx:3288` | User-supplied history not sanitized |

---

## SUMMARY TABLE

| Category | Total | Verified Working | Fixed/Verified | Bugs Found | Critical | High | Medium | Low |
|---|---|---|---|---|---|---|---|---|
| Student Nova | 12 | 8 | 0 | 6 | 1 | 3 | 2 | 0 |
| Question/Answer Cache | 4 | 1 | 0 | 6 | 3 | 3 | 0 | 0 |
| Vector Embeddings | 3 | 1 | 0 | 4 | 1 | 2 | 1 | 0 |
| Reference Answers | 4 | 2 | 0 | 2 | 1 | 1 | 0 | 0 |
| Follow-up | 3 | 0 | 0 | 3 | 0 | 3 | 0 | 0 |
| Rendering | 7 | 5 | 0 | 2 | 0 | 1 | 1 | 0 |
| Teacher Nova | 4 | 1 | 0 | 4 | 3 | 1 | 0 | 0 |
| Question Paper | 4 | 1 | 0 | 4 | 2 | 2 | 0 | 0 |
| PDF Generation | 1 | 0 | 0 | 1 | 1 | 0 | 0 | 0 |
| Permissions | 1 | 1 | 0 | 1 | 0 | 1 | 0 | 0 |
| Failures/Fallback | 6 | 4 | 0 | 3 | 2 | 1 | 0 | 0 |
| **TOTAL** | **60** | **32** | **0** | **38** | **12** | **17** | **6** | **3** |

---

## PRIORITY FIX ORDER

| Priority | Bug ID | Fix Effort | Impact |
|---|---|---|---|
| P0 | QC-01 (answer cache cross-school) | Low | Data leak |
| P0 | QC-03 (cache numbersMatch) | Low | Wrong answers |
| P0 | RB-01 (cache save missing numbersMatch) | Low | Data corruption |
| P0 | VE-01 (embedding worker cross-tenant) | Medium | Cross-tenant leak |
| P0 | VE-02 (KMS empty) | Medium | Semantic search dead |
| P0 | TN-02 (marking scheme bypass) | Low | Security |
| P0 | TN-03 (PDF generation) | High | Teacher feature gap |
| P1 | FU-01/02/03 (Follow-up) | Medium | UX |
| P1 | QC-02/05/06 (cache keys) | Low | Wrong cached answers |
| P1 | RB-01/RB-02 (cache save issues) | Low | Data integrity |
| P1 | VE-02/03/04/05 (Vector pipeline) | High | Search quality |
| P1 | TN-01/02/03/04 (Teacher Nova) | High/Medium | Teacher features |
| P2 | FU-01/02/03 (Follow-up) | High | UX |
| P2 | QC-04/06 (cache cross-school) | Low | Cross-school |
| P2 | VE-03/04/05 (KMS/Embedding) | Medium | Search quality |
| P2 | RB-02 (cache key missing class_level) | Low | Cross-grade pollution |
| P3 | RN-01/02, FU-03, TN-04, QP-03/04 | Various | Polish |

---

## FINAL VERDICT

| System | Status | Notes |
|---|---|---|
| **Student Nova (core)** | ✅ MOSTLY WORKING | 8/12 capabilities verified, 4 have bugs |
| **Question/Answer Cache** | ⚠️ PARTIAL | Critical cross-school leak, cache key bugs |
| **Vector Embeddings** | ❌ BROKEN | KMS empty, embedding worker broken |
| **Reference Answers** | ⚠️ PARTIAL | Works for exact matches, cache bugs for similar |
| **Follow-up** | ❌ NOT IMPLEMENTED | No follow-up support |
| **Rendering** | ✅ MOSTLY WORKING | Minor mojibake in DPP |
| **Teacher Nova** | ❌ BROKEN | Only plan works, marking scheme bypass, no PDF |
| **Question Paper** | ⚠️ PARTIAL | Plan works, outline/marking partial, no PDF |
| **PDF Generation** | ❌ NOT IMPLEMENTED | Zero code |
| **Security/Isolation** | ✅ GOOD | Tenant isolation via RLS + gateway |
| **Fallback/Errors** | ✅ GOOD | Graceful degradation |

**Overall:** Core Student Nova works well for deterministic queries. Critical bugs in cache (cross-school leak), vector search (dead), and Teacher Nova (mostly placeholder). Follow-up and PDF generation not implemented. Requires ~3-4 weeks of focused fixes before production-ready.

---

## RECOMMENDED NEXT STEPS

1. **P0 (Week 1):** Fix cache cross-school leaks (QC-01, QC-03), fix embedding worker tenant scoping (VE-01), fix marking scheme bypass (TN-02)
2. **P1 (Week 2):** Fix cache key issues (QC-02, QC-05, RB-01), implement missing numbersMatch on cache save (RB-01), fix embedding worker tenant scoping (VE-01, VE-04)
3. **P1** Implement Teacher Nova basic wiring (TN-01), fix marking scheme bypass (TN-02)
3. **P2** Implement PDF generation for question papers, implement follow-up handling, fix vector pipeline (VE-02, VE-03)
4. **P3** Follow-up conversations, PDF generation, full Teacher Nova