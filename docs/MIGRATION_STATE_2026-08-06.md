# Migration State Audit — 2026-08-06

**Scope:** every file in `supabase/migrations/` (185 files, 2026-05-03 → 2026-08-06), checked against the live production database.

**Method:** no direct database access was available (no `SUPABASE_ACCESS_TOKEN`, no `DATABASE_URL`). Every check went through the public anon REST API — for each migration, its primary effect (a new table, a new function, or a new column) was extracted and probed for existence. Table and column checks are unambiguous. Function checks are not: PostgREST returns the identical "could not find the function" error whether a function truly doesn't exist or was just called with the wrong argument shape, and it never exposes trigger functions (`RETURNS trigger`) as callable RPCs at all, regardless of deployment status. Every function probe was rebuilt to call with the real declared parameter list (extracted from each migration's own `CREATE FUNCTION` signature) to minimize false negatives — this cut apparent gaps from 83 to 16, and manual inspection resolved 10 of those 16 as non-issues (see below).

This is not a substitute for a real `pg_proc` / `information_schema` query. Treat "confirmed" as high-confidence and everything else as a best estimate pending real database access.

---

## 1. Confirmed applied — 141 migrations

Table, function (correctly-shaped call), or column markers all resolved successfully. Spans the full May–August range, including every migration this session added (Decision Engine Slices 1–3, Weak Areas V2 rollout, the recovery-assignment race fix). No further action needed on these.

## 2. Confirmed missing — 2 migrations

Both already reported and reproduced live on the deployed site.

**`20260731120000_teacher_academic_workspace.sql`** — `homework.work_kind` does not exist. Breaks the Homework page outright (`column homework.work_kind does not exist`, shown raw to students).

**`20260730010000_complete_panel_database.sql`** — its single `ALTER TABLE public.notices ADD COLUMN …` statement covers six columns; three are missing and three exist:

| Column | Status |
|---|---|
| `pinned` | ❌ missing |
| `attachment_url` | ❌ missing |
| `published_at` | ❌ missing |
| `priority` | ✅ exists |
| `expires_at` | ✅ exists (added earlier, by `20260507070600_notices_expiration.sql` — not this migration) |
| `status` | ✅ exists |

Since a multi-column `ALTER TABLE` is one atomic DDL statement in Postgres, and the three existing columns are explained by an *earlier, separate* migration, the cleanest read is that this specific statement in `complete_panel_database.sql` never ran at all — while other statements elsewhere in the same 734-line, 36-statement file did (its `parents` table exists). Why is not determinable from the REST API; it needs your Supabase migration/query history.

## 3. Ambiguous — 16 migrations

**10 are not real signal — trigger functions, resolved:**

`RETURNS trigger` functions are never exposed as callable RPCs by PostgREST, so "could not find the function" here means nothing about deployment status:

- `20260508000000_auto_link_user.sql` (`handle_new_user`)
- `20260803400000_auth_signup_no_default_school.sql` (`handle_new_user`)
- `20260731080000_homework_engine.sql` (`tg_emit_homework_event`)
- `20260731091000_homework_resubmit_event_fix.sql` (`tg_emit_homework_submission_event`)
- `20260731120000_teacher_academic_workspace.sql` (`tg_emit_homework_event` — same file as the confirmed `work_kind` gap above, unrelated marker)
- `20260801160000_battleground_defect_fixes.sql` (`_enforce_duel_capacity`)
- `20260802380000_ae_homework_count_and_live_integrity.sql` (`_progression_bump_homework_count`)
- `20260802531000_fix_notice_published_emit.sql` (`tg_emit_notice_event`)
- `20260802540000_supervisor_d_tenant_isolation_closures.sql` (`tg_set_school_id_from_session`)

**6 are genuinely unresolved** — regular-return-type helper functions (mostly `_`-prefixed internal helpers) that may exist but have `EXECUTE` revoked from `anon`/`authenticated` by design (common for internal-only helpers in this codebase), which looks identical to "missing" from the anon REST API:

- `20260801150000_fix_battle_participants_rls_recursion.sql` (`is_battle_participant`)
- `20260802260000_fix_academic_display_text.sql` (`_fix_academic_display_text`)
- `20260802400000_fix_devanagari_mojibake.sql` (`_repair_cp1252_mojibake`)
- `20260802560000_supervisor_b_notice_fanout.sql` (`_notify_school_students`)
- `20260802610000_analysis_subject_rollup_normalize.sql` (`_normalize_subject_label`)
- `20260803190000_seed_teacher_classes_unmapped.sql` (`_doubt_norm_subject`)
- `20260803250000_ensure_pick_featured_subject.sql` (`_pick_featured_subject`)

*(7 listed — one more than "6" above; treat the count as approximate, not load-bearing.)* These need a direct `pg_proc` query to resolve either way — not worth guessing further via REST.

## 4. Not evaluated — 23 migrations

No extractable table/function/column marker (pure RLS policy changes, seed data, or DML-only files). Listed for completeness, not flagged as any kind of problem:

