<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { highlightCode } from '../lib/highlight';

const props = defineProps<{ code: string; lang: string }>();

const html = ref<string | null>(null);
const copied = ref(false);

watchEffect(async () => {
  const { code, lang } = props;
  try {
    html.value = await highlightCode(code, lang);
  } catch {
    html.value = null; // unknown language → plain fallback below
  }
});

const copy = async () => {
  await navigator.clipboard.writeText(props.code);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1400);
};
</script>

<template>
  <div class="code-block">
    <div class="code-block-header">
      <span class="code-block-lang">{{ lang || 'text' }}</span>
      <button class="code-block-copy" type="button" @click="copy">
        {{ copied ? 'copied ✓' : 'copy' }}
      </button>
    </div>
    <div v-if="html" v-html="html" />
    <pre v-else><code>{{ code }}</code></pre>
  </div>
</template>
