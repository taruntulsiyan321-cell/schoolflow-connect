/**
 * Shared repository errors for the Academic Engine.
 *
 * NotFoundError, TenantViolationError and ValidationFailedError were thrown
 * only by the school repositories, which went with the organisation side to
 * the `organisation` branch (2026-10-01).
 */

export class AcademicRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AcademicRepositoryError";
    this.code = code;
  }
}
