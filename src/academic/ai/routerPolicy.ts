/**
 * Pure router policy — deterministic-first, model-last.
 * Used by unit tests and mirrored by the edge AI Router.
 */

import {
  assertRegisteredCapability,
  isModelAllowed,
  type CapabilityDefinition,
  UnknownCapabilityError,
} from "./capabilityCatalog";
import type { AiDecisionKind, AiRouteClass } from "./envelope";

export type KillSwitchState = {
  gatewayEnabled: boolean;
  deterministicEnabled: boolean;
  generativeEnabled: boolean;
};

export type RoutePlan = {
  feature_id: string;
  route_class: AiRouteClass;
  capability: CapabilityDefinition;
  /** Whether the model adapter may be invoked for this request */
  may_call_model: boolean;
  decision_if_ready: AiDecisionKind;
  reason: string;
};

export function planRoute(
  featureId: string,
  flags: KillSwitchState,
): RoutePlan | { rejected: true; decision: AiDecisionKind; error_code: string; message: string } {
  if (!flags.gatewayEnabled) {
    return {
      rejected: true,
      decision: "kill_switch",
      error_code: "gateway_disabled",
      message: "AI Gateway is temporarily disabled",
    };
  }

  let capability: CapabilityDefinition;
  try {
    capability = assertRegisteredCapability(featureId);
  } catch (e) {
    if (e instanceof UnknownCapabilityError) {
      return {
        rejected: true,
        decision: "rejected",
        error_code: "unknown_capability",
        message: e.message,
      };
    }
    throw e;
  }

  const wantsModel = isModelAllowed(capability);
  const isDeterministicPath =
    capability.route_class === "deterministic_record" ||
    capability.route_class === "deterministic_insight" ||
    capability.route_class === "eie_insight" ||
    capability.route_class === "recommendation" ||
    capability.route_class === "grounded_retrieval" ||
    (capability.route_class === "content_generation" && !wantsModel) ||
    (capability.route_class === "multimodal" && !wantsModel);

  if (isDeterministicPath && !flags.deterministicEnabled) {
    return {
      rejected: true,
      decision: "kill_switch",
      error_code: "deterministic_disabled",
      message: "Deterministic AI paths are temporarily disabled",
    };
  }

  // Generative kill switch: still answer with facts for optional_explain.
  if (wantsModel && !flags.generativeEnabled) {
    return {
      feature_id: featureId,
      route_class: capability.route_class,
      capability,
      may_call_model: false,
      decision_if_ready: "answered_facts_only",
      reason: "generative_kill_switch_facts_only",
    };
  }

  if (capability.route_class === "eie_insight") {
    return {
      feature_id: featureId,
      route_class: capability.route_class,
      capability,
      may_call_model: false,
      decision_if_ready: "answered_eie",
      reason: "eie_precomputed",
    };
  }

  if (capability.route_class === "grounded_retrieval") {
    return {
      feature_id: featureId,
      route_class: capability.route_class,
      capability,
      may_call_model: false,
      decision_if_ready: "answered_retrieval",
      reason: "kms_vector_retrieval",
    };
  }

  if (capability.route_class === "content_generation" && capability.model_policy === "never") {
    return {
      feature_id: featureId,
      route_class: capability.route_class,
      capability,
      may_call_model: false,
      decision_if_ready: "answered_deterministic",
      reason: "deterministic_content_plan",
    };
  }

  if (capability.route_class === "multimodal" && capability.model_policy === "never") {
    return {
      feature_id: featureId,
      route_class: capability.route_class,
      capability,
      may_call_model: false,
      decision_if_ready: "answered_deterministic",
      reason: "multimodal_pipeline_deterministic",
    };
  }

  if (
    capability.route_class === "deterministic_record" ||
    capability.route_class === "deterministic_insight"
  ) {
    return {
      feature_id: featureId,
      route_class: capability.route_class,
      capability,
      may_call_model: false,
      decision_if_ready: "answered_deterministic",
      reason: "academic_engine_deterministic",
    };
  }

  return {
    feature_id: featureId,
    route_class: capability.route_class,
    capability,
    may_call_model: wantsModel && flags.generativeEnabled,
    decision_if_ready: wantsModel ? "answered_model" : "answered_deterministic",
    reason: wantsModel ? "optional_model_explanation" : "no_model",
  };
}

/** Guard used in tests and router: attendance never triggers model. */
export function wouldCallModel(featureId: string, flags: KillSwitchState): boolean {
  const plan = planRoute(featureId, flags);
  if ("rejected" in plan && plan.rejected) return false;
  return (plan as RoutePlan).may_call_model;
}
