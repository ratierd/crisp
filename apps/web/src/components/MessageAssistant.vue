<script setup lang="ts">
import type { RunStats } from '@crisp/contracts';
import MarkdownBlocks from './MarkdownBlocks.vue';

defineProps<{
  source: string;
  streaming?: boolean;
  stats?: RunStats | null;
  stoppedEarly?: boolean;
  modelName?: string | null;
}>();
defineEmits<{ regenerate: [] }>();

const formatStats = (stats: RunStats, modelName?: string | null) => {
  const seconds = (stats.ttftMs / 1000).toFixed(1);
  const model = modelName ? ` · ${modelName}` : '';
  return `${seconds}s to first token · ${Math.round(stats.tokensPerSec)} tok/s${model}`;
};
</script>

<template>
  <div class="assistant">
    <MarkdownBlocks :source="source" :caret="streaming" />
    <div v-if="stoppedEarly && !streaming" class="meta stopped">
      <span>▪ stopped early</span>
      <button type="button" class="regenerate" @click="$emit('regenerate')">regenerate</button>
    </div>
    <div v-else-if="stats && !streaming" class="meta">
      {{ formatStats(stats, modelName) }}
    </div>
  </div>
</template>

<style scoped>
.assistant {
  margin: 0 0 36px;
}
.meta {
  margin-top: 10px;
  font-family: var(--font-meta);
  font-size: 10px;
  color: var(--text-3);
  letter-spacing: 0.02em;
}
.stopped {
  display: flex;
  align-items: center;
  gap: 12px;
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
</style>
