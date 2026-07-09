<script setup lang="ts">
import { computed } from 'vue';
import { injectCaret, renderMarkdown, splitBlocks } from '../lib/markdown';
import CodeBlock from './CodeBlock.vue';

const props = defineProps<{ source: string; caret?: boolean }>();

// While streaming (caret on), split at blank lines so settled blocks stay
// memoized. Once complete, re-split in 'final' mode: whole markdown spans
// render in one pass, so loose lists and reference links come out right.
const blocks = computed(() => splitBlocks(props.source, props.caret ? 'streaming' : 'final'));

const html = (text: string, isLast: boolean) => {
  const rendered = renderMarkdown(text);
  return props.caret && isLast ? injectCaret(rendered) : rendered;
};
</script>

<template>
  <div class="prose">
    <template v-for="(block, index) in blocks" :key="index">
      <CodeBlock v-if="block.type === 'code'" :code="block.code" :lang="block.lang" />
      <pre
        v-else-if="block.type === 'open-code'"
        class="open-fence">{{ block.code }}<span v-if="caret && index === blocks.length - 1" class="stream-caret" /></pre>
      <div
        v-else
        v-memo="[block.text, caret && index === blocks.length - 1]"
        v-html="html(block.text, index === blocks.length - 1)"
      />
    </template>
  </div>
</template>
