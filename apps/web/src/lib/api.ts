import type { Conversation, ConversationWithMessages, Model } from '@crisp/contracts';

const json = async <T>(response: Response): Promise<T> => {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
};

export const getModels = async (): Promise<Model[]> =>
  (await json<{ models: Model[] }>(await fetch('/api/models'))).models;

export const listConversations = async (): Promise<Conversation[]> =>
  (await json<{ conversations: Conversation[] }>(await fetch('/api/conversations'))).conversations;

export const getConversation = async (id: string): Promise<ConversationWithMessages | null> => {
  const response = await fetch(`/api/conversations/${id}`);
  if (response.status === 404) return null;
  return json<ConversationWithMessages>(response);
};

export const deleteConversation = async (id: string): Promise<void> => {
  await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
};

export const stopRun = async (runId: string): Promise<void> => {
  await fetch(`/api/runs/${runId}/stop`, { method: 'POST' });
};

export interface ReplayEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Reads the SSE replay of a live Run (mid-stream resume). Yields AG-UI
 * events until the stream closes.
 */
export async function* replayRun(runId: string, signal?: AbortSignal): AsyncGenerator<ReplayEvent> {
  const response = await fetch(`/api/runs/${runId}/events`, { signal: signal ?? null });
  if (!response.ok || !response.body) throw new Error(`replay failed: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        yield JSON.parse(payload) as ReplayEvent;
      }
    }
  }
}
