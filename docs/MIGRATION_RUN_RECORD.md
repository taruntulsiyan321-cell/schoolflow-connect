# Migration run record (internal — ask the agent for the current list)

**Project:** `kdmjipeksjdyojjdokbi`  
**Last checked:** 2026-06-04 (via `npm run db:check-migrations`)

> Do not paste DB passwords or `sbp_` tokens in chat. Use `.env.local` + `npm run db:migrate` locally, or Lovable SQL without AI credits for settings-only copy.

---

## Already applied on live DB

| File | Label |
|------|-------|
| `20260604000000_wisdom_student_engine.sql` | Wisdom student engine (DPP) |
| `20260604010000_leaderboard_rpc.sql` | Leaderboard RPC |
| `20260604020000_notifications.sql` | Notifications |
| `20260604040000_app_settings.sql` | App settings |
| `20260604070000_battleground_feed_ai.sql` | Battleground feed + AI tables |
| `20260604090000_battle_reports.sql` | Battle reports |

---

## Pending — run in this order

| # | File | Label |
|---|------|-------|
| 1 | `20260509065137_35bec001-c627-426a-bdd6-dc992c1d3693.sql` | Admin connect student/teacher |
| 2 | `20260516000000_inquiries_complaints.sql` | Inquiries & complaints |
| 3 | `20260604030000_student_panel_fixes.sql` | Student panel fixes |
| 4 | `20260604060340_60f4721e-63fc-4ef7-8c92-450cfa872f39.sql` | Combined pending bundle |
| 5 | `20260604080000_battle_monitor.sql` | Battle monitor |
| 6 | `20260604100000_battleground_phase4.sql` | Battleground phase 4 (curriculum, topic) |
| 7 | `20260605000000_student_portal_login.sql` | Portal email/phone auto-link |
| 8 | `20260606000000_student_success_platform.sql` | Student Success Phase 1 |
| 9 | `20260607000000_student_success_phase2.sql` | Student Success Phase 2 |
| 10 | `20260608000000_student_success_phase3.sql` | Student Success Phase 3 |
| 11 | `20260604120000_demo_data.sql` | Demo users & seed data |
| 12 | `20260609000000_fix_quick_battle_overload.sql` | Fix solo quiz RPC overload |
| 13 | `20260610000000_battleground_overhaul.sql` | Lobbies, auto-finish, NCERT curriculum RPC |
| 14 | `20260611000000_question_template_engine.sql` | Class 12 Math template engine tables + RPCs |
| 15 | `20260612000000_ai_and_audit_fixes.sql` | Battle report ensure/snapshot + secure AI insights save |
| 16 | `20260613000000_concept_mastery_recovery.sql` | Concept tagging, mastery scores, recovery zone, analytics RPCs |

**After migration 14:** `npm run seed:math12` → seeds 1300+ question templates.

**Migration 15** adds `rpc_ensure_battle_report` and `rpc_save_battle_ai_insights` (required for AI/offline battle reports).

**Migration 16** adds concept mastery, recovery assignments, post-assessment concept reports, and teacher/parent/principal concept analytics. Deploy edge function `ai-concept-report` for optional AI insights.

All paths: `supabase/migrations/`

---

## Local apply (no Lovable credits)

```powershell
# .env.local needs DATABASE_URL=postgresql://...
npm run db:migrate
npm run db:check-migrations
```

Or one big paste: `supabase/LOVABLE_PASTE_ALL_PENDING.sql` → `npm run db:migrate:all`

---

## Lovable chat command (copy from `LOVABLE_CHAT_PASTE_THIS.txt`)

See root file `LOVABLE_CHAT_PASTE_THIS.txt` for the latest paste-ready prompt.

---

## Edge functions (after SQL)

Deploy on Supabase project (not SQL migrations):

- `ai-explain`
- `ai-battle-report`
- `ai-improvement-plan`

Requires `LOVABLE_API_KEY` on the project.

---

## Maintenance

- Update **Pending** table after each `npm run db:check-migrations`
- Append new migration files to `scripts/apply-pending-migrations.mjs` `PENDING_FILES`
- Regenerate or append `supabase/LOVABLE_PASTE_ALL_PENDING.sql` when adding migrations
