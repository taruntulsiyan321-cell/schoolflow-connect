import type { AcademicEventRecord, AcademicEventStatus } from "../events";
import {
  getClient,
  schoolIdOf,
  throwIfError,
  type RepoContext,
  type PageParams,
  normalizePage,
} from "./base";

type EventRow = {
  id: string;
  school_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  student_id: string | null;
  class_id: string | null;
  teacher_id: string | null;
  payload: Record<string, unknown> | null;
  status: AcademicEventStatus;
  error: string | null;
  created_at: string;
  processed_at: string | null;
};

function mapEvent(row: EventRow): AcademicEventRecord {
  return {
    id: row.id,
    schoolId: row.school_id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorUserId: row.actor_user_id,
    studentId: row.student_id,
    classId: row.class_id,
    teacherId: row.teacher_id,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

/** Emit via SECURITY DEFINER RPC — preferred over direct table insert. */
export async function emitEvent(
  ctx: RepoContext,
  input: {
    eventType: string;
    entityType: string;
    entityId?: string | null;
    studentId?: string | null;
    classId?: string | null;
    teacherId?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<string> {
  const schoolId = schoolIdOf(ctx);
  // CHUNK 10.7. These four were `?? null`, and the generated Args type rejects
  // null. That type is LOSSY, not right: Postgres declares them
  //
  //   _entity_id uuid DEFAULT NULL, _student_id uuid DEFAULT NULL,
  //   _class_id  uuid DEFAULT NULL, _teacher_id uuid DEFAULT NULL
  //
  // and the generator renders a DEFAULT NULL parameter as `_entity_id?: string`
  // — optional, but not nullable. It cannot express "may be omitted AND accepts
  // null", so it drops the half that matters here.
  //
  // Omitted rather than coerced. For a DEFAULT NULL parameter, not sending the
  // key and sending null are the same thing: PostgREST leaves it out, Postgres
  // applies the default, the column gets NULL. The guard is the narrowing —
  // the absent case is handled explicitly instead of asserted away.
  //
  // THIS IS NOT A GENERAL SUBSTITUTION. `_payload` below is
  // `jsonb DEFAULT '{}'`, so omitting it yields {} and NOT null; the same trick
  // on a parameter whose default is 0, false or 'practice' would silently
  // change the value written. Safe here only because all four defaults were
  // read off pg_get_function_arguments and all four are NULL.
  const { data, error } = await getClient(ctx).rpc("emit_academic_event", {
    _event_type: input.eventType,
    _entity_type: input.entityType,
    _school_id: schoolId,
    ...(input.entityId != null ? { _entity_id: input.entityId } : {}),
    ...(input.studentId != null ? { _student_id: input.studentId } : {}),
    ...(input.classId != null ? { _class_id: input.classId } : {}),
    ...(input.teacherId != null ? { _teacher_id: input.teacherId } : {}),
    _payload: (input.payload ?? {}) as never,
  });

  throwIfError(error, "Failed to emit academic event");
  return data as string;
}

/** Best-effort emit — never blocks the write path; logs failures for integrity audits. */
export async function emitEventBestEffort(
  ctx: RepoContext,
  input: Parameters<typeof emitEvent>[1],
): Promise<string | null> {
  try {
    return await emitEvent(ctx, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[academic] emit ${input.eventType} failed:`, msg);
    return null;
  }
}

export async function listPendingEvents(
  ctx: RepoContext,
  page?: PageParams,
): Promise<AcademicEventRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  const { data, error } = await getClient(ctx)
    .from("academic_events")
    .select("*")
    .eq("school_id", schoolId)
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  throwIfError(error, "Failed to list pending events");
  return (data ?? []).map((r) => mapEvent(r as EventRow));
}

export async function writeAudit(
  ctx: RepoContext,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    previous?: Record<string, unknown> | null;
    next?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx).rpc("write_academic_audit", {
    _entity_type: input.entityType,
    _entity_id: input.entityId,
    _action: input.action,
    _previous: (input.previous ?? null) as never,
    _new: (input.next ?? null) as never,
    _school_id: schoolId,
    _metadata: (input.metadata ?? {}) as never,
  });

  throwIfError(error, "Failed to write academic audit");
  return data as string;
}
