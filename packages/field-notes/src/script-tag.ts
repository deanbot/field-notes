// Entry for the self-contained script-tag build (IIFE). Its exports become
// `window.FieldNotes`, the one global the widget defines, and only here.
import { type ScriptApi, startScriptTag } from '@field-notes/widget/script-tag';

// `field-notes serve` replaces this placeholder with its token when it
// serves the script. Unreplaced, it isn't a token (braces), so it's ignored.
const INJECTED = '{{field-notes-token}}';

const api: ScriptApi = startScriptTag(
  document.currentScript,
  /^[\w-]+$/.test(INJECTED) ? INJECTED : undefined,
);

export const mount: ScriptApi['mount'] = api.mount;
export const open: ScriptApi['open'] = api.open;
export const close: ScriptApi['close'] = api.close;
export const toggle: ScriptApi['toggle'] = api.toggle;
export const unmount: ScriptApi['unmount'] = api.unmount;
