import { supabase } from "@/integrations/supabase/client";
import { requireSchoolId } from "../tenant";
import { AcademicRepositoryError } from "./errors";

export type DbClient = typeof supabase;

export interface RepoContext {
  /** Authenticated tenant — required for every tenant-scoped query */
  schoolId: string;
  /** Optional actor for audit/event payloads */
  userId?: string | null;
  /** Injected client (tests / service role later) */
  client?: DbClient;
}

export function getClient(ctx: RepoContext): DbClient {
  return ctx.client ?? supabase;
}

export function schoolIdOf(ctx: RepoContext): string {
  return requireSchoolId(ctx.schoolId);
}

/** Throw a typed error from a PostgREST failure. */
export function throwIfError(error: { message: string; code?: string } | null, fallback: string): void {
  if (!error) return;
  throw new AcademicRepositoryError(error.code ?? "db_error", error.message || fallback);
}

/**
 * Errors that say "not now", never "not allowed".
 *
 *   57014  canceling statement due to statement timeout
 *   55P03  lock not available
 *   40001  serialization failure      40P01  deadlock detected
 *   08000/08003/08006  the connection went away
 *   53300  too many connections       53400  configuration limit exceeded
 *
 * Measured on production 2026-09-23: `rpc_finish_practice_session` answered
 * 57014 while the Battleground's featured-battle maintenance was running, and
 * the student's session simply failed to save. A permission refusal (42501), a
 * constraint (23514) or a bad argument (22P02) is not in this list and must
 * never be retried — repeating those only wastes the database's time.
 */
const TRANSIENT_DB_CODES = new Set([
  "57014", "55P03", "40001", "40P01", "08000", "08003", "08006", "53300", "53400",
]);

export function isTransientDbError(error: unknown): boolean {
  if (!error) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_DB_CODES.has(code)) return true;
  const message = String((error as { message?: unknown }).message ?? "");
  // A dropped request reaches the browser as a TypeError from fetch, with no
  // code at all; the server may not have seen it, so it is worth one more try.
  return /Failed to fetch|NetworkError|network request failed|statement timeout/i.test(message);
}

/**
 * Run a call that is safe to repeat, retrying only what is transient.
 *
 * The caller must be idempotent — rpc_finish_practice_session is (it
 * de-duplicates the attempts it is sent and then counts the session from
 * question_attempts), which is the same property the page-exit keepalive path
 * already relies on.
 */
export async function retryTransient<T>(
  run: () => Promise<T>,
  opts: { attempts?: number; delaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const delays = opts.delaysMs ?? [400, 1200];
  const attempts = opts.attempts ?? delays.length + 1;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (e) {
      lastError = e;
      if (!isTransientDbError(e) || i === attempts - 1) throw e;
      await sleep(delays[Math.min(i, delays.length - 1)]);
    }
  }
  throw lastError;
}

export interface PageParams {
  limit?: number;
  offset?: number;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export function normalizePage(params?: PageParams): { limit: number; offset: number } {
  const limit = Math.min(
    Math.max(params?.limit ?? DEFAULT_PAGE_LIMIT, 1),
    MAX_PAGE_LIMIT,
  );
  const offset = Math.max(params?.offset ?? 0, 0);
  return { limit, offset };
}
