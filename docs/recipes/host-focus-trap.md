# Host focus traps

If your app opens its own modal (a dialog library, `focus-trap`, Radix, MUI and the like) and someone opens field-notes while that modal is up, two focus traps meet. This recipe says what works on its own and what needs one line from you.

## What works without you doing anything

Every field-notes surface is a modal `<dialog>`. While it's open the rest of the page, your modal included, is inert, so your trap can't pull focus back out of the widget. The widget also repairs what a trap typically cancels:

- **Typing** goes to the note, and **Ctrl/Cmd+Enter** submits it.
- **Tab and Shift+Tab** stay inside the widget, even when your trap cancels them.
- **Clicking into a field** focuses it, even when your trap cancels the `mousedown`.
- **Esc** closes the widget and doesn't reach your page's Esc handlers in the bubble phase, so it won't close your modal or deactivate your trap. A handler that listens for Escape in the **capture** phase still sees it.

A trap that only pulls focus back (a `focusin` listener) needs nothing more.

## What needs you to pause your trap

Libraries like `focus-trap` with their defaults also **block every click outside their container**: they cancel it and stop it in the capture phase, before it reaches the widget. While such a trap is active, the widget's buttons don't respond, whether clicked or pressed with Enter or Space: Add note, Close, the type chips and My notes. On touch screens, taps are blocked too.

Pause your trap while the widget is open with `onOpen` and `onClose`:

```js
import { mountFieldNotes } from '@deanbot/field-notes';

mountFieldNotes({
  onOpen: () => myTrap.pause(),
  onClose: () => myTrap.unpause(),
});
```

- `onOpen` runs right before a surface opens.
- `onClose` runs once after each surface closes, whatever closed it: its close button, Esc, a click outside the popover, the hotkey, `close()` or `toggle()`, a submitted note, or `unmount()`.
- A hook that throws is reported with `console.warn` and doesn't stop the widget.

After `unpause()`, `focus-trap` moves focus back into your modal itself.

Other libraries have their own switch: pause or deactivate the trap, or allow clicks outside it while the widget is open (for `focus-trap`, `allowOutsideClick`).

## Notes

- **Script tag:** there are no `data-*` attributes for hooks. Mount from your own script instead: `FieldNotes.mount({ onOpen, onClose })`.
- **One mount per page:** if the widget is already mounted (say, by the script tag), another `mountFieldNotes()` call returns that mount and ignores its options, hooks included. It warns when that drops hooks.
