<script setup lang="ts">
import { defineFieldNotes } from '@deanbot/field-notes';

// <field-notes> below carries the widget once this has run. App.vue loads
// this component only in dev and export builds, so any other production
// build leaves the widget out entirely.
defineFieldNotes(
  import.meta.env.MODE === 'export'
    ? // Export mode, for a demo or staging build: off until ?field-notes=1, and
      // notes stay in the browser until exported.
      { mode: 'export', enabled: 'query' }
    : // Local mode: notes go to the Vite plugin, and on into .field-notes/.
      {},
);
</script>

<template>
  <!-- A custom element: vite.config.ts tells Vue so with isCustomElement. -->
  <field-notes position="bottom-right" />
</template>
