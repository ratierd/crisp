<script setup lang="ts">
import { useChat } from '@crisp/ai/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { Feedback, Message, RunErrorKind, RunStats } from '@crisp/contracts';
import * as api from '../lib/api';
import { crispConnection, isByoModelId } from '../lib/byo';
import { useAppStore } from '../stores/app';
import ComposerBox from './ComposerBox.vue';
import EmptyState from './EmptyState.vue';
import ErrorCard from './ErrorCard.vue';
import MessageAssistant from './MessageAssistant.vue';
import MessageUser from './MessageUser.vue';

const props = defineProps<{ conversationId: string }>();
const emit = defineEmits<{ exchanged: [] }>();

const store = useAppStore();

interface MessageMeta {
  stats?: RunStats;
  stoppedEarly?: boolean;
  modelName?: string;
  /** The Run that produced this message — the Feedback anchor. */
  runId?: string;
  feedback?: Feedback | null;
}
const meta = reactive(new Map<string, MessageMeta>());
const errorInfo = ref<{ kind: RunErrorKind; provider: string } | null>(null);

// live run tracking (client-side view of the current Run)
const liveRunId = ref<string | null>(null);
const waiting = ref(false);
let runStartedAt = 0;
let firstTokenAt = 0;
let tokenCount = 0;
let liveMessageId: string | null = null;
let liveModelName = '';
let liveByo = false; // BYO runs execute in this page — there's no server run to stop
let stopping = false;

// mid-stream resume
const reconnecting = ref(false);
const resumeText = ref<string | null>(null);

const chat = useChat({
  // BYO models run in this page, everything else streams from the server
  connection: crispConnection(() => store.selectedModel),
  threadId: props.conversationId,
  // getter: useChat watches this and pushes updates into the client,
  // so the picker's current Model rides along on every send — with the
  // user's own key for that Model's provider when they brought one (BYOK)
  get forwardedProps() {
    const apiKey = store.userApiKeyFor(store.selectedModelId);
    return { modelId: store.selectedModelId, ...(apiKey ? { apiKey } : {}) };
  },
  onChunk(chunk) {
    const event = chunk as { type: string; [key: string]: unknown };
    switch (event.type) {
      case 'RUN_STARTED':
        liveRunId.value = typeof event.runId === 'string' ? event.runId : null;
        waiting.value = true;
        runStartedAt = performance.now();
        firstTokenAt = 0;
        tokenCount = 0;
        liveMessageId = null;
        stopping = false;
        break;
      case 'TEXT_MESSAGE_START':
        if (typeof event.messageId === 'string') liveMessageId = event.messageId;
        break;
      case 'TEXT_MESSAGE_CONTENT':
        if (firstTokenAt === 0) {
          firstTokenAt = performance.now();
          waiting.value = false;
        }
        tokenCount += 1;
        break;
      case 'RUN_FINISHED': {
        if (liveMessageId && firstTokenAt > 0) {
          const streamMs = performance.now() - firstTokenAt;
          meta.set(liveMessageId, {
            stats: {
              ttftMs: Math.round(firstTokenAt - runStartedAt),
              tokensPerSec: streamMs > 0 ? (tokenCount / streamMs) * 1000 : tokenCount,
            },
            modelName: liveModelName,
            runId: liveRunId.value ?? undefined,
          });
        }
        endRun();
        emit('exchanged');
        break;
      }
      case 'RUN_ERROR':
        errorInfo.value = {
          kind: isKind(event.code) ? event.code : 'unknown',
          provider: typeof event.provider === 'string' ? event.provider : 'the provider',
        };
        endRun();
        break;
    }
  },
  onError() {
    if (stopping || errorInfo.value) return; // local aborts surface elsewhere
    errorInfo.value = { kind: 'provider_unavailable', provider: 'the Crisp server' };
    endRun();
  },
});

const isKind = (value: unknown): value is RunErrorKind =>
  value === 'provider_unavailable' ||
  value === 'auth_failed' ||
  value === 'rate_limited' ||
  value === 'aborted' ||
  value === 'unknown';

const endRun = () => {
  liveRunId.value = null;
  waiting.value = false;
};

const running = computed(() => chat.isLoading.value || liveRunId.value !== null);

