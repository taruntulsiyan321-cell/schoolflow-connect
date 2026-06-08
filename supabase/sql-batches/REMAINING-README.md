# REMAINING migrations only (live DB probe)

Already applied: wisdom engine, leaderboard, notifications, app_settings,
battleground feed, battle reports, portal login, student success phase 1.

Open: https://supabase.com/dashboard/project/kdmjipeksjdyojjdokbi/sql/new

Run each file below **in order**. Wait for success before the next.

| Step | File |
|------|------|
| 1 | `remaining-01.sql` |
| 2 | `remaining-02.sql` |
| 3 | `remaining-03.sql` |
| 4 | `remaining-04.sql` |
| 5 | `remaining-05.sql` |
| seed | `remaining-seed-class12.sql` |

Or run: `npm run db:paste-next` to copy batch 1 to clipboard + open SQL Editor.