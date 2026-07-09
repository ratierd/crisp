<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import ChatView from './components/ChatView.vue';
import SidebarPanel from './components/SidebarPanel.vue';
import TopBar from './components/TopBar.vue';
import { completeOpenRouterConnect } from './lib/openrouter-oauth';
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
  // an OpenRouter connect redirect lands back here with ?code=… — finish it
  void completeOpenRouterConnect().then((key) => {
    if (key) store.setApiKey('openrouter', key);
  });
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
      <div class="aurora" aria-hidden="true">
        <div class="aurora-layer a1" />
        <div class="aurora-layer a2" />
        <div class="aurora-layer a3" />
      </div>
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
/* Hugo-style aurora: a full-bleed band pinned to the bottom of the shell,
   over the transcript (which melts into it) but under the sidebar and the
   glass composer. Layered gradient blobs drift at offset periods. */
.aurora {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 220px;
  overflow: hidden;
  pointer-events: none;
  z-index: 5;
  mask-image: linear-gradient(to bottom, transparent, #000 48%);

  /* aurora palette — the Hugo brand hues from tokens.css (blue 258,
     violet 300, pink 350, ember 60), quieter in light mode */
  --wave-blue: light-dark(oklch(72% 0.14 258 / 0.55), oklch(54% 0.19 258 / 0.7));
  --wave-violet: light-dark(oklch(70% 0.13 300 / 0.48), oklch(50% 0.18 300 / 0.62));
  --wave-pink: light-dark(oklch(76% 0.12 350 / 0.45), oklch(56% 0.18 350 / 0.6));
  --wave-ember: light-dark(oklch(82% 0.1 60 / 0.32), oklch(60% 0.13 60 / 0.4));
}
/* ground fade: knocks back text scrolling under the composer's bottom edge */
.aurora::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, var(--bg) 6%, transparent 42%);
}
.aurora-layer {
  position: absolute;
  /* oversized so the drift never exposes an edge */
  inset: -30% -12%;
  filter: blur(44px);
}
.aurora-layer.a1 {
  background:
    radial-gradient(48% 82% at 16% 96%, var(--wave-blue), transparent 68%),
    radial-gradient(44% 75% at 80% 100%, var(--wave-violet), transparent 70%);
  animation: wave-a 27s ease-in-out infinite alternate;
}
.aurora-layer.a2 {
  background:
    radial-gradient(44% 78% at 64% 100%, var(--wave-pink), transparent 70%),
    radial-gradient(40% 66% at 38% 100%, var(--wave-violet), transparent 72%);
  animation: wave-b 21s ease-in-out infinite alternate;
}
.aurora-layer.a3 {
  background: radial-gradient(34% 56% at 92% 98%, var(--wave-ember), transparent 74%);
  animation: wave-c 34s ease-in-out infinite alternate;
}
@keyframes wave-a {
  from {
    transform: translate3d(-4%, 2%, 0) scale(1);
  }
  to {
    transform: translate3d(5%, -3%, 0) scale(1.08);
  }
}
@keyframes wave-b {
  from {
    transform: translate3d(5%, 1%, 0) scale(1.06);
  }
  to {
    transform: translate3d(-5%, -2%, 0) scale(1);
  }
}
@keyframes wave-c {
  from {
    transform: translate3d(-2%, 0, 0) scale(1);
  }
  to {
    transform: translate3d(3%, -4%, 0) scale(1.12);
  }
}
@media (prefers-reduced-motion: reduce) {
  .aurora-layer {
    animation: none;
  }
}
</style>
