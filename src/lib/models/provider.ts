/**
 * ModelProvider — provider-agnostic interface every model implementation must satisfy.
 *
 * The harness, scientist agents, and ModelRouter only depend on this interface,
 * so adding a new provider (OpenAI, Vertex, local, etc.) is purely additive.
 */

export interface ModelCallContext {
  runId?: string;
  sessionId?: string | null;
  taskId?: string | null;
  agentName: string;
}

export interface GenerateTextOptions {
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  /** Cancel the in-flight model call. Hooked into AbortController in the harness. */
  signal?: AbortSignal;
}

export interface GenerateJSONOptions extends GenerateTextOptions {
  /** A JSON-mode hint. The provider should bias toward returning a single JSON object. */
  jsonOnly?: boolean;
}

export interface GenerateTextResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  model: string;
  provider: string;
  stopReason?: string;
}

export interface HealthCheckResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  generateText(opts: GenerateTextOptions, ctx?: ModelCallContext): Promise<GenerateTextResult>;
  generateJSON(opts: GenerateJSONOptions, ctx?: ModelCallContext): Promise<GenerateTextResult>;
  streamText?(
    opts: GenerateTextOptions,
    onChunk: (delta: string) => void,
    ctx?: ModelCallContext,
  ): Promise<GenerateTextResult>;
  healthCheck(): Promise<HealthCheckResult>;
  estimateCostUsd?(promptTokens: number, completionTokens: number): number;
}

export type ModelPurpose =
  | "supervisorPlanning"
  | "literatureSynthesis"
  | "hypothesisGeneration"
  | "hypothesisCritique"
  | "claimVerification"
  | "debateJudge"
  | "hypothesisEvolution"
  | "completionAssessment"
  | "finalReport";
