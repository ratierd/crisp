<script setup lang="ts">
import { ref } from 'vue';

/**
 * Discloses the Tour Context (ADR-0009): the transcript hides system
 * Messages from the flow, but what the model was told is one click away.
 */
defineProps<{ text: string }>();

const open = ref(false);
</script>

<template>
  <div class="note">
    <button type="button" :aria-expanded="open" @click="open = !open">
      <span class="dot" />
      Tour context attached — this conversation's model knows how Crisp was built
      <span class="chev">{{ open ? '▴' : '▾' }}</span>
    </button>
    <pre v-if="open">{{ text }}</pre>
  </div>
</template>

<style scoped>
.note {
  margin: 4px 0 14px;
}
.note > button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  background: var(--bg-inset);
  border-radius: 999px;
  padding: 5px 13px;
  font-family: var(--font-meta);
  font-size: 10.5px;
  color: var(--text-3);
}
.note > button:hover {
  border-color: var(--accent);
  color: var(--text-2);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.chev {
  font-size: 9px;
}
pre {
  margin: 10px 0 0;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-l, 12px);
  background: var(--surface);
  font-family: var(--font-meta);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
