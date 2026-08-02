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

export { invokeAiGateway, askAiCoach, resolveCoachCapability, recordAiFeedback } from "./gatewayClient";

export {
  buildContextPack,
  packForModel,
  redactProjection,
  type ContextPack,
  type ProvenanceManifest,
} from "./contextBuilder";

export {
  validateModelResponse,
  evidenceFromExplainFacts,
  type ValidationResult,
  type EvidenceFacts,
} from "./responseValidator";

export {
  scoreConfidence,
  applyConfidencePolicy,
  type ConfidenceResult,
  type LowConfidenceAction,
} from "./confidenceEngine";

export {
  assignReasoningTier,
  getTierLimits,
  modelCallOptionsForTier,
  TIER_LIMITS,
  type ReasoningTier,
} from "./reasoningBudget";

export {
  checkBudgetReservation,
  estimateUnitsForTier,
  periodKey,
  type BudgetCheckResult,
} from "./budgetQuotas";

export {
  aggregateAiDecisions,
  fetchAiAnalyticsSummary,
  type AiAnalyticsSummary,
  type DecisionRow,
} from "./analytics";

export {
  buildParentScheduledNarrative,
  type ParentNarrative,
} from "./parentNarrative";

export {
  BUILTIN_PROMPTS,
  getBuiltinPrompt,
  loadProductionPrompt,
  loadShadowPrompt,
  renderPromptTemplate,
  resolveProductionPrompt,
  resolveShadowPrompt,
  type PromptRecord,
  type PromptStatus,
} from "./promptLibrary";

export {
  forecastBudget,
  dailyUsageFromDecisions,
  type BudgetForecast,
  type BudgetForecastInput,
  type DailyUsagePoint,
} from "./budgetForecast";

export {
  buildRecommendationPackage,
  pickNextConcept,
  type RecommendationPackage,
  type RecommendationAction,
} from "./recommendationEngine";

export {
  WORKFLOW_REGISTRY,
  getWorkflowDefinition,
  listWorkflowDefinitions,
  createWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRunState,
} from "./workflowOrchestrator";

export {
  captureFeedbackSignal,
  buildFeedbackRow,
  redactFeedbackComment,
  type FeedbackSignalInput,
  type FeedbackSignalType,
} from "./feedbackLoop";

export {
  chunkPedagogicalText,
  buildEmbeddingStub,
  isPublishedForRetrieval,
  isEmbeddingProviderConfigured,
  planEmbeddingJobAction,
  registerKmsDocument,
  submitKmsVersion,
  approveKmsVersion,
  rejectKmsVersion,
  enqueueKmsEmbeddingJobs,
  deferUnsetEmbeddings,
  processEmbeddingJobsBatch,
  completeKmsChunkEmbed,
  type KmsDocumentStatus,
  type KmsContentType,
  type KmsChunkEmbedStatus,
} from "./knowledgeManagement";

export {
  resolveEmbeddingApiKey,
  planProcessOneEmbeddingJob,
  processOneEmbeddingJob,
  parseEmbeddingApiResponse,
  buildEmbeddingRequestBody,
  type EmbeddingJobClaim,
  type EmbeddingVectorResult,
} from "./embeddingProvider";

export {
  lexicalOverlap,
  cosineSimilarity,
  isEvidenceSufficient,
  buildEvidenceCitations,
  rankApprovedChunksLocally,
  parseRetrievalRpcPayload,
  retrieveKmsChunks,
  type RetrievalPack,
  type RetrievalHit,
} from "./vectorRetrieval";

export {
  SESSION_MEMORY_CAPABILITIES,
  sessionScopeForCapability,
  isSessionMemoryAllowed,
  buildSessionSummaryPatch,
  redactSessionForContext,
  openSessionMemory,
  readSessionMemory,
  appendSessionMemory,
  closeSessionMemory,
  type SessionWorkflowScope,
  type SessionMemoryRecord,
} from "./sessionMemory";

export {
  planQuestionPaper,
  runPaperPlanDryRun,
  type QuestionPaperPlan,
  type PaperPlanInput,
} from "./questionPaperPlan";

export {
  buildQuestionPaperOutline,
  buildOutlineSectionsFromPlan,
  renderOutlinePrompt,
  type QuestionPaperOutline,
  type PaperOutlineInput,
} from "./questionPaperOutline";

export {
  buildQuestionPaperMarkingScheme,
  renderMarkingSchemePrompt,
  type QuestionPaperMarkingScheme,
  type MarkingSchemeInput,
} from "./questionPaperMarkingScheme";

export {
  buildSchoolHealthBrief,
  type SchoolHealthBrief,
  type SchoolHealthAggregateInput,
} from "./schoolHealthBrief";

export {
  validateImageMetadata,
  runOcrPipelineStub,
  runImageDoubtSubmit,
  isOcrProviderConfigured,
  type MultimodalExtractionV1,
  type OcrPipelineResult,
  type ImageDoubtSubmitResult,
} from "./multimodalPipeline";

export {
  runImageDoubtSolve,
  gateImageDoubtSolveConfidence,
  renderImageDoubtSolvePrompt,
  IMAGE_DOUBT_CONFIDENCE_THRESHOLD,
  type ImageDoubtSolveResult,
  type ImageDoubtSolveInput,
} from "./imageDoubtSolve";

export {
  validateVoiceMetadata,
  runVoiceDoubtSubmit,
  isSttProviderConfigured,
  type VoiceDoubtSubmitResult,
  type VoiceMediaMetadata,
} from "./voiceDoubtSubmit";

export {
  BUILTIN_BENCHMARK_SUITES,
  BUILTIN_BENCHMARK_FIXTURES,
  criticalSuiteIds,
  evaluateBenchmarkGate,
  evaluateFixture,
  runBuiltinBenchmarkSuites,
  fetchBenchmarkGate,
  type BenchmarkGateResult,
  type FixtureEvalResult,
} from "./benchmarkSuite";

export {
  canTransitionPromptStatus,
  assertPromotionAllowed,
  feedbackMayTriggerReevaluation,
  promotePromptVersion,
  normalizePromptEvalStatus,
  shouldUseShadowPrompt,
  parseShadowPromptFlag,
  selectPromptWithShadow,
  type PromptEvalStatus,
  type ShadowPromptFlag,
  type ResolvedPromptSelection,
} from "./promptEvaluation";

export {
  classifyProviderError,
  shouldRetryFailure,
  computeBackoffMs,
  planFailureRecovery,
  withRetry,
  DEFAULT_PROVIDER_RETRY,
  type FailureClass,
  type RecoveryPlan,
} from "./failureRecovery";
