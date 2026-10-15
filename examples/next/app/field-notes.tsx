'use client';

import { defineFieldNotes } from 'field-notes';
import { useEffect } from 'react';

const dev = process.env.NODE_ENV === 'development';

/**
 * The widget, in development only: a <field-notes> element in React's tree,
 * configured by its attributes, which carries the widget once
 * defineFieldNotes() has run. The server renders the element empty. Running
 * effects twice, as React does in dev, is harmless.
 */
export function FieldNotes() {
  useEffect(() => {
    if (dev) defineFieldNotes();
  }, []);
  return dev ? <field-notes position="bottom-right" /> : null;
}
