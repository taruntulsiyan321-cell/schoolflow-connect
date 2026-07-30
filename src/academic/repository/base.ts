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
