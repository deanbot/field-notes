// Reading a screenshot's pixels, for the screenshot tests.

export interface Pixels {
  /** Device pixels per CSS pixel. */
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  /** `r,g,b` at a point in CSS pixels. */
  readonly at: (x: number, y: number) => string;
  /** Whether any pixel passes `test`. */
  readonly some: (test: (r: number, g: number, b: number) => boolean) => boolean;
  /** Where the pixels differ from `other`'s by more than `tolerance` in a channel, in CSS pixels. */
  readonly differences: (other: Pixels, tolerance: number) => { x: number; y: number }[];
  /** The raw RGBA data. */
  readonly data: Uint8ClampedArray;
}

export async function pixels(blob: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  // The viewport's width: <html>'s, or in quirks mode <body>'s.
  const viewport = document.scrollingElement ?? document.documentElement;
  const scale = bitmap.width / viewport.clientWidth;
  return {
    scale,
    width: bitmap.width,
    height: bitmap.height,
    at: (x, y) => {
      const i = (Math.floor(y * scale) * canvas.width + Math.floor(x * scale)) * 4;
      return `${String(data[i])},${String(data[i + 1])},${String(data[i + 2])}`;
    },
    data,
    differences: (other, tolerance) => {
      const found: { x: number; y: number }[] = [];
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          if (Math.abs((data[i + c] ?? 0) - (other.data[i + c] ?? 0)) > tolerance) {
            const pixel = i / 4;
            found.push({
              x: (pixel % canvas.width) / scale,
              y: Math.floor(pixel / canvas.width) / scale,
            });
            break;
          }
        }
      }
      return found;
    },
    some: (test) => {
      for (let i = 0; i < data.length; i += 4) {
        if (test(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)) return true;
      }
      return false;
    },
  };
}
