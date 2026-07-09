import { RunTree } from 'langsmith/run_trees';
import type { Client } from 'langsmith';
import type { Model } from '@crisp/models/contracts';
import type { GatewayMessage } from '@crisp/runs/contracts';

/** Token usage as @crisp/ai reports it on RUN_FINISHED. */
export interface TraceUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface OpenTraceInput {
  client: Client;
  projectName?: string;
  model: Model;
  runId: string;
  threadId: string;
  messages: GatewayMessage[];
  /** For post-hoc traces (BYO): when the run actually started. */
  startTime?: number;
}

/**
 * The one trace shape every Crisp Run gets (ADR-0005): a flat `llm` run whose
 * LangSmith id IS the Run's id, with the Conversation id as `thread_id`
 * metadata so LangSmith's Threads view groups a Conversation.
 */
export const openTrace = ({
  client,
  projectName,
  model,
  runId,
  threadId,
  messages,
  startTime,
}: OpenTraceInput): RunTree => {
  const [provider = 'unknown', ...rest] = model.id.split('/');
  return new RunTree({
    name: model.id,
    id: runId,
    run_type: 'llm',
    inputs: { messages },
    metadata: {
      thread_id: threadId,
      ls_provider: provider,
      ls_model_name: rest.join('/'),
      provenance: model.provenance,
    },
    client,
    ...(projectName ? { project_name: projectName } : {}),
    ...(startTime ? { start_time: startTime } : {}),
  });
};

/** Outputs payload: the assistant text plus usage in LangSmith's cost-tracking shape. */
export const traceOutputs = (text: string, usage?: TraceUsage) => ({
  message: { role: 'assistant', content: text },
  ...(usage
    ? {
        usage_metadata: {
          input_tokens: usage.promptTokens ?? 0,
          output_tokens: usage.completionTokens ?? 0,
          total_tokens:
            usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
        },
      }
    : {}),
});
