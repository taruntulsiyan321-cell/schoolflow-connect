import {
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "./context";
import { getClient, schoolIdOf, throwIfError } from "../repository/base";
import { broadcastAcademicWrite } from "../live";

export type CalendarEventType = "holiday" | "exam" | "meeting" | "sports" | "cultural" | "deadline" | "other";
export type CalendarEventAudience = "all" | "class" | "section" | "teachers" | "parents" | "students";

export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  eventType: CalendarEventType;
  audience: CalendarEventAudience;
  classId: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
};

function mapRow(row: Record<string, unknown>): CalendarEvent {
  return {
    id: String(row.id),
    title: String(row.title),
    description: row.description != null ? String(row.description) : null,
    eventType: row.event_type as CalendarEventType,
    audience: row.audience as CalendarEventAudience,
    classId: row.class_id != null ? String(row.class_id) : null,
    startsAt: String(row.starts_at),
    endsAt: row.ends_at != null ? String(row.ends_at) : null,
    allDay: !!row.all_day,
  };
}

const MANAGE_ROLES = new Set(["admin", "principal", "teacher"]);

function assertCanManage(ctx: ServiceContext) {
  if (!MANAGE_ROLES.has(ctx.role)) {
    throw new ForbiddenError("Only admin, principal, or teacher may manage the academic calendar");
  }
}

/**
 * CalendarEventsService — school-wide academic calendar (`school_calendar_events`).
 * RLS already scopes reads to the caller's own school and writes to admin/principal/
 * teacher — these app-level checks exist for a clean error message before the DB
 * round-trip, not as the actual security boundary.
 */
export const CalendarEventsService = {
  /** Upcoming events visible to the caller: school-wide (audience in all/students) plus
   *  the caller's own class when one is provided. Past events are excluded. */
  async listUpcoming(
    ctx: ServiceContext,
    opts?: { classId?: string | null; limit?: number; fromISO?: string },
  ): Promise<CalendarEvent[]> {
    assertCanConsume(ctx, "class");
    const repo = toRepoContext(ctx);
    const schoolId = schoolIdOf(repo);
    const client = getClient(repo);
    const from = opts?.fromISO ?? new Date().toISOString();
    const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));

    let query = client
      .from("school_calendar_events")
      .select("id, title, description, event_type, audience, class_id, starts_at, ends_at, all_day")
      .eq("school_id", schoolId)
      .gte("starts_at", from)
      .order("starts_at", { ascending: true })
      .limit(limit);

    if (opts?.classId) {
      query = query.or(`audience.in.(all,students),class_id.eq.${opts.classId}`);
    } else {
      query = query.in("audience", ["all", "students"]);
    }

    const { data, error } = await query;
    throwIfError(error, "Failed to load calendar events");
    return (data ?? []).map(mapRow);
  },

  async listAll(ctx: ServiceContext, opts?: { limit?: number }): Promise<CalendarEvent[]> {
    assertCanManage(ctx);
    const repo = toRepoContext(ctx);
    const schoolId = schoolIdOf(repo);
    const client = getClient(repo);
    const { data, error } = await client
      .from("school_calendar_events")
      .select("id, title, description, event_type, audience, class_id, starts_at, ends_at, all_day")
      .eq("school_id", schoolId)
      .order("starts_at", { ascending: true })
      .limit(Math.min(200, Math.max(1, opts?.limit ?? 100)));
    throwIfError(error, "Failed to load calendar events");
    return (data ?? []).map(mapRow);
  },

  async create(
    ctx: ServiceContext,
    input: {
      title: string;
      description?: string | null;
      eventType: CalendarEventType;
      audience: CalendarEventAudience;
      classId?: string | null;
      startsAt: string;
      endsAt?: string | null;
      allDay?: boolean;
    },
  ): Promise<CalendarEvent> {
    assertCanManage(ctx);
    const repo = toRepoContext(ctx);
    const schoolId = schoolIdOf(repo);
    const client = getClient(repo);
    const { data, error } = await client
      .from("school_calendar_events")
      .insert({
        school_id: schoolId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        event_type: input.eventType,
        audience: input.audience,
        class_id: input.audience === "class" ? (input.classId ?? null) : null,
        starts_at: input.startsAt,
        ends_at: input.endsAt ?? null,
        all_day: input.allDay ?? true,
        created_by: ctx.userId,
      })
      .select("id, title, description, event_type, audience, class_id, starts_at, ends_at, all_day")
      .single();
    throwIfError(error, "Failed to create calendar event");
    // CHUNK 10.7. `.single()` types its row as nullable even though it
    // errors when there is no row — and throwIfError above has already
    // returned in that case. The guard states the invariant rather than
    // asserting it away, and turns an impossible-but-untyped null into a
    // named failure instead of a crash inside mapRow.
    if (!data) throw new Error("Calendar event was created but not returned");
    broadcastAcademicWrite(ctx.schoolId, ["calendar"], {
      classId: input.audience === "class" ? (input.classId ?? null) : null,
      source: "CalendarEventsService.create",
    });
    return mapRow(data);
  },

  async update(
    ctx: ServiceContext,
    id: string,
    patch: Partial<{
      title: string;
      description: string | null;
      eventType: CalendarEventType;
      audience: CalendarEventAudience;
      classId: string | null;
      startsAt: string;
      endsAt: string | null;
      allDay: boolean;
    }>,
  ): Promise<CalendarEvent> {
    assertCanManage(ctx);
    const repo = toRepoContext(ctx);
    const schoolId = schoolIdOf(repo);
    const client = getClient(repo);
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = patch.title.trim();
    if (patch.description !== undefined) row.description = patch.description?.trim() || null;
    if (patch.eventType !== undefined) row.event_type = patch.eventType;
    if (patch.audience !== undefined) row.audience = patch.audience;
    if (patch.classId !== undefined) row.class_id = patch.classId;
    if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
    if (patch.endsAt !== undefined) row.ends_at = patch.endsAt;
    if (patch.allDay !== undefined) row.all_day = patch.allDay;

    const { data, error } = await client
      .from("school_calendar_events")
      .update(row as never)
      .eq("id", id)
      .eq("school_id", schoolId)
      .select("id, title, description, event_type, audience, class_id, starts_at, ends_at, all_day")
      .single();
    throwIfError(error, "Failed to update calendar event");
    // See create() above — same `.single()` nullability, same guard.
    if (!data) throw new Error("Calendar event was updated but not returned");
    broadcastAcademicWrite(ctx.schoolId, ["calendar"], {
      classId: patch.classId ?? null,
      source: "CalendarEventsService.update",
    });
    return mapRow(data);
  },

  async remove(ctx: ServiceContext, id: string): Promise<void> {
    assertCanManage(ctx);
    const repo = toRepoContext(ctx);
    const schoolId = schoolIdOf(repo);
    const client = getClient(repo);
    const { error } = await client
      .from("school_calendar_events")
      .delete()
      .eq("id", id)
      .eq("school_id", schoolId);
    throwIfError(error, "Failed to delete calendar event");
    broadcastAcademicWrite(ctx.schoolId, ["calendar"], {
      source: "CalendarEventsService.remove",
    });
  },
};
