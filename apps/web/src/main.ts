import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
// self-hosted fonts (replaces the render-blocking Google Fonts request);
// families register as '<Name> Variable' — see the stacks in tokens.css
import '@fontsource-variable/source-serif-4/opsz.css';
import '@fontsource-variable/source-serif-4/opsz-italic.css';
import '@fontsource-variable/public-sans/index.css';
import '@fontsource-variable/public-sans/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import './styles/tokens.css';
import './styles/app.css';

createApp(App).use(createPinia()).mount('#app');
