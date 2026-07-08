<script setup lang="ts">
import type { Provenance } from '@crisp/contracts';

defineProps<{ provenance: Provenance }>();
</script>

<template>
  <span class="badge">{{ provenance }}</span>
</template>

<style scoped>
.badge {
  font-family: var(--font-meta);
  font-size: 9px;
  letter-spacing: 0.06em;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-3);
}
</style>
