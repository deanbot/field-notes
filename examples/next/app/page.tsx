import { PlaceOrder } from './place-order';

// Rendered on the server for each request, as a real page would be.
export const dynamic = 'force-dynamic';

export default function Checkout() {
  return (
    <main
      style={{ maxWidth: '32rem', margin: '2rem auto', font: '16px/1.5 system-ui, sans-serif' }}
    >
      <h1>Checkout</h1>
      <section style={{ padding: '1rem', border: '1px solid #d0d7de', borderRadius: 8 }}>
        <h2>Field notebook, dot grid</h2>
        <p>Total: $24</p>
      </section>
      <PlaceOrder />
    </main>
  );
}
