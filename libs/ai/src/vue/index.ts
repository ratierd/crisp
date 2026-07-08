import { getCurrentScope, onScopeDispose, shallowRef } from 'vue';
import { ChatClient } from '../client/index';
import type { ConnectConnectionAdapter, StreamChunk, UIMessage } from '../client/index';
import type { Ref } from 'vue';

export type { ConnectConnectionAdapter, StreamChunk, UIMessage };

export interface UseChatOptions {
  connection: ConnectConnectionAdapter;
  threadId?: string;
  /**
   * Declare this as a getter on the options object and it is re-read on
   * every send — the current model selection (and any user-supplied API
   * key) ride along without re-creating the chat.
   */
  forwardedProps?: Record<string, unknown>;
  initialMessages?: UIMessage[];
  onChunk?: (chunk: StreamChunk) => void;
  onError?: (error: Error) => void;
}

export interface UseChatReturn {
  messages: Readonly<Ref<UIMessage[]>>;
  isLoading: Readonly<Ref<boolean>>;
  sendMessage: (text: string) => Promise<void>;
  stop: () => void;
  reload: () => Promise<void>;
  setMessages: (messages: UIMessage[]) => void;
}

/**
 * Vue binding of the ChatClient: `messages` and `isLoading` are shallow refs
 * refreshed from the client's change callbacks (the client swaps arrays
 * instead of mutating, so shallow reactivity is enough). Disposal of the
 * owning scope stops any in-flight run.
 */
export const useChat = (options: UseChatOptions): UseChatReturn => {
  const messages = shallowRef<UIMessage[]>(options.initialMessages ?? []);
  const isLoading = shallowRef(false);

  const client = new ChatClient({
    connection: options.connection,
    ...(options.threadId !== undefined ? { threadId: options.threadId } : {}),
    ...(options.initialMessages !== undefined ? { initialMessages: options.initialMessages } : {}),
    // getter chain: reading this re-reads the caller's (possibly getter-backed)
    // forwardedProps at send time
    get forwardedProps() {
      return options.forwardedProps;
    },
    onChunk: (chunk) => options.onChunk?.(chunk),
    onError: (error) => options.onError?.(error),
    onMessagesChange: (next) => {
      messages.value = next;
    },
    onLoadingChange: (loading) => {
      isLoading.value = loading;
    },
  });

  if (getCurrentScope()) onScopeDispose(() => client.stop());

  return {
    messages,
    isLoading,
    sendMessage: (text) => client.sendMessage(text),
    stop: () => client.stop(),
    reload: () => client.reload(),
    setMessages: (next) => client.setMessages(next),
  };
};
