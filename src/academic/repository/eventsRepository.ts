
import {
  getClient,
  schoolIdOf,
  throwIfError,
  type RepoContext,
} from "./base";



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


