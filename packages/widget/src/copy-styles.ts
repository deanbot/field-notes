// Which computed styles the page copy reads, element by element. Reading
// them is most of the copy's time: two calls per property per element, for
// some 450 properties. Only elements near the viewport are drawn, so the
// rest are copied for their layout alone: their box at the size it has,
// which their content then can't change.

/** How near the viewport (px) an element must come to be copied whole: paint can reach past a box. */
const NEAR = 100;

/**
 * Places an element's box at the size it has: enough for one whose content
 * can't be seen. A transform can still bring it into view, or hide it.
 */
const BOX = `display position top right bottom left float clear box-sizing width height
margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left
border-top-width border-right-width border-bottom-width border-left-width
border-top-style border-right-style border-bottom-style border-left-style
overflow-x overflow-y vertical-align contain clip-path
transform translate rotate scale transform-origin`.split(/\s+/);

/** Where a flex or grid container that is seen puts an item. */
const ITEM = `flex-grow flex-shrink flex-basis order align-self justify-self
grid-column-start grid-column-end grid-row-start grid-row-end`.split(/\s+/);

/** How inline content flows: it shares its lines with what is seen. */
const TEXT = `font-family font-size font-weight font-style font-stretch font-variant-caps
font-variant-numeric font-variant-ligatures font-kerning font-size-adjust
font-feature-settings font-variation-settings text-rendering line-height letter-spacing word-spacing
white-space-collapse text-wrap-mode text-transform text-indent word-break overflow-wrap
line-break hyphens tab-size direction unicode-bidi writing-mode`.split(/\s+/);

/** The part of a computed style the library reads. */
type Styles = Pick<
  CSSStyleDeclaration,
  'length' | 'item' | 'getPropertyValue' | 'getPropertyPriority'
>;

/** What stands in for the page's window: the library only asks it for computed styles. */
export interface StyleSource {
  readonly getComputedStyle: (el: Element, pseudo?: string | null) => Styles;
  /** Whether to leave `node` out of the copy: it's in a box whose content can't be seen or change anything else. */
  readonly leftOut: (node: Node) => boolean;
}

/** SVG that draws nothing where it is, but wherever it's referenced from. */
const SVG_RESOURCES = new Set([
  'defs',
  'symbol',
  'linearGradient',
  'radialGradient',
  'pattern',
  'clipPath',
  'mask',
  'filter',
  'marker',
]);

const parentOf = (node: Node): Element | null =>
  node.parentElement ?? (node.parentNode instanceof ShadowRoot ? node.parentNode.host : null);

/** Whether an item of a container in view is lined up with the others by its content's baseline. */
function linedUp(real: CSSStyleDeclaration, parent: Element, parentDisplay: string): boolean {
  if (parentDisplay === 'table-row') return real.getPropertyValue('vertical-align') === 'baseline';
  if (!/flex|grid/.test(parentDisplay)) return false;
  const self = real.getPropertyValue('align-self');
  return (
    self.includes('baseline') ||
    (self === 'auto' && getComputedStyle(parent).alignItems.includes('baseline'))
  );
}

/**
 * Whether a box out of view, held at its size, keeps its content to itself:
 * a table row (the cells in view keep the columns' widths), or a box that
 * lays out its content on its own (no margins collapse through it, no floats
 * leave it).
 */
function selfContained(real: CSSStyleDeclaration, display: string): boolean {
  if (display === 'table-row') return true;
  return (
    /^(flow-root|flex|grid|table|table-cell|table-caption)$/.test(display) ||
    /absolute|fixed/.test(real.getPropertyValue('position')) ||
    real.getPropertyValue('float') !== 'none' ||
    !/visible|clip/.test(real.getPropertyValue('overflow-x'))
  );
}

