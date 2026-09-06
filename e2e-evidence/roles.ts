/**
 * Role → demo account map for the evidence harness.
 *
 * AUTH ROUTE: email+password via the real /auth form (Supabase password
 * sign-in). Chosen over the spec's two proposed routes because it needs no
 * service key and touches no production auth config — see the session report.
 * Passwords are the seeded demo-account passwords (docs/DEMO_ACCOUNTS.md),
 * scoped to demo tenants only. Override any via env.
 *
 * super_admin and the dual-role (teacher+parent) account are NOT in the demo
 * seed and have no known password, so they are marked reachable:false unless
 * credentials are supplied via env. Minting them would need the service key,
 * which is absent from this environment.
 */
export interface RoleAccount {
  role: string
  email: string
  password: string
  /** URL prefix the app should land on after login. */
  home: RegExp
  /** False when no credentials are known and none supplied via env. */
  reachable: boolean
}

const P = 'DemoPass123!'

export const ROLES: RoleAccount[] = [
  { role: 'admin', email: env('E2E_ADMIN_EMAIL', 'admin@wisdomcampus.com'), password: env('E2E_ADMIN_PASSWORD', P), home: /\/admin/, reachable: true },
  { role: 'principal', email: env('E2E_PRINCIPAL_EMAIL', 'principal@wisdomcampus.com'), password: env('E2E_PRINCIPAL_PASSWORD', P), home: /\/principal/, reachable: true },
  { role: 'teacher', email: env('E2E_TEACHER_EMAIL', 'priya.sharma@wisdomcampus.com'), password: env('E2E_TEACHER_PASSWORD', P), home: /\/teacher/, reachable: true },
  { role: 'student', email: env('E2E_STUDENT_EMAIL', 'qa.automation@wisdomcampus.com'), password: env('E2E_STUDENT_PASSWORD', 'QaAutomation123!'), home: /\/student/, reachable: true },
  { role: 'parent', email: env('E2E_PARENT_EMAIL', 'mehta.parent@wisdomcampus.com'), password: env('E2E_PARENT_PASSWORD', P), home: /\/parent/, reachable: true },
  // Not in the demo seed — supply E2E_SUPERADMIN_EMAIL/PASSWORD to enable.
  { role: 'super_admin', email: env('E2E_SUPERADMIN_EMAIL', ''), password: env('E2E_SUPERADMIN_PASSWORD', ''), home: /\/admin/, reachable: !!process.env.E2E_SUPERADMIN_EMAIL },
  // Dual-role teacher+parent — supply E2E_DUAL_EMAIL/PASSWORD to enable.
  { role: 'dual_teacher_parent', email: env('E2E_DUAL_EMAIL', ''), password: env('E2E_DUAL_PASSWORD', ''), home: /\/(teacher|parent)/, reachable: !!process.env.E2E_DUAL_EMAIL },
]

export const authFile = (role: string) => `e2e-evidence/.auth/${role}.json`

function env(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.length > 0 ? v : fallback
}