// ---- render model -------------------------------------------------------

const textOf = (message: { parts: ReadonlyArray<{ type: string; content?: unknown }> }): string =>
  message.parts
    .filter((part) => part.type === 'text' && typeof part.content === 'string')
    .map((part) => part.content as string)
    .join('');

const view = computed(() =>
  chat.messages.value
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message, index, all) => ({
      id: message.id,
      role: message.role as 'user' | 'assistant',
      text: textOf(message),
      streaming:
        message.role === 'assistant' && running.value && index === all.length - 1 && !waiting.value,
      meta: meta.get(message.id),
    })),
);

const isEmpty = computed(
  () => view.value.length === 0 && !reconnecting.value && resumeText.value === null,
);

// ---- actions -------------------------------------------------------------

const send = (text: string) => {
  if (running.value || reconnecting.value) return;
  errorInfo.value = null;
  liveModelName = store.selectedModel?.displayName ?? '';
  liveByo = isByoModelId(store.selectedModelId);
  void chat.sendMessage(text);
  scrollToBottom(true);
};

const stop = async () => {
  if (!running.value) return;
  stopping = true;
  const runId = liveRunId.value;
  const hadTokens = tokenCount > 0;
  if (runId && !liveByo) void api.stopRun(runId); // server persists the partial
  chat.stop();
  if (hadTokens && liveMessageId) {
    meta.set(liveMessageId, {
      ...meta.get(liveMessageId),
      stoppedEarly: true,
      modelName: liveModelName,
      runId: runId ?? undefined,
    });
  } else {
    errorInfo.value = { kind: 'aborted', provider: liveModelName || 'the provider' };
  }
  endRun();
};

/** Re-runs the last exchange — serves both error retry and regenerate. */
const regenerate = () => {
  errorInfo.value = null;
  liveModelName = store.selectedModel?.displayName ?? '';
  liveByo = isByoModelId(store.selectedModelId);
  void chat.reload();
};

const onFeedback = (messageId: string, score: 'up' | 'down' | null, comment?: string) => {
  const current = meta.get(messageId);
  if (!current?.runId) return;
  // optimistic: the vote paints immediately, the PUT trails behind
  meta.set(messageId, {
    ...current,
    feedback: score ? { score, ...(comment ? { comment } : {}) } : null,
  });
  void api.setFeedback(current.runId, { score, ...(comment ? { comment } : {}) });
};

// ---- initial load + resume ------------------------------------------------

const applyServerMessages = (messages: Message[]) => {
  chat.setMessages(
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts.map((part) => ({ type: part.type, content: part.content })),
      createdAt: new Date(message.createdAt),
    })),
  );
  for (const message of messages) {
    if (message.stats || message.stoppedEarly || message.runId) {
      meta.set(message.id, {
        ...(message.stats ? { stats: message.stats } : {}),
        ...(message.stoppedEarly ? { stoppedEarly: true } : {}),
        ...(message.runId ? { runId: message.runId } : {}),
        ...(message.feedback ? { feedback: message.feedback } : {}),
        modelName: modelNameFor(message.modelId),
      });
    } else if (message.modelId) {
      meta.set(message.id, { modelName: modelNameFor(message.modelId) });
    }
  }
};

const modelNameFor = (modelId?: string): string =>
  store.models.find((m) => m.id === modelId)?.displayName ?? modelId?.split('/').at(-1) ?? '';

const resumeAbort = new AbortController();

const resume = async (runId: string) => {
  reconnecting.value = true;
  scrollToBottom(true);
  try {
    for await (const event of api.replayRun(runId, resumeAbort.signal)) {
      if (event.type === 'TEXT_MESSAGE_CONTENT' && typeof event.delta === 'string') {
        resumeText.value = (resumeText.value ?? '') + event.delta;
        reconnecting.value = false;
        scrollToBottom();
      }
      if (event.type === 'RUN_ERROR') {
        errorInfo.value = {
          kind: isKind(event.code) ? event.code : 'unknown',
          provider: typeof event.provider === 'string' ? event.provider : 'the provider',
        };
      }
    }
  } catch {
    // replay stream failed — fall through to the refetch below
  }
  if (resumeAbort.signal.aborted) return;
  const refreshed = await api.getConversation(props.conversationId);
  if (refreshed) applyServerMessages(refreshed.messages);
  resumeText.value = null;
  reconnecting.value = false;
  emit('exchanged');
};

