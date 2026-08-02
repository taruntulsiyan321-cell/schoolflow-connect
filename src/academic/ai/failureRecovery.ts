/**
 * Enterprise Failure Recovery — retry / fallback helpers (SSOT §18).
 * Shared by Model Router; never invents academic facts on failure.
 */

export type FailureClass =
  | "client_validation"
  | "auth"
  | "source_unavailable"
  | "cache_retrieval"
  | "provider_transient"
  | "provider_permanent"
  | "validation_confidence"
  | "budget"
  | "workflow_step"
  | "unknown";

export type RecoveryStage =
  | "retry"
  | "fallback"
  | "queue"
  | "recover"
  | "replay"
  | "audit"
  | "notify"
  | "safe_fail";

export type RetryPolicy = {
  max_attempts: number;
  base_delay_ms: number;
  max_delay_ms: number;
  jitter_ratio: number;
};

export const DEFAULT_PROVIDER_RETRY: RetryPolicy = {
  max_attempts: 3,
  base_delay_ms: 200,
  max_delay_ms: 4000,
  jitter_ratio: 0.25,
};

export function classifyProviderError(err: unknown): FailureClass {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!msg) return "unknown";
  if (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("econnreset") ||
    msg.includes("network") ||
    msg.includes("fetch failed")
  ) {
    return "provider_transient";
  }
  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("invalid api") ||
    msg.includes("unsupported model") ||
    msg.includes("not configured")
  ) {
    return "provider_permanent";
  }
  if (msg.includes("budget") || msg.includes("quota")) return "budget";
  return "unknown";
}

export function shouldRetryFailure(
  failureClass: FailureClass,
  attempt: number,
  policy: RetryPolicy = DEFAULT_PROVIDER_RETRY,
): boolean {
  if (attempt >= policy.max_attempts) return false;
  return failureClass === "provider_transient" || failureClass === "unknown";
}

/** Exponential backoff with jitter; deterministic when Math.random stubbed in tests. */
export function computeBackoffMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_PROVIDER_RETRY,
  random: () => number = Math.random,
): number {
  const exp = Math.min(
    policy.max_delay_ms,
    policy.base_delay_ms * Math.pow(2, Math.max(0, attempt - 1)),
  );
  const jitter = exp * policy.jitter_ratio * random();
  return Math.round(exp + jitter);
}

export type RecoveryPlan = {
  failure_class: FailureClass;
  next_stage: RecoveryStage;
  retryable: boolean;
  attempt: number;
  delay_ms: number;
  user_message: string;
};

export function planFailureRecovery(input: {
  error: unknown;
  attempt: number;
  policy?: RetryPolicy;
  has_approved_fallback?: boolean;
  queue_eligible?: boolean;
}): RecoveryPlan {
  const failure_class = classifyProviderError(input.error);
  const policy = input.policy ?? DEFAULT_PROVIDER_RETRY;
  const retryable = shouldRetryFailure(failure_class, input.attempt, policy);

  if (retryable) {
    return {
      failure_class,
      next_stage: "retry",
      retryable: true,
      attempt: input.attempt,
      delay_ms: computeBackoffMs(input.attempt, policy),
      user_message: "Temporary AI provider issue — retrying…",
    };
  }

  if (input.has_approved_fallback && failure_class === "provider_transient") {
    return {
      failure_class,
      next_stage: "fallback",
      retryable: false,
      attempt: input.attempt,
      delay_ms: 0,
      user_message: "Switching to an approved fallback model…",
    };
  }

  if (input.queue_eligible) {
    return {
      failure_class,
      next_stage: "queue",
      retryable: false,
      attempt: input.attempt,
      delay_ms: 0,
      user_message: "We queued this request and will notify you when it is ready.",
    };
  }

  return {
    failure_class,
    next_stage: "safe_fail",
    retryable: false,
    attempt: input.attempt,
    delay_ms: 0,
    user_message:
      "AI generation is temporarily unavailable. Showing school records only — no guessed numbers.",
  };
}

export type WithRetryResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: unknown; attempts: number; plan: RecoveryPlan };

/**
 * Idempotent retry wrapper. Sleep is injectable for tests.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: {
    policy?: RetryPolicy;
    isSuccess?: (value: T) => boolean;
    mapError?: (value: T) => unknown;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    has_approved_fallback?: boolean;
    queue_eligible?: boolean;
  },
): Promise<WithRetryResult<T>> {
  const policy = opts?.policy ?? DEFAULT_PROVIDER_RETRY;
  const sleep =
    opts?.sleep ??
    ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastError: unknown = "unknown";
  let lastValue: T | undefined;

  for (let attempt = 1; attempt <= policy.max_attempts; attempt++) {
    try {
      const value = await fn(attempt);
      lastValue = value;
      if (opts?.isSuccess ? opts.isSuccess(value) : true) {
        return { ok: true, value, attempts: attempt };
      }
      lastError = opts?.mapError ? opts.mapError(value) : value;
    } catch (e) {
      lastError = e;
    }

    const plan = planFailureRecovery({
      error: lastError,
      attempt,
      policy,
      has_approved_fallback: opts?.has_approved_fallback,
      queue_eligible: opts?.queue_eligible,
    });

    if (!plan.retryable || attempt >= policy.max_attempts) {
      return { ok: false, error: lastError, attempts: attempt, plan };
    }
    const delay = computeBackoffMs(attempt, policy, opts?.random ?? Math.random);
    if (delay > 0) await sleep(delay);
  }

  const plan = planFailureRecovery({
    error: lastError,
    attempt: policy.max_attempts,
    policy,
    has_approved_fallback: opts?.has_approved_fallback,
    queue_eligible: opts?.queue_eligible,
  });
  return {
    ok: false,
    error: lastError,
    attempts: policy.max_attempts,
    plan,
    ...(lastValue !== undefined ? {} : {}),
  };
}
