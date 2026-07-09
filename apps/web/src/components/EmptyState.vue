<script setup lang="ts">
import { TOUR_QUESTIONS } from '../lib/tour';

defineProps<{
  /** The Demo model is the current selection — its zero-key promise holds. */
  demoSelected: boolean;
  /** At least one Model is usable right now (demo, key, or BYO Ollama). */
  anyAvailable: boolean;
}>();
defineEmits<{ suggest: [text: string] }>();

// The Tour Questions (ADR-0009): the product guides its own evaluation. The
// Demo model answers them from a canned script; real models answer from the
// Tour Context that Tour Mode injects.
const CHIPS = TOUR_QUESTIONS;
</script>

<template>
  <div class="empty">
    <h1>Start a conversation.</h1>
    <p v-if="demoSelected">
      The Demo model answers without any API keys, so your first message always works. Switch models
      from the composer whenever you're ready.
    </p>
    <p v-else-if="!anyAvailable">
      Pick a model from the composer to start — connect OpenRouter in one click, use your own
      Ollama, or paste a provider key.
    </p>
    <div class="chips">
      <button v-for="chip in CHIPS" :key="chip" type="button" @click="$emit('suggest', chip)">
        {{ chip }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.empty {
  padding-top: 10vh;
}
h1 {
  font-family: var(--font-head);
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: -0.015em;
  margin: 0 0 12px;
  color: var(--text);
}
p {
  font-family: var(--font-prose);
  font-size: 16.5px;
  line-height: 1.65;
  color: var(--text-2);
  margin: 0 0 28px;
  max-width: 46ch;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chips button {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 999px;
  padding: 7px 15px;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--text-2);
}
.chips button:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
