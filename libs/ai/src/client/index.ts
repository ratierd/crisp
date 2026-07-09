import type { StreamChunk } from '../core/types';

export type { StreamChunk };

/**
 * A message as the chat client holds it: AG-UI parts, plus the metadata the
 * app renders. Parts are read loosely (`type` is any string) because
 * persisted history can carry kinds the client never streams (thinking).
 */
export interface UIMessagePart {
  type: string;
  content: string;
}

export interface UIMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: UIMessagePart[];
  createdAt?: Date;
}

/** Per-run context a connection receives alongside the messages. */
export interface RunContext {
  threadId: string;
  runId?: string;
  forwardedProps?: Record<string, unknown>;
}

/**
 * The pluggable transport of the chat client: given the conversation so far,
 * produce the AG-UI event stream of one run. Crisp routes through this to
 * either the server (SSE) or the user's own Ollama daemon in-page.
 */
export interface ConnectConnectionAdapter {
  connect(
    messages: UIMessage[],
    data?: Record<string, unknown>,
    abortSignal?: AbortSignal,
    runContext?: RunContext,
  ): AsyncIterable<StreamChunk>;
}

/**
 * UI messages → AG-UI wire format: each anchor message keeps its `parts` and
 * gains a `content` string mirror (the joined text parts), which is what
 * loosely-typed servers read first (see the server's wire.ts).
 */
export const uiMessagesToWire = (messages: UIMessage[]): Array<Record<string, unknown>> =>
  messages.map((message) => {
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.content)
      .join('');
    return { ...message, content: text };
  });

const generateRunId = (): string => `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * A ConnectConnectionAdapter that POSTs an AG-UI RunAgentInput to `url` and
 * yields the SSE frames of the response. The body shape is pinned by
 * `chatRequestSchema` in @crisp/contracts.
 */
export const fetchServerSentEvents = (url: string): ConnectConnectionAdapter => ({
  async *connect(messages, data, abortSignal, runContext) {
    const body = {
      threadId: runContext?.threadId ?? `thread-${crypto.randomUUID()}`,
      runId: runContext?.runId ?? generateRunId(),
      state: {},
      tools: [],
      messages: uiMessagesToWire(messages),
      forwardedProps: { ...runContext?.forwardedProps, ...data },
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      ...(abortSignal ? { signal: abortSignal } : {}),
    });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || abortSignal?.aborted) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          yield JSON.parse(payload) as StreamChunk;
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
});

export interface ChatClientOptions {
  connection: ConnectConnectionAdapter;
  threadId?: string;
  /**
   * Read fresh on every send (callers pass a getter-backed object), so
   * per-send state like the selected model and a user-supplied API key ride along.
   */
  forwardedProps?: Record<string, unknown>;
  initialMessages?: UIMessage[];
  /** Fires once per AG-UI event, before the client applies it. */
  onChunk?: (chunk: StreamChunk) => void;
  /** Fires when the transport itself fails; in-stream RUN_ERROR does not. */
  onError?: (error: Error) => void;
  onMessagesChange?: (messages: UIMessage[]) => void;
  onLoadingChange?: (isLoading: boolean) => void;
}

/**
 * The framework-agnostic chat state machine: holds the transcript, sends the
 * conversation through the connection, and assembles the streaming assistant
 * answer from TEXT_MESSAGE_START/CONTENT events. Message arrays are replaced,
 * never mutated, so reactive wrappers can lean on reference identity.
 */
export class ChatClient {
  private messages: UIMessage[];
  private loading = false;
  private abortController: AbortController | null = null;
  private readonly threadId: string;

  constructor(private readonly options: ChatClientOptions) {
    this.messages = options.initialMessages ?? [];
    this.threadId = options.threadId ?? `thread-${crypto.randomUUID()}`;
  }

  getMessages(): UIMessage[] {
    return this.messages;
  }

  getIsLoading(): boolean {
    return this.loading;
  }

  async sendMessage(text: string): Promise<void> {
    if (this.loading || text.length === 0) return;
    this.replaceMessages([
      ...this.messages,
      {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', content: text }],
        createdAt: new Date(),
      },
    ]);
    await this.streamResponse();
  }

  /** Aborts the in-flight run, keeping whatever text already streamed in. */
  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.setLoading(false);
  }

  /**
   * Regenerate: drop everything after the last user message and re-send the
   * history ending at it. The server recognizes the already-persisted user
   * message id and replaces the superseded answer.
   */
  async reload(): Promise<void> {
    const lastUser = this.messages.findLastIndex((m) => m.role === 'user');
    if (lastUser === -1) return;
    if (this.loading) this.stop();
    this.replaceMessages(this.messages.slice(0, lastUser + 1));
    await this.streamResponse();
  }

  /** Replaces the transcript wholesale (loading a persisted conversation). */
  setMessages(messages: UIMessage[]): void {
    this.replaceMessages([...messages]);
  }

  private async streamResponse(): Promise<void> {
    this.setLoading(true);
    const abortController = new AbortController();
    this.abortController = abortController;
    // read at send time: getter-backed options serve the current value
    const forwardedProps = { ...this.options.forwardedProps };
    let assistantId: string | null = null;

    try {
      const stream = this.options.connection.connect(
        this.messages,
        forwardedProps,
        abortController.signal,
        {
          threadId: this.threadId,
          runId: generateRunId(),
          forwardedProps,
        },
      );
      for await (const chunk of stream) {
        this.options.onChunk?.(chunk);
        assistantId = this.apply(chunk, assistantId);
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      // an aborted run's teardown must not clobber a successor's state
      if (this.abortController === abortController) {
        this.abortController = null;
        this.setLoading(false);
      }
    }
  }

  /** Folds one AG-UI event into the transcript. */
  private apply(chunk: StreamChunk, assistantId: string | null): string | null {
    switch (chunk.type) {
      case 'TEXT_MESSAGE_START': {
        const id = typeof chunk.messageId === 'string' ? chunk.messageId : crypto.randomUUID();
        this.replaceMessages([
          ...this.messages,
          { id, role: 'assistant', parts: [{ type: 'text', content: '' }], createdAt: new Date() },
        ]);
        return id;
      }
      case 'TEXT_MESSAGE_CONTENT': {
        if (typeof chunk.delta !== 'string' || chunk.delta.length === 0) return assistantId;
        // robustness: a stream that skips TEXT_MESSAGE_START still renders
        if (assistantId === null) {
          const started = this.apply({ ...chunk, type: 'TEXT_MESSAGE_START' }, null);
          return this.apply(chunk, started);
        }
        this.replaceMessages(
          this.messages.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  parts: message.parts.map((part, index) =>
                    index === message.parts.length - 1 && part.type === 'text'
                      ? { ...part, content: part.content + (chunk.delta as string) }
                      : part,
                  ),
                }
              : message,
          ),
        );
        return assistantId;
      }
      default:
        return assistantId;
    }
  }

  private replaceMessages(messages: UIMessage[]): void {
    this.messages = messages;
    this.options.onMessagesChange?.(messages);
  }

  private setLoading(loading: boolean): void {
    if (this.loading === loading) return;
    this.loading = loading;
    this.options.onLoadingChange?.(loading);
  }
}
