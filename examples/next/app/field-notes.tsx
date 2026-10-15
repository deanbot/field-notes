'use client';

import { mountFieldNotes } from 'field-notes';
import { useEffect } from 'react';

/**
 * Mounts the widget in development only. It renders nothing: the widget adds
 * its own <field-notes> element to <body>, outside React's tree. Unmounting
 * on cleanup keeps it to one widget when React runs effects twice in dev.
 */
export function FieldNotes() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const handle = mountFieldNotes();
    return () => {
      handle.unmount();
    };
  }, []);
  return null;
}
