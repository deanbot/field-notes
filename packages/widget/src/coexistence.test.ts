// The widget as a guest: a host page with its own Lit, hostile CSS and globals.
import { LitElement, html } from 'lit-v2';
import { afterEach, expect, it } from 'vitest';
import { TAG_NAME } from './element.ts';
import { type FieldNotesHandle, mountFieldNotes } from './mount.ts';

let handle: FieldNotesHandle | undefined;

afterEach(() => {
  handle?.unmount();
  document.body.replaceChildren();
  document.head.querySelectorAll('style[data-hostile]').forEach((style) => {
    style.remove();
  });
});

function shadow(): ShadowRoot {
  const root = document.querySelector(TAG_NAME)?.shadowRoot;
  if (!root) throw new Error('no mounted shadow root');
  return root;
}

it('adds no globals beyond the ones Lit and Zod share across copies', async () => {
  const before = new Set(Object.getOwnPropertyNames(globalThis));
  handle = mountFieldNotes({ enabled: true, screenshot: 'off' });
  await handle.open();
  handle.unmount();
  const added = Object.getOwnPropertyNames(globalThis).filter((name) => !before.has(name));
  // Documented in PLAN.md (Coexisting with the host app).
  const shared = ['litHtmlVersions', '__zod_globalConfig', '__zod_globalRegistry'];
  expect(added.filter((name) => !shared.includes(name))).toEqual([]);
});

it('runs beside a host on a different Lit version', async () => {
  class HostGreeting extends LitElement {
    override render(): unknown {
      return html`<p>host on lit 2</p>`;
    }
  }
  customElements.define('host-greeting', HostGreeting);
  const host = document.createElement('host-greeting') as HostGreeting;
  document.body.append(host);
  await host.updateComplete;

  handle = mountFieldNotes({ enabled: true, screenshot: 'off' });
  await handle.open();

  expect(host.shadowRoot?.textContent).toContain('host on lit 2');
  expect(shadow().querySelector('dialog')).not.toBeNull();
  const versions = (globalThis as { litHtmlVersions?: string[] }).litHtmlVersions ?? [];
  expect(versions.some((v) => v.startsWith('2.'))).toBe(true);
  expect(versions.some((v) => v.startsWith('3.'))).toBe(true);
  expect(customElements.get(TAG_NAME)).toBeDefined();
});

it('keeps hostile host CSS out of the shadow root', async () => {
  const style = document.createElement('style');
  style.dataset.hostile = '';
  style.textContent = `
    * { color: rgb(255, 0, 0) !important; font: 40px/9 serif !important; }
    ${TAG_NAME} { display: none; padding: 99px; }
    section, h2, button, dialog { display: none !important; }
  `;
  document.head.append(style);

  handle = mountFieldNotes({ enabled: true, screenshot: 'off' });
  await handle.open();
  const heading = shadow().querySelector('h2');
  if (!heading) throw new Error('no heading');
  const computed = getComputedStyle(heading);

  expect(computed.display).not.toBe('none');
  expect(computed.color).not.toBe('rgb(255, 0, 0)');
  expect(computed.fontSize).not.toBe('40px');
  expect(heading.getBoundingClientRect().height).toBeGreaterThan(0);
});
