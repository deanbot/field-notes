import type { ReactNode } from 'react';
import { FieldNotes } from './field-notes';

export const metadata = { title: 'Checkout · Example shop' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <FieldNotes />
      </body>
    </html>
  );
}
