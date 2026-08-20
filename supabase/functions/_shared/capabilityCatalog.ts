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

/** Valid AI actor roles only — never super_admin. */
export type AiActorRole = "student" | "teacher" | "parent" | "principal" | "admin";

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
  "student.calendar.upcoming": {
    feature_id: "student.calendar.upcoming",
    route_class: "deterministic_record",
    model_policy: "never",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: true,
    description: "Upcoming school-wide and class academic-calendar events (holidays, exams, meetings, sports, cultural, deadlines)",
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
    description:
      "Cache-first concept explanation; retrieve-before-model from KMS-approved chunks when present, else AE/EIE",
  },
  "student.knowledge.retrieve": {
    feature_id: "student.knowledge.retrieve",
    route_class: "grounded_retrieval",
    model_policy: "never",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: false,
    description:
      "Vector/lexical retrieval over KMS-published chunks only (approved docs); no model call",
  },
  "student.recommendation.next": {
    feature_id: "student.recommendation.next",
    route_class: "recommendation",
    model_policy: "never",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: true,
    description: "Deterministic next-concept / revision package from EIE seeds",
  },
  "student.nova.chat": {
    feature_id: "student.nova.chat",
    route_class: "personalised_intelligence",
    model_policy: "required_when_budget",
    allowed_roles: ["student", "parent", "teacher", "principal", "admin"],
    requires_student_target: true,
    description:
      "Nova free-form academic chat via Gateway → Model Router (Qwen); no invented school metrics",
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
  "student.image_doubt.submit": {
    feature_id: "student.image_doubt.submit",
    route_class: "multimodal",
    model_policy: "never",
    allowed_roles: ["student", "teacher", "admin"],
    requires_student_target: true,
    description:
      "Submit image doubt media; run validate→safety→OCR until clarify/OCR-missing — never invent problem text",
  },
  "student.image_doubt.solve": {
    feature_id: "student.image_doubt.solve",
    route_class: "multimodal",
    model_policy: "optional_explain",
    allowed_roles: ["student", "teacher", "admin"],
    requires_student_target: true,
    description:
      "Gated post-OCR tutoring: requires reconstructed_question + extraction_confidence; cache→KMS→model with Validator/Confidence",
  },
  "student.voice_doubt.submit": {
    feature_id: "student.voice_doubt.submit",
    route_class: "multimodal",
    model_policy: "never",
    allowed_roles: ["student", "teacher", "admin"],
    requires_student_target: true,
    description:
      "Submit voice doubt audio; run validate→safety→STT until clarify/STT-missing — never invent transcript",
  },
  "teacher.question_paper.plan": {
    feature_id: "teacher.question_paper.plan",
    route_class: "content_generation",
    model_policy: "never",
    allowed_roles: ["teacher", "admin"],
    requires_student_target: false,
    description:
      "Dry-run question-paper plan with deterministic curriculum weights — does not generate full paper",
  },
  "teacher.question_paper.generate_outline": {
    feature_id: "teacher.question_paper.generate_outline",
    route_class: "content_generation",
    model_policy: "required_when_budget",
    allowed_roles: ["teacher", "admin"],
    requires_student_target: false,
    description:
      "Step-1 paper outline from plan + Context Builder + Prompt Library + Qwen + Validator (no marking scheme)",
  },
  "teacher.question_paper.marking_scheme": {
    feature_id: "teacher.question_paper.marking_scheme",
    route_class: "content_generation",
    model_policy: "required_when_budget",
    allowed_roles: ["teacher", "admin"],
    requires_student_target: false,
    description:
      "Step-2 marking scheme after outline exists in session memory; Qwen + Validator; kill-switch safe",
  },
  "principal.school.health_brief": {
    feature_id: "principal.school.health_brief",
    route_class: "deterministic_insight",
    model_policy: "never",
    allowed_roles: ["principal", "admin"],
    requires_student_target: false,
    description:
      "Deterministic school academic health brief from AE/EIE aggregates (honest empty when missing)",
  },
};

export function getCapability(featureId: string): CapabilityDefinition | null {
  return CAPABILITY_CATALOG[featureId] ?? null;
}

export function isModelAllowed(cap: CapabilityDefinition): boolean {
  return cap.model_policy !== "never";
}
