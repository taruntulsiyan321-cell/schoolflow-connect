/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * What `https://esm.sh/@supabase/supabase-js@2.45.0` gives the edge functions,
 * for `tsconfig.edge.json` (docs/TODO.md E6).
 *
 * That version is not installed, and the installed one (2.105) types an
 * untyped client differently — its rows come out `never` — so checking the
 * functions against it reports defects that do not exist. Every function
 * creates its client WITHOUT a Database type, and for such a client 2.45.0
 * gives: a select resolves to `{ data: any[] | null, error: PostgrestError |
 * null }`; `single()`/`maybeSingle()` to one `any` row (or the row type passed
 * as a type argument); `rpc()` to `any`; and `auth.getUser()` to a user or an
 * error, never both. That is what is written here, and nothing more: a
 * function that reads `error.message` without checking `error`, or a row
 * without checking `data`, fails exactly as it would under 2.45.0's own types.
 *
 * Covers what the functions call (counted 2026-10-13); a call to anything else
 * on a builder is a type error here, which is the prompt to add it.
 */

export interface PostgrestError {
  message: string;
  details: string;
  hint: string;
  code: string;
}

export interface PostgrestResponse<T> {
  data: T | null;
  error: PostgrestError | null;
  count: number | null;
  status: number;
  statusText: string;
}

type CountOption = { count?: "exact" | "planned" | "estimated"; head?: boolean };

export interface PostgrestFilterBuilder<T> extends PromiseLike<PostgrestResponse<T>> {
  select(columns?: string, options?: CountOption): PostgrestFilterBuilder<any[]>;
  eq(column: string, value: unknown): PostgrestFilterBuilder<T>;
  neq(column: string, value: unknown): PostgrestFilterBuilder<T>;
  gt(column: string, value: unknown): PostgrestFilterBuilder<T>;
  gte(column: string, value: unknown): PostgrestFilterBuilder<T>;
  lt(column: string, value: unknown): PostgrestFilterBuilder<T>;
  lte(column: string, value: unknown): PostgrestFilterBuilder<T>;
  like(column: string, pattern: string): PostgrestFilterBuilder<T>;
  ilike(column: string, pattern: string): PostgrestFilterBuilder<T>;
  is(column: string, value: boolean | null): PostgrestFilterBuilder<T>;
  in(column: string, values: readonly unknown[]): PostgrestFilterBuilder<T>;
  contains(column: string, value: unknown): PostgrestFilterBuilder<T>;
  not(column: string, operator: string, value: unknown): PostgrestFilterBuilder<T>;
  or(filters: string, options?: { foreignTable?: string; referencedTable?: string }): PostgrestFilterBuilder<T>;
  filter(column: string, operator: string, value: unknown): PostgrestFilterBuilder<T>;
  match(query: Record<string, unknown>): PostgrestFilterBuilder<T>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string; referencedTable?: string }): PostgrestFilterBuilder<T>;
  limit(count: number, options?: { foreignTable?: string; referencedTable?: string }): PostgrestFilterBuilder<T>;
  range(from: number, to: number): PostgrestFilterBuilder<T>;
  single<R = any>(): PostgrestFilterBuilder<R>;
  maybeSingle<R = any>(): PostgrestFilterBuilder<R>;
  returns<R>(): PostgrestFilterBuilder<R>;
  abortSignal(signal: AbortSignal): PostgrestFilterBuilder<T>;
  throwOnError(): PostgrestFilterBuilder<T>;
}

export interface PostgrestQueryBuilder {
  select(columns?: string, options?: CountOption): PostgrestFilterBuilder<any[]>;
  insert(values: unknown, options?: Record<string, unknown>): PostgrestFilterBuilder<null>;
  upsert(values: unknown, options?: Record<string, unknown>): PostgrestFilterBuilder<null>;
  update(values: unknown, options?: Record<string, unknown>): PostgrestFilterBuilder<null>;
  delete(options?: Record<string, unknown>): PostgrestFilterBuilder<null>;
}

export interface User {
  id: string;
  email?: string;
  phone?: string;
  app_metadata: Record<string, any>;
  user_metadata: Record<string, any>;
  created_at: string;
  [key: string]: any;
}

export interface AuthError {
  message: string;
  status?: number;
  code?: string;
}

export type UserResponse =
  | { data: { user: User }; error: null }
  | { data: { user: null }; error: AuthError };

export type GenerateLinkResponse =
  | {
      data: {
        user: User;
        properties: { action_link: string; email_otp: string; hashed_token: string; redirect_to: string; verification_type: string };
      };
      error: null;
    }
  | { data: { user: null; properties: null }; error: AuthError };

export interface GoTrueAdminApi {
  listUsers(params?: { page?: number; perPage?: number }): Promise<
    | { data: { users: User[]; aud: string }; error: null }
    | { data: { users: [] }; error: AuthError }
  >;
  createUser(attributes: Record<string, unknown>): Promise<UserResponse>;
  generateLink(params: { type: string; email: string; [key: string]: unknown }): Promise<GenerateLinkResponse>;
}

export interface SupabaseClient<_Database = any, _SchemaName = any, _Schema = any> {
  from(relation: string): PostgrestQueryBuilder;
  rpc(fn: string, args?: Record<string, unknown>, options?: CountOption): PostgrestFilterBuilder<any>;
  readonly auth: {
    getUser(jwt?: string): Promise<UserResponse>;
    verifyOtp(params: Record<string, unknown>): Promise<{ data: { user: User | null; session: any }; error: AuthError | null }>;
    readonly admin: GoTrueAdminApi;
  };
  readonly storage: { from(bucket: string): any };
}

export function createClient<_Database = any>(
  supabaseUrl: string,
  supabaseKey: string,
  options?: Record<string, unknown>,
): SupabaseClient<_Database>;
