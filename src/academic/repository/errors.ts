/** Shared repository errors for the Academic Engine. */

export class AcademicRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AcademicRepositoryError";
    this.code = code;
  }
}

export class NotFoundError extends AcademicRepositoryError {
  constructor(entity: string, id?: string) {
    super("not_found", id ? `${entity} ${id} not found` : `${entity} not found`);
    this.name = "NotFoundError";
  }
}

export class TenantViolationError extends AcademicRepositoryError {
  constructor(message = "Cross-tenant access is not allowed") {
    super("tenant_violation", message);
    this.name = "TenantViolationError";
  }
}

export class ValidationFailedError extends AcademicRepositoryError {
  readonly issues: { field: string; code: string; message: string }[];
  constructor(issues: { field: string; code: string; message: string }[]) {
    super("validation_failed", issues.map((i) => i.message).join("; ") || "Validation failed");
    this.name = "ValidationFailedError";
    this.issues = issues;
  }
}
