// An image for a note, however it was taken: encoding, and the shape a
// capture has while it's taken. No dependencies, so a display capture or a
// pasted image doesn't load the DOM screenshot code.

/** PNG up to this size; above it, WebP where the browser can encode it. */
export const WEBP_ABOVE = 1_000_000;

/** Larger than this even so, the image is halved. */
export const MAX_BYTES = 8_000_000;

/** A pasted or dropped file larger than this isn't decoded at all. */
export const MAX_FILE_BYTES = 32_000_000;

/** A pasted or dropped image is scaled down to fit this, in pixels. */
export const MAX_SIDE = 4096;

export interface Screenshot {
  readonly blob: Blob;
  /** `screenshot.png` or `screenshot.webp`; `image.*` for a pasted one. */
  readonly name: string;
}

export interface Capture {
  /** Settles once the page is copied: whatever covers it after that isn't in the shot. */
  readonly cloned: Promise<void>;
  /** The image; undefined if it failed (with a warning) or was cancelled. */
  readonly image: Promise<Screenshot | undefined>;
  readonly cancel: () => void;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

/** `source` drawn on a new canvas of the given size. */
export function draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * PNG; WebP when the PNG is large and WebP is smaller; halved until it's
 * under `MAX_BYTES`. Named `base` plus the extension.
 */
export async function encode(
  canvas: HTMLCanvasElement,
  base = 'screenshot',
): Promise<Screenshot | undefined> {
  for (
    let tries = 0;
    tries < 3;
    tries++, canvas = draw(canvas, Math.floor(canvas.width / 2), Math.floor(canvas.height / 2))
  ) {
    let blob = await toBlob(canvas, 'image/png');
    if (!blob || blob.size > WEBP_ABOVE) {
      // A browser that can't encode WebP hands back a PNG instead.
      const webp = await toBlob(canvas, 'image/webp', 0.85);
      if (webp?.type === 'image/webp' && webp.size < (blob?.size ?? Infinity)) blob = webp;
    }
    if (blob && blob.size <= MAX_BYTES) {
      return { blob, name: `${base}.${blob.type === 'image/webp' ? 'webp' : 'png'}` };
    }
  }
  return undefined;
}

/**
 * A pasted or dropped image, decoded and encoded again as `image.png` (or
 * `.webp`): no metadata survives, such as a photo's location. Undefined for
 * a file that isn't an image the browser can decode, or is too large.
 */
export async function fromFile(file: Blob): Promise<Screenshot | undefined> {
  if (!file.type.startsWith('image/') || file.size > MAX_FILE_BYTES) return undefined;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return undefined;
  }
  const fit = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = draw(bitmap, bitmap.width * fit, bitmap.height * fit);
  bitmap.close();
  return encode(canvas, 'image');
}
