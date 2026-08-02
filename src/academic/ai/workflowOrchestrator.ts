/**
 * AI Workflow Orchestrator — interfaces + registered pipeline definitions.
 * Full teacher paper generation is deferred; this registers the skeleton DAG only.
 */

export type WorkflowStepKind =
  | "permission_check"
  | "cache_lookup"
  | "context_assemble"
  | "router_invoke"
  | "validate"
  | "human_review"
  | "feedback_capture"
  | "ocr_extract"
  | "media_validate"
  | "stub";

export type WorkflowStepDef = {
  step_id: string;
  kind: WorkflowStepKind;
  /** Router capability when kind = router_invoke */
  feature_id?: string;
  budget_ceiling?: "simple" | "medium" | "complex" | "enterprise";
  requires_human?: boolean;
  description: string;
};

export type WorkflowDefinition = {
  workflow_id: string;
  version: string;
  capability_id: string;
  allowed_audiences: Array<"teacher" | "admin" | "principal" | "student" | "parent">;
  enabled: boolean;
  steps: WorkflowStepDef[];
  failure_policy: "safe_fail" | "retry_then_fail" | "queue_recovery";
  session_memory_scope: "workflow" | "none";
  notes?: string;
};

export type WorkflowRunState = {
  run_id: string;
  workflow_id: string;
  version: string;
  status: "registered" | "pending" | "running" | "awaiting_review" | "completed" | "failed" | "cancelled";
  current_step_id: string | null;
  checkpoints: { step_id: string; at: string; ok: boolean; detail?: string }[];
  artifacts: Record<string, unknown>;
  error_code?: string;
};

/** Canonical registered pipelines (control-plane). */
export const WORKFLOW_REGISTRY: Record<string, WorkflowDefinition> = {
  "teacher.question_paper.plan.v1": {
    workflow_id: "teacher.question_paper.plan.v1",
    version: "v1",
    capability_id: "teacher.question_paper.plan",
    allowed_audiences: ["teacher", "admin"],
    enabled: true,
    failure_policy: "safe_fail",
    session_memory_scope: "workflow",
    notes: "Dry-run planner — deterministic curriculum weights; no full paper generation.",
    steps: [
      {
        step_id: "permission_purpose",
        kind: "permission_check",
        description: "Verify teacher assignment + purpose for paper planning",
      },
      {
        step_id: "assemble_spec",
        kind: "context_assemble",
        description: "Build ContentGenerationSpecification from curriculum inputs",
      },
      {
        step_id: "compute_weights",
        kind: "stub",
        feature_id: "teacher.question_paper.plan",
        budget_ceiling: "simple",
        description: "Deterministic chapter marks + difficulty slot allocation",
      },
      {
        step_id: "emit_plan",
        kind: "router_invoke",
        feature_id: "teacher.question_paper.plan",
        budget_ceiling: "simple",
        description: "Return dry-run plan artifact (no Qwen)",
      },
      {
        step_id: "session_checkpoint",
        kind: "stub",
        description: "Store plan_hash in paper_gen session memory",
      },
    ],
  },
  "teacher.question_paper.v1": {
    workflow_id: "teacher.question_paper.v1",
    version: "v1",
    capability_id: "teacher.question_paper.generate",
    allowed_audiences: ["teacher", "admin"],
    enabled: false,
    failure_policy: "safe_fail",
    session_memory_scope: "workflow",
    notes: "Skeleton only — full generation deferred (SSOT Phase 2).",
    steps: [
      {
        step_id: "permission_purpose",
        kind: "permission_check",
        description: "Verify teacher assignment + purpose for paper generation",
      },
      {
        step_id: "artifact_cache",
        kind: "cache_lookup",
        description: "Lookup L3 artifact cache by specification hash",
      },
      {
        step_id: "assemble_spec",
        kind: "context_assemble",
        description: "Build ContentGenerationSpecification from curriculum context",
      },
      {
        step_id: "generate_draft",
        kind: "stub",
        feature_id: "teacher.question_paper.generate",
        budget_ceiling: "enterprise",
        description: "Stub — Qwen generation not activated in this slice",
      },
      {
        step_id: "validate_draft",
        kind: "validate",
        description: "Response Validator + Confidence Engine gates",
      },
      {
        step_id: "teacher_review",
        kind: "human_review",
        requires_human: true,
        description: "Teacher edit/accept/reject gate",
      },
      {
        step_id: "capture_feedback",
        kind: "feedback_capture",
        description: "Record accept/edit/reject into Feedback Loop",
      },
    ],
  },
  "student.image_doubt.v1": {
    workflow_id: "student.image_doubt.v1",
    version: "v1",
    capability_id: "student.image_doubt",
    allowed_audiences: ["student"],
    enabled: false,
    failure_policy: "safe_fail",
    session_memory_scope: "workflow",
    notes:
      "OCR / multimodal stub — clarify when provider unset; live OCR vendor deferred.",
    steps: [
      {
        step_id: "validate_media",
        kind: "media_validate",
        description: "Validate image mime/size/dimensions before OCR",
      },
      {
        step_id: "safety_screen",
        kind: "stub",
        description: "Content safety & PII screen (stub)",
      },
      {
        step_id: "ocr_extract",
        kind: "ocr_extract",
        feature_id: "student.image_doubt",
        budget_ceiling: "simple",
        description: "Vision/OCR capability via Model Router — stub clarifies if unset",
      },
      {
        step_id: "confidence_gate",
        kind: "validate",
        description: "Extraction confidence policy → clarify or continue",
      },
      {
        step_id: "router_doubt",
        kind: "router_invoke",
        feature_id: "student.concept.explain",
        budget_ceiling: "medium",
        description: "Route normalised text through standard doubt / concept path",
      },
      {
        step_id: "validate_answer",
        kind: "validate",
        description: "Response Validator + Confidence Engine on final answer",
      },
      {
        step_id: "capture_feedback",
        kind: "feedback_capture",
        description: "Record like/retry into Feedback Loop",
      },
    ],
  },
};

export function getWorkflowDefinition(workflowId: string): WorkflowDefinition | null {
  return WORKFLOW_REGISTRY[workflowId] ?? null;
}

export function listWorkflowDefinitions(): WorkflowDefinition[] {
  return Object.values(WORKFLOW_REGISTRY);
}

/**
 * Create a registered-but-not-started run. Does not execute steps.
 * Full orchestration (Router per step) lands in a later Phase 2 slice.
 */
export function createWorkflowRun(input: {
  workflow_id: string;
  run_id: string;
}): WorkflowRunState {
  const def = getWorkflowDefinition(input.workflow_id);
  if (!def) {
    return {
      run_id: input.run_id,
      workflow_id: input.workflow_id,
      version: "unknown",
      status: "failed",
      current_step_id: null,
      checkpoints: [],
      artifacts: {},
      error_code: "unknown_workflow",
    };
  }
  if (!def.enabled) {
    return {
      run_id: input.run_id,
      workflow_id: def.workflow_id,
      version: def.version,
      status: "registered",
      current_step_id: def.steps[0]?.step_id ?? null,
      checkpoints: [
        {
          step_id: "_init",
          at: new Date().toISOString(),
          ok: true,
          detail: "Workflow registered but disabled (skeleton)",
        },
      ],
      artifacts: {},
      error_code: "workflow_disabled",
    };
  }
  return {
    run_id: input.run_id,
    workflow_id: def.workflow_id,
    version: def.version,
    status: "pending",
    current_step_id: def.steps[0]?.step_id ?? null,
    checkpoints: [],
    artifacts: {},
  };
}
