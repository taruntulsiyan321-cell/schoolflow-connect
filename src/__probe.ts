import { runOcrPipelineStub } from "./academic/ai/multimodalPipeline";
const r = runOcrPipelineStub({} as any, { providerConfigured: false });
export const z = !r.ok && r.reason === "a";