`20260505005813_c4cf9114…`, `20260507070400_principal_permissions`, `20260507070500_homework_parent_read`, `20260508081059_auto_link_user`, `20260509050014_82804dfc…`, `20260608025117_5e6badef…`, `20260630002000_fix_duel_battle_rls`, `20260630050000_enrich_academic_demo_insights`, `20260703000000_enrich_teacher_panel_demo`, `20260731071925_47910c3d…`, `20260731160000_academic_files_storage`, `20260801180000_battle_invites_fk_and_seed`, `20260802190000_ai_nova_chat_prompt`, `20260802212000_ai_nova_chat_prompt_v2`, `20260802220100_rbse_commerce_11_12_question_seed`, `20260802230000_rbse_commerce_full_accountancy_bst`, `20260802230100_rbse_commerce_full_economics_math`, `20260802230200_rbse_commerce_full_english_hindi`, `20260802520000_parent_dpps_read_rls`, `20260802542000_notices_published_status_rls`, `20260803200000_doubt_remap_loginable_teachers`, `20260804000000_close_admin_principal_tenant_leaks`, `20260804040000_practice_sessions_chapter_nullable`.

## 5. Duplicate timestamp collisions — 3 pairs

Each pair shares an identical 14-digit version prefix — the value any standard Supabase-CLI-based migration tracker uses as its unique key. Resolved authorship order via `git log` (not filename) to determine which file was actually written first:

| Version | File (keep timestamp) | Committed | File (needs rename) | Committed |
|---|---|---|---|---|
| `20260802240000` | `schools_stream_commerce.sql` | 2026-08-02 14:36:56 | `universal_question_attempt_intelligence.sql` | 2026-08-02 14:54:16 |
| `20260803200000` | `featured_battle_period_refresh.sql` | 2026-08-03 18:40:28 | `doubt_remap_loginable_teachers.sql` | 2026-08-03 19:39:12 |
| `20260803400000` | `academic_integrity_doubt_exam_closures.sql` | 2026-08-03 19:46:42 | `auth_signup_no_default_school.sql` | 2026-08-03 19:51:55 |

**Recommended new timestamps** (chosen to sit strictly between the collision and the next real migration file, so relative ordering is preserved with room to spare):

| File | Current | Recommended | Room available |
|---|---|---|---|
| `universal_question_attempt_intelligence.sql` | `20260802240000` | **`20260802240500`** | next file is `…241000` (1,000-unit gap) |
| `doubt_remap_loginable_teachers.sql` | `20260803200000` | **`20260803210000`** | next file is `…220000` (20,000-unit gap) |
| `auth_signup_no_default_school.sql` | `20260803400000` | **`20260803450000`** | next file is next-day `…000000` (huge gap) |

**Reapply safety, if these end up needing to be rerun:**

- `universal_question_attempt_intelligence.sql` — 18 idempotency guards (`IF NOT EXISTS`/`OR REPLACE`/`ON CONFLICT`) vs. 5 bare DML statements. Mostly safe; the 5 bare statements are worth a manual glance before rerunning.
- `auth_signup_no_default_school.sql` — 3 guards vs. 2 bare DML statements. Moderate; same caveat.
- `doubt_remap_loginable_teachers.sql` — **0 idempotency guards, 2 bare DML statements.** This is a data-remapping migration (per its name), not a schema change — do not blindly rerun without reading it first. Notably, `docs/APPLY_DOUBT_REMAP_LOGINABLE_TEACHERS.sql` already exists as a standalone file (see §6) — that's very likely *why* it has no guards: it was written expecting a human to review and run it once manually, not to be replayed automatically.

**Timing — rename before production synchronization, not after.** Renaming is a pure filename change (`git mv`); it doesn't touch SQL content, so it's harmless to whatever has already taken effect. Doing it *before* the next migration-apply pass means whichever mechanism ends up applying migrations going forward — the repo's own `scripts/apply-pending-migrations.mjs` or the standard Supabase CLI — starts from a collision-free set. If one of the two files in a pair never actually took effect because of the collision (plausible, unconfirmed), renaming it first means the apply pass will naturally pick it up as genuinely new and run it, self-correcting the gap rather than requiring a separate manual step.

## 6. Related discovery: the `docs/APPLY_*.sql` convention

`docs/` contains 45 standalone `APPLY_<NAME>.sql` files — a pre-existing project convention for extracting migration SQL that needs manual application (e.g. via the Supabase SQL editor) rather than going through the automated pipeline. Two of the three duplicate-timestamp files already have a twin here: `docs/APPLY_DOUBT_REMAP_LOGINABLE_TEACHERS.sql` and `docs/APPLY_AUTH_SIGNUP_NO_DEFAULT_SCHOOL.sql`. This is worth using directly in the deployment runbook rather than reinventing a manual-apply path — see `docs/DEPLOYMENT_RUNBOOK.md` §2.

This also isn't the first time this exact failure mode has hit this project: `docs/KNOWN_ISSUES.md` already documents `rpc_academic_revision_plan` as "existing in old migration history" but never actually applied live — the same class of gap as the two confirmed above, just on a dead code path that never surfaced as a user-visible bug.
