# SQL batches — paste in Supabase SQL Editor (NO Lovable credits)

Project: **kdmjipeksjdyojjdokbi**

Open: https://supabase.com/dashboard/project/kdmjipeksjdyojjdokbi/sql/new

Run **one batch at a time**, wait for success, then run the next.

| Batch | File | Migrations |
|-------|------|------------|

| 1 | `batch-01.sql` | `20260509065137_35bec001-c627-426a-bdd6-dc992c1d3693.sql`, `20260516000000_inquiries_complaints.sql`, `20260604030000_student_panel_fixes.sql`, `20260604060340_60f4721e-63fc-4ef7-8c92-450cfa872f39.sql` |
| 2 | `batch-02.sql` | `20260604080000_battle_monitor.sql`, `20260604100000_battleground_phase4.sql`, `20260605000000_student_portal_login.sql`, `20260606000000_student_success_platform.sql` |
| 3 | `batch-03.sql` | `20260607000000_student_success_phase2.sql`, `20260608000000_student_success_phase3.sql`, `20260604120000_demo_data.sql`, `20260609000000_fix_quick_battle_overload.sql` |
| 4 | `batch-04.sql` | `20260610000000_battleground_overhaul.sql`, `20260611000000_question_template_engine.sql`, `20260612000000_ai_and_audit_fixes.sql`, `20260613000000_concept_mastery_recovery.sql` |
| 5 (seed) | `batch-05-seed-class12-math.sql` | class12_math_templates (1373 rows) |

## After all batches

Run in terminal (with DATABASE_URL in .env.local):
```
npm run db:check-migrations
```

Or verify in SQL Editor:
```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'rpc_student_recovery_zone',
    'rpc_ensure_battle_report',
    'rpc_create_open_battle'
  );
```
