<script setup lang="ts">
defineProps<{ text: string }>();
</script>

<template>
  <div class="user-message">{{ text }}</div>
</template>

<style scoped>
.user-message {
  margin: 30px 0 24px;
  padding: 12px 16px;
  background: var(--bg-inset);
  border-radius: var(--radius-m);
  font-family: var(--font-ui);
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--text);
  white-space: pre-wrap;
  max-width: 56ch;
}
</style>
