import vue from '@vitejs/plugin-vue';
import { fieldNotes } from 'field-notes/vite';
import { defineConfig } from 'vite';

// `vite` takes notes into .field-notes/ through the plugin (local mode).
// `vite build --mode export` builds the static demo: the widget keeps notes
// in the browser until they're exported as a zip (export mode).
export default defineConfig(({ mode }) => ({
  plugins: [vue(), fieldNotes()],
  build: { outDir: mode === 'export' ? 'dist/export' : 'dist/local' },
}));
