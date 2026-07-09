<script setup lang="ts">
import { useAppStore } from '../stores/app';

defineProps<{ running: boolean }>();

const store = useAppStore();
</script>

<template>
  <header class="topbar">
    <button
      class="ghost"
      type="button"
      aria-label="Toggle sidebar"
      @click="store.sidebarOpen = !store.sidebarOpen"
    >
      ▤
    </button>
    <template v-if="!store.sidebarOpen">
      <span class="wordmark">Crisp</span>
      <span class="separator">/</span>
    </template>
    <span class="title">{{ store.activeConversation?.title ?? 'New conversation' }}</span>
    <span class="spacer" />
    <span v-if="running" class="live">
      <span class="live-dot" />
      run live
    </span>
    <button
      class="ghost theme"
      type="button"
      aria-label="Toggle theme"
      @click="store.toggleTheme()"
    >
      {{ store.effectiveTheme === 'dark' ? '◑' : '◐' }}
    </button>
  </header>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 12;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  background: var(--bg);
}
/* content fades out as it scrolls under the bar */
.topbar::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: 14px;
  background: linear-gradient(to bottom, var(--bg), transparent);
  pointer-events: none;
}
.ghost {
  background: none;
  border: none;
  color: var(--text-3);
  font-size: 14px;
  padding: 4px 7px;
  border-radius: var(--radius-s);
}
.ghost:hover {
  color: var(--text);
  background: var(--bg-inset);
}
.theme {
  font-size: 15px;
}
.wordmark {
  font-family: var(--font-head);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.01em;
}
.separator {
  color: var(--border);
  font-size: 12px;
}
.title {
  font-size: 13px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spacer {
  flex: 1;
}
.live {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-meta);
  font-size: 10px;
  color: var(--text-3);
}
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: crisp-pulse 1.2s ease-in-out infinite;
}
</style>
