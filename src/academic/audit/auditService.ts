import { getClient, schoolIdOf, throwIfError, type RepoContext, normalizePage, type PageParams } from "../repository/base";
import type { AcademicAuditEntry } from "../types";

type AuditRow = {
  id: string;
  school_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_user_id: string | null;
  actor_role: string | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function mapAudit(row: AuditRow): AcademicAuditEntry {
  return {
    id: row.id,
    schoolId: row.school_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    previousValue: row.previous_value,
    newValue: row.new_value,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

/** Read-only audit trail access (admin/principal via RLS). */
export async function listAuditForEntity(
  ctx: RepoContext,
  entityType: string,
  entityId: string,
  page?: PageParams,
): Promise<AcademicAuditEntry[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  const { data, error } = await getClient(ctx)
    .from("academic_audit")
    .select("*")
    .eq("school_id", schoolId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  throwIfError(error, "Failed to load academic audit");
  return (data ?? []).map((r) => mapAudit(r as AuditRow));
}

export async function listRecentAudit(
  ctx: RepoContext,
  page?: PageParams,
): Promise<AcademicAuditEntry[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  const { data, error } = await getClient(ctx)
    .from("academic_audit")
    .select("*")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  throwIfError(error, "Failed to load academic audit");
  return (data ?? []).map((r) => mapAudit(r as AuditRow));
}

export const AuditService = {
  listAuditForEntity,
  listRecentAudit,
};
