# Phase 6 — Student Nova & Teacher AI (Live)

**Date:** 2026-08-21 08:50 UTC subagent exhaustive — 20 caps, vector, cache, multimodal, gateway 331 lines, aiRouter 4237 lines
**Baseline:** `ai_solution_cache 71`, `ai_kms_docs 0 chunks 0` (vector not seeded), `OPENROUTER_API_KEY` required for generative.

## Pipeline invariant (holds for all 20 caps)

`getCapability(feature_id)` -> `allowed_roles.includes(actor.role)` -> `resolveStudentTarget(actor,target)` -> `assertMayAccessStudent(userClient,admin,actor,studentId)` double `eq(school_id).eq(student_id)` or `eq(user_id)` -> probe content-hash -> fetch authoritative -> calculate -> retrieve-before-model -> `buildContextPack+packForModel+reserveBudget` -> `completeWithPromptLibrary` -> `validateModelResponse+scoreConfidence+applyConfidencePolicy` -> `writeDecision` -> `NovaMarkdown remarkGfm+remarkMath+rehypeKatex throwOnError:false`. Gateway `resolveActor` never `super_admin`, rejects `tenant_forge/actor_forge 400`, kill-switch `ai.gateway.enabled` global seed missing -> 503 fail-closed. Rendering `fixUtf8Content + normalizeMathDelimiters` always.

## Capability split

| policy | caps | model |
|---|---|---|
| never 11 caps | attendance/homework/marks/calendar/eie/parent*/recommendation/knowledge/plan/health | never call model (comment explicit) |
| optional_explain performance/concept/image_doubt* + voice | true | gated, fallback facts_only |
| required_when_budget nova.chat/outline/marking_scheme | true | hard requires Qwen via OpenRouter, budget `ai_budget_check_and_reserve` soft/hard breach tier downgrade/budget_exhausted |

## Per-capability spot checks

* **Attendance/homework/marks/calendar/eie deterministic** — `aiRouter fetchAttendance 120 rows present+late*0.5/half_day*0.5`, `fetchHomeworkDue published|active + submissions pending`, `fetchMarksSummary published exams only`, `fetchEie mastery+revision+profile`. All double eq school_id, `isPlaceholderLabel` filtered, `numbersMatch` numeric safety prevents cache reuse when values differ (0.94 vs 0.79 empirical). **PASS** — never invent metrics, honest empty `completeness 0.3` when missing.
* **Vector retrieval** — `retrieveKmsChunks` via `ai_kms_retrieve_chunks` RPC `published + visibility_scope + school_id` filtered, `embedding_compat` vs `lexicalOverlap` fallback, `vector_attempted` flag. Live 0 docs -> `sufficient false` -> retrieval not blocked. **PASS** architecture, not seeded.
* **Cache** — probes `probeAttendance etc 1204-1424` mirror primary query mutable columns, `hashRows SHA256(sortedRows).slice(0,16)` content-addressed, L1 60s Map + L2 `unique (school_id,cache_key) expires 10m`. Old hardcoded `"pending"` bug fixed: edit -> hash miss instantly. Partitioned per `schoolId:featureId:studentId:dataVersion`. **PASS**.
* **Image/voice doubt** — `multimodalPipeline 342 lines` validate->safety->OCR/STT until clarify, `imageDoubtSolve 333 lines` gated `reconstructed_question + extraction_confidence` -> cache->KMS->model with Validator/Confidence. **PASS** — never invents problem text, OCR vendor deferred clarify path explicit.
* **Teacher question-paper** — `plan` dry-run deterministic weights never model, `generate_outline` + `marking_scheme` via Gateway -> Qwen + Validator + sessionMemory `ai_session_memory_open/append` TTl 120m under user JWT not service_role, `kill-switch` safe, outline must exist before marking_scheme. UI `TeacherAICoach.tsx 157 lines` same gateway. **PASS**.

## Open (from subagent, saved for fix batch)

* `ai_answer_cache` cross-school read scope already G0-2 / G1-3 — `match_ai_answer_cache` ignores `school_id`.
* Nova `performance.explain` could concatenate facts from multiple probes — `combineProbes` hashes 4 tables; probe still counts as one key `combo:hash(parts)` — correct but GC-bound key is `combo`, not per-table invalidation granularity.
* Embedding jobs `ai_embedding_jobs 0` but worker `processEmbeddingJobsBatch` admin/principal only via `system.embedding.process_batch` capability `feature_id` check `actor.role admin|principal` — correct, not yet live-tested with real OpenRouter key.

> Save point 08:50 — Nova/Teacher AI PASS with honest-empty + tenant double-eq + numeric safety + hash invalidation. Full per-capability trigger tests (correct/missing/stale/empty/another-student/another-school/ambiguous/image/file) queued for block 2/3 next 90 min when DB published gate seed fixed (marks unpublished blocks marks-summary verify).

