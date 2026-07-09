<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useAppStore } from '../stores/app';
import ModelPicker from './ModelPicker.vue';

const store = useAppStore();

const props = defineProps<{ running: boolean; reconnecting: boolean; noModel?: boolean }>();
const emit = defineEmits<{ send: [text: string]; stop: [] }>();

const text = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);

const send = () => {
  const trimmed = text.value.trim();
  if (!trimmed || props.running || props.reconnecting || props.noModel) return;
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
          :placeholder="
            reconnecting
              ? 'Reconnecting to run…'
              : noModel
                ? 'Connect a model to start…'
                : 'Write a message…'
          "
          :disabled="reconnecting"
          @keydown="onKeydown"
        />
        <div class="bottom-row">
          <ModelPicker />
          <button
            type="button"
            class="tour"
            :class="{ on: store.tourMode }"
            :aria-pressed="store.tourMode"
            title="New conversations know how Crisp was built"
            @click="store.setTourMode(!store.tourMode)"
          >
            <span class="tour-dot" />
            Tour
          </button>
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
            :disabled="!text.trim() || reconnecting || noModel"
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
  /* transparent: the app-shell aurora paints the ground behind the glass box */
}
.composer-inner {
  max-width: var(--measure);
  margin: 0 auto;
  position: relative;
}
.box {
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  /* frosted glass: the aurora and scrolled-under transcript read through
     the blur while the text on top stays legible */
  background: color-mix(in srgb, var(--surface) 65%, transparent);
  backdrop-filter: blur(14px) saturate(1.3);
  -webkit-backdrop-filter: blur(14px) saturate(1.3);
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
  /* the picker trigger's 7px hover padding is part of the visual gap —
     3px keeps the Tour pill on the picker cluster's spacing rhythm */
  gap: 3px;
}
.spacer {
  flex: 1;
}
/* sized like ProvenanceBadge — a quiet peer of the "local" pill */
.tour {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  background: transparent;
  border-radius: 999px;
  padding: 2px 7px;
  font-family: var(--font-meta);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--text-3);
}
.tour:hover {
  border-color: var(--accent);
  color: var(--text-2);
}
.tour.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-subtle, transparent);
}
.tour-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentcolor;
  opacity: 0.35;
}
.tour.on .tour-dot {
  opacity: 1;
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
