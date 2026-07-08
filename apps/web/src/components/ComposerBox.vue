<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import ModelPicker from './ModelPicker.vue';

const props = defineProps<{ running: boolean; reconnecting: boolean }>();
const emit = defineEmits<{ send: [text: string]; stop: [] }>();

const text = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);

const send = () => {
  const trimmed = text.value.trim();
  if (!trimmed || props.running || props.reconnecting) return;
  emit('send', trimmed);
  text.value = '';
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    send();
  }
};

const focus = () => textarea.value?.focus();
onMounted(focus);
watch(
  () => props.reconnecting,
  (now, before) => {
    if (before && !now) focus();
  },
);
defineExpose({ focus });
</script>

<template>
  <footer class="composer-outer">
    <div class="composer-inner">
      <div class="box">
        <textarea
          ref="textarea"
          v-model="text"
          rows="1"
          :placeholder="reconnecting ? 'Reconnecting to run…' : 'Write a message…'"
          :disabled="reconnecting"
          @keydown="onKeydown"
        />
        <div class="bottom-row">
          <ModelPicker />
          <div class="spacer" />
          <button v-if="running" class="stop" type="button" @click="$emit('stop')">
            <span class="stop-square" />
            Stop
            <span class="esc-hint">esc</span>
          </button>
          <button
            v-else
            class="send"
            type="button"
            :disabled="!text.trim() || reconnecting"
            aria-label="Send"
            @click="send"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.composer-outer {
  position: sticky;
  bottom: 0;
  z-index: 12;
  flex: none;
  padding: 0 26px 14px;
  background: var(--bg);
}
/* content fades out as it scrolls under the composer */
.composer-outer::before {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  height: 18px;
  background: linear-gradient(to bottom, transparent, var(--bg));
  pointer-events: none;
}
.composer-inner {
  max-width: var(--measure);
  margin: 0 auto;
  position: relative;
}
.box {
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  background: var(--surface);
  padding: 10px 12px 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
textarea {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  font-family: var(--font-ui);
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--text);
  field-sizing: content;
  min-height: 23px;
  max-height: 180px;
  padding: 2px 2px 6px;
  display: block;
}
.bottom-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.spacer {
  flex: 1;
}
.send {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: none;
  font-size: 16px;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: var(--accent-ink);
}
.send:disabled {
  background: var(--bg-inset);
  color: var(--text-3);
}
.stop {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  background: var(--bg-inset);
  border-radius: 8px;
  padding: 6px 13px;
  font-family: var(--font-ui);
  font-size: 12.5px;
  color: var(--text);
}
.stop:hover {
  border-color: var(--accent);
}
.stop-square {
  width: 9px;
  height: 9px;
  background: var(--text);
  border-radius: 2px;
}
.esc-hint {
  font-family: var(--font-meta);
  font-size: 9px;
  color: var(--text-3);
}
</style>
