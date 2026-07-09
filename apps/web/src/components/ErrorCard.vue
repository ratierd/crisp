<script setup lang="ts">
import { computed } from 'vue';
import type { RunErrorKind } from '@crisp/contracts';

const props = defineProps<{ kind: RunErrorKind; provider: string }>();
defineEmits<{ retry: [] }>();

const CATALOG: Record<RunErrorKind, { glyph: string; title: string; body: (p: string) => string }> =
  {
    provider_unavailable: {
      glyph: '⊘',
      title: 'Provider unreachable',
      body: (p) => `Crisp couldn't reach ${p}. Check that it's running and reachable, then retry.`,
    },
    auth_failed: {
      glyph: '✕',
      title: 'Authentication failed',
      body: (p) =>
        `${p} rejected the request — the API key looks missing or invalid. Fix the key, then retry.`,
    },
    rate_limited: {
      glyph: '◔',
      title: 'Rate limited',
      body: (p) => `${p} asked us to slow down. Give it a few seconds, then retry.`,
    },
    aborted: {
      glyph: '▪',
      title: 'Run stopped',
      body: () => 'The run was stopped before the first token arrived. Nothing was written.',
    },
    unknown: {
      glyph: '?',
      title: 'Something went wrong',
      body: () => 'An unexpected error ended this run. Retrying usually works.',
    },
  };

const entry = computed(() => CATALOG[props.kind]);
</script>

<template>
  <div class="error-card">
    <div class="glyph">{{ entry.glyph }}</div>
    <div>
      <div class="title-row">
        <span class="title">{{ entry.title }}</span>
        <span class="kind">{{ kind }}</span>
      </div>
      <p class="body">{{ entry.body(provider) }}</p>
      <button v-if="kind !== 'aborted'" class="retry" type="button" @click="$emit('retry')">
        Retry
      </button>
    </div>
  </div>
</template>

<style scoped>
.error-card {
  margin: 8px 0 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  background: var(--surface);
  padding: 14px 16px;
  display: flex;
  gap: 13px;
  align-items: flex-start;
  max-width: 52ch;
  font-family: var(--font-ui);
}
.glyph {
  flex: none;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--text-2);
}
.title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.title {
  font-weight: 600;
  font-size: 13.5px;
}
.kind {
  font-family: var(--font-meta);
  font-size: 9.5px;
  color: var(--text-3);
}
.body {
  margin: 4px 0 11px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-2);
}
.retry {
  background: none;
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: var(--radius-s);
  padding: 5px 13px;
  font-family: var(--font-ui);
  font-size: 12.5px;
  font-weight: 500;
}
.retry:hover {
  background: var(--accent-subtle);
}
</style>
