/**
 * Capability Catalog — edge mirror of src/academic/ai/capabilityCatalog.ts
 */

export type ModelPolicy = "never" | "optional_explain" | "required_when_budget";

export type AiRouteClass =
  | "deterministic_record"
  | "deterministic_insight"
  | "cached_explanation"
  | "eie_insight"
  | "grounded_retrieval"
  | "personalised_intelligence"
  | "content_generation"
  | "multimodal"
  | "recommendation"
  | "sensitive"
  | "unsupported";

export type AiActorRole = "student" | "teacher" | "parent" | "principal" | "admin" | "super_admin";

export interface CapabilityDefinition {
  feature_id: string;
  route_class: AiRouteClass;
  model_policy: ModelPolicy;
  allowed_roles: AiActorRole[];
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
};

export function getCapability(featureId: string): CapabilityDefinition | null {
  return CAPABILITY_CATALOG[featureId] ?? null;
}

export function isModelAllowed(cap: CapabilityDefinition): boolean {
  return cap.model_policy !== "never";
}
