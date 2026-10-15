// Widget options written as attributes: on the script tag (`data-*`), and on
// a <field-notes> element declared in a page or template.
import type { Corner, Offset } from './button.ts';
import type { FieldNotesOptions, Trigger } from './mount.ts';
import type { Surface } from './panel.ts';

const CORNERS: readonly string[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const TRIGGERS: readonly string[] = ['button', 'hotkey'];
const SURFACES: readonly string[] = ['popover', 'sheet', 'side'];
const SCREENSHOTS: readonly string[] = ['dom', 'display', 'off'];

/** `16` → 16; `8,24` → x 8, y 24. Anything else is ignored. */
function parseOffset(text: string): Offset | undefined {
  const parts = text.split(',').map((part) => Number(part.trim()));
  if (parts.length > 2 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [x = 0, y = x] = parts;
  return parts.length === 1 ? x : { x, y };
}

/**
 * Options from attributes, read by name through `read`: `enabled`
 * (`true`/`false`), `trigger` (`"button hotkey"`, or empty for API only),
 * `position` (a corner), `offset` (`16` or `8,24`), `surface` (`popover`,
 * `sheet` or `side`), `screenshot` (`dom`, `display` or `off`), `hotkey`,
 * `endpoint` and `token`. Values it doesn't recognise are ignored.
 */
export function readOptions(read: (name: string) => string | undefined): FieldNotesOptions {
  const data = {
    enabled: read('enabled'),
    trigger: read('trigger'),
    position: read('position'),
    offset: read('offset'),
    surface: read('surface'),
    screenshot: read('screenshot'),
    hotkey: read('hotkey'),
    endpoint: read('endpoint'),
    token: read('token'),
  };
  const options: FieldNotesOptions = {};
  if (data.enabled === 'true' || data.enabled === 'false')
    options.enabled = data.enabled === 'true';
  if (data.trigger !== undefined) {
    const words = data.trigger.split(/[\s,]+/).filter((word) => TRIGGERS.includes(word));
    options.trigger = words as Trigger[];
  }
  if (data.position && CORNERS.includes(data.position)) {
    options.buttonPosition = data.position as Corner;
  }
  const offset = data.offset ? parseOffset(data.offset) : undefined;
  if (offset !== undefined) options.buttonOffset = offset;
  if (data.surface && SURFACES.includes(data.surface)) options.surface = data.surface as Surface;
  if (data.screenshot && SCREENSHOTS.includes(data.screenshot)) {
    options.screenshot = data.screenshot as 'dom' | 'display' | 'off';
  }
  if (data.hotkey) options.hotkey = data.hotkey;
  if (data.endpoint) options.endpoint = data.endpoint;
  if (data.token) options.token = data.token;
  return options;
}