/** Elements whose box, or a descendant's, comes near the viewport, and SVG resources. */
function nearView(): WeakSet<Element> {
  const near = new WeakSet<Element>();
  const width = innerWidth;
  const height = innerHeight;
  const all = (el: Element): void => {
    near.add(el);
    for (const child of el.children) all(child);
  };
  const walk = (el: Element): boolean => {
    if (el instanceof SVGElement && SVG_RESOURCES.has(el.localName)) {
      all(el);
      return true;
    }
    let seen = false;
    for (const child of el.children) if (walk(child)) seen = true;
    if (el.shadowRoot) for (const child of el.shadowRoot.children) if (walk(child)) seen = true;
    if (!seen) {
      // No box (display: none or contents) is at 0,0 but shows nothing.
      const box = el.getBoundingClientRect();
      // What overflows the box, text and positioned pseudo-elements too,
      // reaches as far as its scrollable overflow.
      const right = Math.max(box.right, box.left + el.scrollWidth);
      const bottom = Math.max(box.bottom, box.top + el.scrollHeight);
      seen =
        (box.width > 0 || box.height > 0) &&
        right > -NEAR &&
        bottom > -NEAR &&
        box.left < width + NEAR &&
        box.top < height + NEAR;
    }
    if (seen) near.add(el);
    return seen;
  };
  walk(document.documentElement);
  return near;
}

const listed = (
  names: readonly string[],
  real: CSSStyleDeclaration,
  overrides: Readonly<Record<string, string>> = {},
): Styles => ({
  length: names.length,
  item: (index) => names[index] ?? '',
  getPropertyValue: (name) => overrides[name] ?? real.getPropertyValue(name),
  // A computed style's priority is always empty.
  getPropertyPriority: () => '',
});

/** A pseudo-element that isn't there. */
const NO_PSEUDO: Styles = {
  length: 0,
  item: () => '',
  getPropertyValue: (name) => (name === 'content' ? 'none' : ''),
  getPropertyPriority: () => '',
};

/**
 * Computed styles for the library to copy, read now for where things are.
 * Elements near the viewport give every property; the rest give their box,
 * clipped to it, plus where a seen flex or grid container puts them, and
 * how their text flows if it shares lines or a baseline with what is seen.
 * Their pseudo-elements are left out otherwise, and so is the content of a
 * box that keeps it to itself.
 */
export function styleSource(): StyleSource {
  const near = nearView();
  const every = [...getComputedStyle(document.documentElement)].filter(
    (name) => !name.startsWith('--'),
  );
  // Elements whose text shares lines, or a baseline, with what is seen. The
  // library copies a parent before its children.
  const flowing = new WeakSet<Element>();
  // Out of view, at their size, keeping their content to themselves.
  const emptied = new WeakSet<Element>();
  return {
    leftOut: (node) => {
      const parent = parentOf(node);
      return parent !== null && emptied.has(parent);
    },
    getComputedStyle: (el, pseudo) => {
      if (pseudo && !near.has(el) && !flowing.has(el)) return NO_PSEUDO;
      const real = getComputedStyle(el, pseudo);
      if (near.has(el)) return pseudo ? real : listed(every, real);
      if (pseudo) return listed([...BOX, ...TEXT], real);
      const display = real.getPropertyValue('display');
      const parent = parentOf(el);
      const seenParent = parent !== null && near.has(parent);
      const parentDisplay = seenParent ? getComputedStyle(parent).display : '';
      const inline = display.startsWith('inline') || display.startsWith('ruby');
      if (
        seenParent
          ? inline || linedUp(real, parent, parentDisplay)
          : parent !== null && flowing.has(parent)
      )
        flowing.add(el);
      if (!flowing.has(el) && selfContained(real, display)) emptied.add(el);
      const names = [...BOX];
      if (seenParent && /flex|grid/.test(parentDisplay)) names.push(...ITEM);
      if (flowing.has(el)) names.push(...TEXT);
      // Clipped to its box, so text that no longer fits it can't reach into view.
      return listed(names, real, { 'clip-path': 'inset(0px)' });
    },
  };
}
