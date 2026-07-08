<script setup lang="ts">
import { ref } from 'vue';
import type { Feedback, RunStats } from '@crisp/contracts';
import MarkdownBlocks from './MarkdownBlocks.vue';

const props = defineProps<{
  source: string;
  streaming?: boolean;
  stats?: RunStats | null;
  stoppedEarly?: boolean;
  modelName?: string | null;
  runId?: string | null;
  feedback?: Feedback | null;
}>();
const emit = defineEmits<{ regenerate: []; feedback: [score: 'up' | 'down' | null, comment?: string] }>();

const formatStats = (stats: RunStats, modelName?: string | null) => {
  const seconds = (stats.ttftMs / 1000).toFixed(1);
  const model = modelName ? ` · ${modelName}` : '';
  return `${seconds}s to first token · ${Math.round(stats.tokensPerSec)} tok/s${model}`;
};

// A vote targets one specific Run; clicking the active thumb retracts it.
// Down-votes open an optional "what went wrong" note (ADR-0005: the comment
// rides along to observability).
const noteOpen = ref(false);
const note = ref('');

const vote = (score: 'up' | 'down') => {
  if (props.feedback?.score === score) {
    noteOpen.value = false;
    emit('feedback', null);
    return;
  }
  if (score === 'down') {
    note.value = props.feedback?.comment ?? '';
    noteOpen.value = true;
  } else {
    noteOpen.value = false;
  }
  emit('feedback', score);
};

const submitNote = () => {
  const comment = note.value.trim();
  emit('feedback', 'down', comment.length > 0 ? comment : undefined);
  noteOpen.value = false;
};
</script>

<template>
  <div class="assistant">
    <MarkdownBlocks :source="source" :caret="streaming" />
    <div v-if="!streaming && (stoppedEarly || stats || runId)" class="meta" :class="{ stopped: stoppedEarly }">
      <template v-if="stoppedEarly">
        <span>▪ stopped early</span>
        <button type="button" class="regenerate" @click="$emit('regenerate')">regenerate</button>
      </template>
      <span v-else-if="stats">{{ formatStats(stats, modelName) }}</span>
      <span v-if="runId" class="votes">
        <button
          type="button"
          class="vote"
          :class="{ active: feedback?.score === 'up' }"
          :aria-pressed="feedback?.score === 'up'"
          aria-label="Good response"
          title="Good response"
          @click="vote('up')"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M5.5 7.5v6h-2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2Zm0 0 2.4-4.9a1.3 1.3 0 0 1 2.47.72l-.47 2.68h2.8a1.3 1.3 0 0 1 1.27 1.57l-.86 4.1a1.3 1.3 0 0 1-1.27 1.03H5.5"
            />
          </svg>
        </button>
        <button
          type="button"
          class="vote"
          :class="{ active: feedback?.score === 'down' }"
          :aria-pressed="feedback?.score === 'down'"
          aria-label="Poor response"
          title="Poor response"
          @click="vote('down')"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M10.5 8.5v-6h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2Zm0 0-2.4 4.9a1.3 1.3 0 0 1-2.47-.72l.47-2.68H3.3a1.3 1.3 0 0 1-1.27-1.57l.86-4.1A1.3 1.3 0 0 1 4.16 3.3h6.34"
            />
          </svg>
        </button>
      </span>
    </div>
    <form v-if="noteOpen" class="note" @submit.prevent="submitNote">
      <input
        v-model="note"
        type="text"
        placeholder="What went wrong? (optional)"
        maxlength="2000"
        @keydown.esc="noteOpen = false"
      />
      <button type="submit">save</button>
    </form>
  </div>
</template>

<style scoped>
.assistant {
  margin: 0 0 36px;
}
.meta {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--font-meta);
  font-size: 10px;
  color: var(--text-3);
  letter-spacing: 0.02em;
}
.regenerate {
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-meta);
  font-size: 10px;
  color: var(--accent);
}
.regenerate:hover {
  text-decoration: underline;
}
.votes {
  display: inline-flex;
  gap: 2px;
}
.vote {
  display: inline-flex;
  align-items: center;
  background: none;
  border: none;
  padding: 2px 4px;
  border-radius: var(--radius-s);
  color: var(--text-3);
  cursor: pointer;
}
.vote svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.vote:hover {
  color: var(--text-2);
  background: var(--accent-subtle);
}
.vote.active {
  color: var(--accent);
}
.vote.active svg {
  fill: color-mix(in oklab, var(--accent) 18%, transparent);
}
.note {
  margin-top: 8px;
  display: flex;
  gap: 8px;
  max-width: 340px;
}
.note input {
  flex: 1;
  font-family: var(--font-ui);
  font-size: var(--fs-small);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  padding: 5px 9px;
}
.note input:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.note button {
  background: none;
  border: none;
  padding: 0 2px;
  font-family: var(--font-meta);
  font-size: 10px;
  color: var(--accent);
}
.note button:hover {
  text-decoration: underline;
}
</style>
