<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';

// The widget, in dev and export builds only: production builds drop this
// import, and with it every trace of the widget.
const FieldNotes =
  import.meta.env.DEV || import.meta.env.MODE === 'export'
    ? defineAsyncComponent(() => import('./FieldNotes.vue'))
    : undefined;

const quantity = ref(1);
const price = 24;
const total = computed(() => quantity.value * price);
const placed = ref(false);
</script>

<template>
  <main class="checkout">
    <h1>Checkout</h1>
    <section class="item">
      <h2>Field notebook, dot grid</h2>
      <label>
        Quantity
        <input v-model.number="quantity" type="number" min="1" max="9" />
      </label>
      <p class="total">Total: ${{ total }}</p>
    </section>
    <button type="button" class="place-order" @click="placed = true">Place order</button>
    <p v-if="placed" role="status">Thanks! Your order is on its way.</p>
    <component :is="FieldNotes" v-if="FieldNotes" />
  </main>
</template>

<style scoped>
.checkout {
  max-width: 32rem;
  margin: 2rem auto;
  font:
    16px/1.5 system-ui,
    sans-serif;
}
.item {
  padding: 1rem;
  border: 1px solid #d0d7de;
  border-radius: 8px;
}
.total {
  font-weight: 600;
}
.place-order {
  margin-top: 1rem;
  padding: 0.6rem 1.2rem;
  border: 0;
  border-radius: 6px;
  color: #fff;
  background: #1f883d;
  font: inherit;
}
</style>
