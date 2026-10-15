import { mountFieldNotes } from 'field-notes';
import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');

// The widget adds its own <field-notes> element to <body>, outside the Vue
// app, so Vue needs no `isCustomElement` for it.
if (import.meta.env.DEV) {
  // Local mode: notes go to the Vite plugin, and on into .field-notes/.
  mountFieldNotes();
} else if (import.meta.env.MODE === 'export') {
  // Export mode, for a demo or staging build: off until ?field-notes=1, and
  // notes stay in the browser until exported. Any other production build
  // leaves the widget out entirely.
  mountFieldNotes({ mode: 'export', enabled: 'query' });
}
