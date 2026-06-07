# Apply migrations without Lovable credits

Lovable AI credits are **not** required. The database is Supabase; you only need the **Postgres password**.

## Why `sbp_...` token failed (403)

Personal access tokens only work on Supabase projects **your account owns**. Lovable Cloud projects belong to Lovable’s org.

## Fastest fix (2 minutes)

1. Open Lovable → your project → **Settings** → **Supabase** (or Database).
2. Copy the **connection URI** (`postgresql://postgres.kdmjipeksjdyojjdokbi:...`).
3. In PowerShell:

```powershell
cd "C:\Users\tarun\Downloads\New folder\schoolflow-connect"
.\scripts\run-complete-setup.ps1
```

4. Paste the URI when prompted → migrations run automatically.

Or manually add to `.env.local`:

```env
DATABASE_URL=postgresql://...
```

Then:

```powershell
npm run db:migrate
npm run db:check-migrations
```

## Still pending (if not migrated yet)

- Admin connect, inquiries, student panel, battle monitor, battleground phase 4
- Portal login (`portal_email`)
- Student Success Phase 1–3 (`060`, `070`, `080`)
- Demo data (`20260604120000_demo_data.sql`)

## Test account (after demo migration)

- Email: `arjun.mehta@wisdomcampus.demo`
- Password: `DemoPass123!`
