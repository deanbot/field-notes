// Entry for the self-contained script-tag build (IIFE). Its exports become
// `window.FieldNotes`, the one global the widget defines, and only here.
import { type ScriptApi, startScriptTag } from '@field-notes/widget/script-tag';

const api: ScriptApi = startScriptTag(document.currentScript);

export const mount: ScriptApi['mount'] = api.mount;
export const open: ScriptApi['open'] = api.open;
export const close: ScriptApi['close'] = api.close;
export const toggle: ScriptApi['toggle'] = api.toggle;
export const unmount: ScriptApi['unmount'] = api.unmount;