onMounted(async () => {
  // a freshly minted conversation has nothing server-side to load yet —
  // fetching it would only 404
  if (store.freshConversationIds.has(props.conversationId)) return;
  const conversation = await api.getConversation(props.conversationId);
  if (!conversation) return;
  applyServerMessages(conversation.messages);
  scrollToBottom(true);
  if (conversation.activeRunId) void resume(conversation.activeRunId);
});

// ---- global keys ----------------------------------------------------------

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && running.value) void stop();
};
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  resumeAbort.abort();
});

// ---- autoscroll -----------------------------------------------------------

const chatRoot = ref<HTMLElement | null>(null);

// the scroll container is the main column (App.vue), not the transcript
const scrollEl = (): HTMLElement | null => {
  const el = chatRoot.value?.closest('.scroll-region');
  return el instanceof HTMLElement ? el : null;
};

const scrollToBottom = (force = false) => {
  void nextTick(() => {
    const el = scrollEl();
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (force || nearBottom) el.scrollTop = el.scrollHeight;
  });
};

watch(
  () => view.value.at(-1)?.text,
  () => {
    if (running.value) scrollToBottom();
  },
);

// error cards and the waiting indicator appear below the last message
watch([errorInfo, waiting], ([error, isWaiting]) => {
  if (error || isWaiting) scrollToBottom(true);
});

const composer = ref<InstanceType<typeof ComposerBox> | null>(null);

defineExpose({ running });
</script>

<template>
  <div ref="chatRoot" class="chat">
    <div class="transcript">
      <div class="column">
        <EmptyState v-if="isEmpty" @suggest="send" />
        <template v-else>
          <template v-for="message in view" :key="message.id">
            <MessageUser v-if="message.role === 'user'" :text="message.text" />
            <MessageAssistant
              v-else
              :source="message.text"
              :streaming="message.streaming"
              :stats="message.meta?.stats ?? null"
              :stopped-early="message.meta?.stoppedEarly"
              :model-name="message.meta?.modelName"
              :run-id="message.meta?.runId"
              :feedback="message.meta?.feedback"
              @regenerate="regenerate"
              @feedback="(score, comment) => onFeedback(message.id, score, comment)"
            />
          </template>

          <div v-if="waiting" class="waiting">
            <span class="waiting-block" />
            <span class="waiting-label">
              {{ store.selectedModel?.displayName ?? 'Model' }} · waiting for first token
            </span>
          </div>

          <MessageAssistant v-if="resumeText !== null" :source="resumeText" :streaming="true" />

          <div v-if="reconnecting" class="reconnect-wrap">
            <span class="reconnect-pill">
              <span class="reconnect-dot" />
              reconnecting to run…
            </span>
          </div>

          <ErrorCard
            v-if="errorInfo"
            :kind="errorInfo.kind"
            :provider="errorInfo.provider"
            @retry="regenerate"
          />
        </template>
      </div>
    </div>

    <ComposerBox
      ref="composer"
      :running="running"
      :reconnecting="reconnecting"
      @send="send"
      @stop="stop"
    />
  </div>
</template>

<style scoped>
.chat {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
}
.transcript {
  flex: 1 0 auto;
}
.column {
  max-width: var(--measure);
  margin: 0 auto;
  padding: 10px 26px 30px;
}
.waiting {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0 8px;
}
.waiting-block {
  display: inline-block;
  width: 9px;
  height: 18px;
  background: var(--accent);
  border-radius: 2px;
  animation: crisp-pulse 1.1s ease-in-out infinite;
}
.waiting-label {
  font-family: var(--font-meta);
  font-size: 10.5px;
  color: var(--text-3);
}
.reconnect-wrap {
  display: flex;
  justify-content: center;
  margin: 16px 0;
}
.reconnect-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-meta);
  font-size: 10.5px;
  color: var(--text-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 5px 13px;
  background: var(--surface);
}
.reconnect-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: crisp-pulse 1.1s ease-in-out infinite;
}
</style>
