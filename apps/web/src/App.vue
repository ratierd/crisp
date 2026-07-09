<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import ChatView from './components/ChatView.vue';
import SidebarPanel from './components/SidebarPanel.vue';
import TopBar from './components/TopBar.vue';
import { useAppStore } from './stores/app';

const store = useAppStore();
const root = ref<HTMLElement | null>(null);
const chatView = ref<InstanceType<typeof ChatView> | null>(null);

const running = computed(() => chatView.value?.running ?? false);

// Refresh the sidebar after an exchange — once immediately (new conversation,
// updated timestamp) and again shortly after for the async auto-title.
const onExchanged = () => {
  void store.loadConversations();
  setTimeout(() => void store.loadConversations(), 2500);
};

const onKeydown = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    store.newConversation();
  }
};

let observer: ResizeObserver | null = null;

onMounted(() => {
  store.applyTheme();
  void store.loadModels();
  void store.loadConversations();
  document.addEventListener('keydown', onKeydown);
  observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? window.innerWidth;
    store.setNarrow(width < 780);
  });
  if (root.value) observer.observe(root.value);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  observer?.disconnect();
});
</script>

<template>
  <div ref="root" class="app-root">
    <div class="app-row">
      <div
        v-if="store.narrow && store.sidebarOpen"
        class="scrim"
        @click="store.sidebarOpen = false"
      />
      <SidebarPanel v-if="store.sidebarOpen" />
      <!-- the main column is the scroll container, so the scrollbar spans the
           full viewport height; top bar and composer are sticky inside it -->
      <main class="main scroll-region">
        <TopBar :running="running" />
        <ChatView
          :key="store.activeConversationId"
          ref="chatView"
          :conversation-id="store.activeConversationId"
          @exchanged="onExchanged"
        />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-root {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  overflow: hidden;
}
.app-row {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}
.scrim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.28);
  z-index: 25;
}
.main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
