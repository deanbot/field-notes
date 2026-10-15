import vue from '@vitejs/plugin-vue';
import { fieldNotes } from '@deanbot/field-notes/vite';
import { defineConfig } from 'vite';

// `vite` takes notes into .field-notes/ through the plugin (local mode).
// `vite build --mode export` builds the static demo: the widget keeps notes
// in the browser until they're exported as a zip (export mode).
export default defineConfig(({ mode }) => ({
  plugins: [
    // <field-notes> is the widget's custom element, not a Vue component.
    vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'field-notes' } } }),
    fieldNotes(),
  ],
  build: { outDir: mode === 'export' ? 'dist/export' : 'dist/local' },
}));
