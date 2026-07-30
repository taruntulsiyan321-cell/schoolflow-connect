# Gurukul Authentication

Central auth lives in `src/auth/`. All pages should consume `useAuth()` from `@/auth` (or the compatible re-export `@/hooks/useAuth`).

## Stack

- **Provider:** Supabase Auth only (email + password today)
- **Session:** persisted + auto-refreshed by the Supabase JS client
- **Profile / role / school:** loaded via `get_auth_context()` RPC after sign-in

## Roles

| Role | Dashboard | Notes |
|------|-----------|-------|
| `admin` | `/admin` | School Admin |
| `principal` | `/principal` | |
| `teacher` | `/teacher` | |
| `student` | `/student` | |
| `parent` | `/parent` | |
| `super_admin` | (future) | Platform operator — enum reserved |

Each account has **exactly one** role (`user_roles.user_id` unique).

## Multi-tenant

- `schools` table = tenants
- `profiles.school_id` = the user’s school
- Client exposes `schoolId` / `school` from `useAuth()`
- SQL helper: `get_my_school_id()` for RLS (`school_id = public.get_my_school_id()`)
- Default seeded school: Wisdom Campus (`00000000-0000-4000-8000-000000000001`)

Apply migration:

```bash
supabase db push
# or run supabase/migrations/20260730000000_auth_multitenant_foundation.sql
```

## Client API

```ts
const {
  user, session, role, profile, school, schoolId,
  loading, isAuthenticated, status,
  signIn, signOut, requestPasswordReset, updatePassword,
  refreshAuth, homePath,
} = useAuth();
```

## Route protection

- Unauthenticated → `/auth` (preserves `from`)
- Wrong role → `/unauthorized`
- Disabled account → `/unauthorized`

Never rely on UI alone — keep RLS policies using `has_role` + `get_my_school_id()`.

## Admin-provisioned users

Create Auth users via Edge Function `admin-link-account` (service role) or portal email reservation + first login (`link_portal_on_auth`).

## Future (architecture-ready, not implemented)

- Google / Microsoft OAuth (hook points exist via Lovable OAuth bridge)
- MFA
- Super Admin console
- Multiple campuses per school
