/**
 * Capability Catalog — registered AI features and preferred routes.
 * Mirror kept in supabase/functions/_shared/capabilityCatalog.ts for the Gateway.
 */

import type { AiActorRole, AiRouteClass } from "./envelope";

export type ModelPolicy = "never" | "optional_explain" | "required_when_budget";

export interface CapabilityDefinition {
  feature_id: string;
  route_class: AiRouteClass;
  model_policy: ModelPolicy;
  allowed_roles: AiActorRole[];
  /** Target student required in target_refs (or inferred from actor). */
  requires_student_target: boolean;
  description: string;
}

export const CAPABILITY_CATALOG: Record<string, CapabilityDefinition> = {
  "student.attendance.query": {
    feature_id: "student.attendance.query",
    route_class: "deterministic_record",
    model_policy: "never",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: true,
    description: "Attendance summary for an authorised student",
  },
  "student.homework.due": {
    feature_id: "student.homework.due",
    route_class: "deterministic_record",
    model_policy: "never",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: true,
    description: "Due / pending homework for an authorised student",
  },
  "student.marks.summary": {
    feature_id: "student.marks.summary",
    route_class: "deterministic_record",
    model_policy: "never",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: true,
    description: "Published marks summary for an authorised student",
  },
  "student.timetable.today": {
    feature_id: "student.timetable.today",
    route_class: "deterministic_record",
    model_policy: "never",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: true,
    description: "Today's timetable periods for the student's class",
  },
  "student.eie.mastery_summary": {
    feature_id: "student.eie.mastery_summary",
    route_class: "eie_insight",
    model_policy: "never",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: true,
    description: "Precomputed Educational Intelligence mastery projection",
  },
  "student.performance.explain": {
    feature_id: "student.performance.explain",
    route_class: "personalised_intelligence",
    model_policy: "optional_explain",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: true,
    description: "Plain-language explanation of precomputed AE+EIE facts only",
  },
  "parent.child.summary": {
    feature_id: "parent.child.summary",
    route_class: "deterministic_insight",
    model_policy: "never",
    allowed_roles: ["parent", "principal", "admin"],
    requires_student_target: true,
    description: "Deterministic linked-child academic summary for parents",
  },
  "parent.child.narrative": {
    feature_id: "parent.child.narrative",
    route_class: "deterministic_insight",
    model_policy: "never",
    allowed_roles: ["parent", "principal", "admin"],
    requires_student_target: true,
    description: "Scheduled parent progress narrative from AE/EIE facts (no LLM)",
  },
  "student.concept.explain": {
    feature_id: "student.concept.explain",
    route_class: "cached_explanation",
    model_policy: "optional_explain",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: true,
    description: "Cache-first concept explanation grounded in AE/EIE mastery facts",
  },
  "student.recommendation.next": {
    feature_id: "student.recommendation.next",
    route_class: "recommendation",
    model_policy: "never",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: true,
    description: "Deterministic next-concept / revision package from EIE seeds",
  },
  "student.image_doubt": {
    feature_id: "student.image_doubt",
    route_class: "multimodal",
    model_policy: "optional_explain",
    allowed_roles: ["student", "teacher", "admin"],
    requires_student_target: true,
    description:
      "Image doubt via OCR/multimodal pipeline then grounded tutoring (OCR vendor deferred — clarify)",
  },
};

export function getCapability(featureId: string): CapabilityDefinition | null {
  return CAPABILITY_CATALOG[featureId] ?? null;
}

export function assertRegisteredCapability(featureId: string): CapabilityDefinition {
  const cap = getCapability(featureId);
  if (!cap) {
    throw new UnknownCapabilityError(featureId);
  }
  return cap;
}

export class UnknownCapabilityError extends Error {
  readonly feature_id: string;
  constructor(featureId: string) {
    super(`Unknown or unregistered AI capability: ${featureId}`);
    this.name = "UnknownCapabilityError";
    this.feature_id = featureId;
  }
}

export function isModelAllowed(cap: CapabilityDefinition): boolean {
  return cap.model_policy !== "never";
}
