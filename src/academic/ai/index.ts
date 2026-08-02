export {
  AiDataLayer,
  buildStudentAiSummary,
  buildClassAiSummary,
  buildSchoolAiSummary,
  buildTeacherAiSummary,
  listClassStudentSummaries,
} from "./dataLayer";

export {
  bindEnvelope,
  EnvelopeValidationError,
  type AiClientRequest,
  type AiBoundEnvelope,
  type AiGatewayResponse,
  type AiActor,
  type AiChannel,
  type AiDecisionKind,
  type AiRouteClass,
} from "./envelope";

export {
  CAPABILITY_CATALOG,
  getCapability,
  assertRegisteredCapability,
  UnknownCapabilityError,
  isModelAllowed,
  type CapabilityDefinition,
  type ModelPolicy,
} from "./capabilityCatalog";

export { planRoute, wouldCallModel, type KillSwitchState, type RoutePlan } from "./routerPolicy";

export {
  AiContextApis,
  projectAttendanceQuery,
  projectHomeworkDue,
  projectMarksSummary,
  projectTimetableToday,
  projectEieMasterySummary,
  projectParentChildSummary,
  projectPerformanceFacts,
} from "./contextApis";

export { AeSnapshotL1Cache, buildL1CacheKey, globalAeL1Cache } from "./l1Cache";

export {
  assertRoleAllowed,
  resolveStudentTarget,
  assertLinkedParentChild,
  assertStudentSelfOnly,
  AiPermissionError,
} from "./permissions";

export { mapIntentToCapability } from "./intentMapper";

export { invokeAiGateway, askAiCoach, resolveCoachCapability } from "./gatewayClient";
