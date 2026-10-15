'use client';

import { useState } from 'react';

export function PlaceOrder() {
  const [placed, setPlaced] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPlaced(true);
        }}
        style={{
          marginTop: '1rem',
          padding: '0.6rem 1.2rem',
          border: 0,
          borderRadius: 6,
          color: '#fff',
          background: '#1f883d',
          font: 'inherit',
        }}
      >
        Place order
      </button>
      {placed && <p role="status">Thanks! Your order is on its way.</p>}
    </>
  );
}
