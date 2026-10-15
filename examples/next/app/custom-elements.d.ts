import type { HTMLAttributes } from 'react';

// <field-notes> in JSX: the widget's custom element, with its attributes.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'field-notes': HTMLAttributes<HTMLElement> & {
        position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
        offset?: string;
        surface?: 'popover' | 'sheet' | 'side';
        trigger?: string;
        hotkey?: string;
        screenshot?: 'dom' | 'display' | 'off';
        enabled?: 'true' | 'false';
      };
    }
  }
}
