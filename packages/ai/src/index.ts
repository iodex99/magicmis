/**
 * `@magicmis/ai` public surface (SPEC §7, §14). Server and worker only.
 *
 * Only purpose-named stage functions are exported. There is deliberately no function that takes
 * a prompt, a model, an effort or a token limit; `test/surface.test.ts` enforces that. The
 * orchestrator, transport construction aside, stays internal.
 */

import "server-only";

export {
  classifySheets,
  generateCommentary,
  generateCommentaryInput,
  extractReferenceLayout,
  extractReferenceLayoutInput,
  type ExtractReferenceLayoutInput,
  type ExtractReferenceLayoutOutput,
  type GenerateCommentaryInput,
  type GenerateCommentaryOutput,
  mapColumns,
  mapLedgers,
  REPORT_TYPES,
  COLUMN_ROLES,
  classifySheetsInput,
  mapColumnsInput,
  mapLedgersInput,
  type ClassifySheetsInput,
  type ClassifySheetsOutput,
  type MapColumnsInput,
  type MapColumnsOutput,
  type MapLedgersInput,
  type MapLedgersOutput,
} from "./stages";
export {
  AiStageError,
  CostBudget,
  RuntimeCapExceeded,
  type AiContext,
  type StageResult,
} from "./orchestrator";
export { jobAiContext, runJobAiStage, syncJobAiCost, type JobStageOutcome } from "./job";
export { anthropicTransport, type AiTransport } from "./transport";
export { RoutingError, STAGES, type Stage, type Tier } from "./registry";
export {
  activatePromptVersion,
  ActivationError,
  recordEvalRun,
  type EvalRecord,
} from "./activation";
export { AiLimiter, Semaphore } from "./semaphore";
export {
  chatQuick,
  chatEditSpec,
  summariseThread,
  chatQuickInput,
  chatEditInput,
  editOperations,
  type ChatAnswerOutput,
  type ChatEditOutput,
  type ChatEditInput,
  type ChatQuickInput,
} from "./chat-stages";
export {
  chatDeepStep,
  type ChatDeepInput,
  type DeepStep,
  type StepOutcome,
} from "./chat-deep";
export { chatAiContext } from "./chat-context";
export {
  proposeDashboardLayout,
  specFromLayout,
  dashboardLayoutInput,
  type DashboardLayoutInput,
  type DashboardLayoutOutput,
} from "./dashboard-layout";
export {
  suggestBoardActions,
  checkBoardActions,
  boardActionsInput,
  boardActionsOutput,
  URGENCIES,
  type BoardActionsInput,
  type BoardActionsOutput,
} from "./board-actions";
