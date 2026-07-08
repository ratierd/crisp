<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { byoConnectCommand } from '../lib/byo';
import { useAppStore } from '../stores/app';
import ProvenanceBadge from './ProvenanceBadge.vue';

const store = useAppStore();
const open = ref(false);

const toggle = () => {
  open.value = !open.value;
  // the user may have just configured OLLAMA_ORIGINS — re-check on open
  if (open.value && !store.byoConnected) void store.loadModels();
};

const pick = (id: string, available: boolean) => {
  if (!available) return;
  store.selectModel(id);
  open.value = false;
};

const command = byoConnectCommand();
const copied = ref(false);
const copyCommand = async () => {
  await navigator.clipboard.writeText(command).catch(() => undefined);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1600);
};

const onGlobalClick = () => (open.value = false);
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') open.value = false;
};

onMounted(() => {
  document.addEventListener('click', onGlobalClick);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onGlobalClick);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="picker" @click.stop>
    <button class="trigger" type="button" @click="toggle">
      <span class="dot" />
      <span class="name">{{ store.selectedModel?.displayName ?? 'Pick a model' }}</span>
      <ProvenanceBadge v-if="store.selectedModel" :provenance="store.selectedModel.provenance" />
      <span class="chevron">▾</span>
    </button>

    <div v-if="open" class="model-popover">
      <div class="section">MODEL</div>
      <div
        v-for="model in store.models"
        :key="model.id"
        class="row"
        :class="{ disabled: !model.available }"
        @click="pick(model.id, model.available)"
      >
        <div class="row-line">
          <span class="row-name">{{ model.displayName }}</span>
          <ProvenanceBadge :provenance="model.provenance" />
          <span v-if="model.id === store.selectedModelId" class="check">✓</span>
        </div>
        <div v-if="!model.available && model.unavailableReason" class="hint">
          {{ model.unavailableReason }}
        </div>
      </div>

      <div v-if="!store.byoConnected" class="byo">
        <div class="section">YOUR OLLAMA · NOT CONNECTED</div>
        <div class="byo-hint">
          Chat with models running on this machine — allow this origin on your daemon, then reopen:
        </div>
        <button class="byo-cmd" type="button" :title="copied ? 'Copied' : 'Copy command'" @click="copyCommand">
          <code>{{ command }}</code>
          <span class="copy">{{ copied ? 'copied ✓' : 'copy' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker {
  position: static;
}
.trigger {
  display: flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  padding: 4px 7px;
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-family: var(--font-ui);
  font-size: 12.5px;
}
.trigger:hover {
  background: var(--bg-inset);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.chevron {
  font-size: 8.5px;
  color: var(--text-3);
}
.model-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: min(360px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-pop);
  padding: 6px;
  z-index: 20;
}
.section {
  padding: 6px 10px 4px;
  font-family: var(--font-meta);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--text-3);
}
.row {
  padding: 9px 10px;
  border-radius: 7px;
  cursor: pointer;
}
.row:hover {
  background: var(--bg-inset);
}
.row.disabled {
  opacity: 0.55;
  cursor: default;
}
.row-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.row-name {
  font-family: var(--font-ui);
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text);
}
.check {
  margin-left: auto;
  color: var(--accent);
  font-size: 12px;
}
.hint {
  margin-top: 3px;
  font-family: var(--font-ui);
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--text-3);
}
.byo {
  margin-top: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--border-faint);
}
.byo-hint {
  padding: 0 10px 6px;
  font-family: var(--font-ui);
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--text-3);
}
.byo-cmd {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 12px);
  margin: 0 6px 4px;
  padding: 6px 8px;
  background: var(--code-bg);
  border: 1px solid var(--border-faint);
  border-radius: var(--radius-s);
  cursor: pointer;
  text-align: left;
}
.byo-cmd code {
  flex: 1;
  font-family: var(--font-meta);
  font-size: 10px;
  color: var(--text-2);
  overflow-wrap: anywhere;
}
.byo-cmd .copy {
  font-family: var(--font-meta);
  font-size: 9.5px;
  color: var(--accent);
  white-space: nowrap;
}
.byo-cmd:hover {
  border-color: var(--border);
}
</style>
