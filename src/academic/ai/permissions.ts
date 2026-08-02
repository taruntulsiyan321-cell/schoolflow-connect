/**
 * AI permission checks — pure helpers for Gateway / Context APIs.
 * Runtime DB verification still happens in services / edge; these encode the rules.
 */

import type { AiActor, AiActorRole } from "./envelope";
import type { CapabilityDefinition } from "./capabilityCatalog";

export class AiPermissionError extends Error {
  readonly code = "permission_denied";
  constructor(message: string) {
    super(message);
    this.name = "AiPermissionError";
  }
}

export function assertRoleAllowed(cap: CapabilityDefinition, role: AiActorRole): void {
  if (!cap.allowed_roles.includes(role)) {
    throw new AiPermissionError(`Role '${role}' cannot use ${cap.feature_id}`);
  }
}

/**
 * Resolve the student target for a request.
 * Students default to self; parents/teachers must supply target_refs.studentId.
 */
export function resolveStudentTarget(
  actor: AiActor,
  targetStudentId?: string | null,
): string {
  if (actor.role === "student") {
    const selfId = actor.studentId;
    if (!selfId) {
      throw new AiPermissionError("Student identity not bound to session");
    }
    if (targetStudentId && targetStudentId !== selfId) {
      throw new AiPermissionError("Students may only query their own academic data");
    }
    return selfId;
  }

  if (!targetStudentId) {
    throw new AiPermissionError("target_refs.studentId is required for this capability");
  }
  return targetStudentId;
}

/** Pure relationship check inputs (DB-verified IDs already resolved). */
export function assertLinkedParentChild(
  actor: AiActor,
  childStudentId: string,
  linkedChildIds: string[],
): void {
  if (actor.role !== "parent") return;
  if (!linkedChildIds.includes(childStudentId)) {
    throw new AiPermissionError("Parents may only view their linked children");
  }
}

export function assertStudentSelfOnly(actor: AiActor, studentId: string): void {
  if (actor.role === "student" && actor.studentId && actor.studentId !== studentId) {
    throw new AiPermissionError("Students may only view their own academic data");
  }
}
