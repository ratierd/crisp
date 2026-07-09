<script setup lang="ts">
import { ref } from 'vue';
import { relativeTime } from '../lib/relative-time';
import { useAppStore } from '../stores/app';

const store = useAppStore();

// ⌘K on Apple platforms, Ctrl+K elsewhere — App.vue binds both modifiers.
const isApplePlatform = /mac|iphone|ipad|ipod/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform,
);
const shortcutLabel = isApplePlatform ? '⌘K' : 'Ctrl+K';

// drag-to-resize: the sidebar's left edge sits at x=0, so width = clientX
const resizing = ref(false);

const startResize = (event: PointerEvent) => {
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  resizing.value = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const onMove = (move: PointerEvent) => store.setSidebarWidth(move.clientX);
  const onUp = () => {
    resizing.value = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
};
</script>

<template>
  <aside
    class="sidebar"
    :class="{ overlay: store.narrow }"
    :style="store.narrow ? undefined : { width: `${store.sidebarWidth}px` }"
  >
    <div class="header">
      <span class="wordmark">Crisp</span>
      <button
        class="collapse"
        type="button"
        aria-label="Collapse sidebar"
        @click="store.sidebarOpen = false"
      >
        «
      </button>
    </div>

    <button class="new-conversation" type="button" @click="store.newConversation()">
      <span class="plus">+</span>
      New conversation
      <span class="kbd">{{ shortcutLabel }}</span>
    </button>

    <div class="list scroll-region">
      <p v-if="store.conversations.length === 0" class="empty">No conversations yet.</p>
      <!-- role=button instead of <button>: the row nests the delete button,
           and buttons cannot contain buttons -->
      <div
        v-for="conversation in store.conversations"
        :key="conversation.id"
        class="item"
        :class="{ active: conversation.id === store.activeConversationId }"
        role="button"
        tabindex="0"
        @click="store.openConversation(conversation.id)"
        @keydown.enter.prevent="store.openConversation(conversation.id)"
        @keydown.space.prevent="store.openConversation(conversation.id)"
      >
        <div class="row">
          <span v-if="conversation.id === store.activeConversationId" class="dot" />
          <span class="title">{{ conversation.title }}</span>
          <button
            class="delete"
            type="button"
            aria-label="Delete conversation"
            @click.stop="store.removeConversation(conversation.id)"
          >
            ×
          </button>
        </div>
        <div class="time">{{ relativeTime(conversation.updatedAt) }}</div>
      </div>
    </div>

    <div
      v-if="!store.narrow"
      class="resize-handle"
      :class="{ resizing }"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      @pointerdown="startResize"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  width: 264px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--bg-inset);
  border-right: 1px solid var(--border-faint);
  min-height: 0;
}
.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -4px;
  width: 8px;
  cursor: col-resize;
  z-index: 20;
  touch-action: none;
}
/* thin line over the border, quiet until you reach for it */
.resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 2px;
  background: transparent;
  transition: background 0.15s ease;
}
.resize-handle:hover::after,
.resize-handle.resizing::after {
  background: var(--accent);
}
.sidebar.overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 30;
  width: 272px;
  border-right: 1px solid var(--border);
  box-shadow: 0 0 44px rgba(0, 0, 0, 0.2);
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 8px 16px;
}
.wordmark {
  font-family: var(--font-head);
  font-weight: 600;
  font-size: 17px;
  letter-spacing: -0.01em;
}
.collapse {
  background: none;
  border: none;
  color: var(--text-3);
  font-size: 13px;
  padding: 4px 7px;
  border-radius: var(--radius-s);
}
.collapse:hover {
  color: var(--text);
  background: var(--bg);
}
.new-conversation {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 12px 10px;
  padding: 8px 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 13px;
  text-align: left;
}
.new-conversation:hover {
  border-color: var(--accent);
}
.plus {
  color: var(--accent);
  font-size: 15px;
  line-height: 1;
}
.kbd {
  margin-left: auto;
  font-family: var(--font-meta);
  font-size: 10.5px;
  color: var(--text-2);
  background: var(--bg);
  border: 1px solid var(--border);
  /* faint keycap depth without a heavy bottom edge */
  box-shadow: inset 0 -1px 0 var(--border-faint);
  border-radius: 5px;
  padding: 3px 6px;
  line-height: 1;
}
.list {
  flex: 1;
  padding: 2px 2px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.empty {
  padding: 10px 6px;
  font-size: 12px;
  color: var(--text-3);
  margin: 0;
}
.item {
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
}
.item:hover {
  background: var(--bg);
}
.item.active {
  background: var(--bg);
  border-color: var(--border-faint);
}
.row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}
.title {
  font-size: 13px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.delete {
  background: none;
  border: none;
  padding: 0 2px;
  font-family: var(--font-meta);
  font-size: 11px;
  color: var(--text-3);
  /* opacity, not visibility: keeps the button in the tab order so keyboard
     users can reach it; it reveals on row hover or any keyboard focus */
  opacity: 0;
}
.item:hover .delete,
.item:focus-within .delete,
.delete:focus-visible {
  opacity: 1;
}
.delete:hover {
  color: var(--accent);
}
.time {
  font-family: var(--font-meta);
  font-size: 9.5px;
  color: var(--text-3);
  margin-top: 3px;
}
</style>
