import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_SIDE, fromFile } from './image.ts';

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.fillRect(0, 0, width, height);
  return canvas;
}

async function file(canvas: HTMLCanvasElement, type = 'image/png'): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type);
  });
  if (!blob) throw new Error('not encoded');
  return new File([blob], 'in', { type: blob.type });
}

describe('fromFile', () => {
  it('encodes an image again, so nothing of the original file is kept', async () => {
    const original = await file(canvasOf(12, 8), 'image/jpeg');
    const image = await fromFile(original);
    expect(image?.name).toBe('image.png');
    expect(image?.blob.type).toBe('image/png');
  });

  it('scales a large image down to fit', async () => {
    const image = await fromFile(await file(canvasOf(MAX_SIDE * 2, 4)));
    if (!image) throw new Error('no image');
    const bitmap = await createImageBitmap(image.blob);
    expect([bitmap.width, bitmap.height]).toEqual([MAX_SIDE, 2]);
  });

  it('takes nothing that isn’t an image, is too large, or can’t be read', async () => {
    expect(await fromFile(new File(['text'], 'a.txt', { type: 'text/plain' }))).toBeUndefined();
    expect(await fromFile(new File(['x'], 'a.png', { type: 'image/png' }))).toBeUndefined();
    const huge = new Blob([new Uint8Array(MAX_FILE_BYTES + 1)], { type: 'image/png' });
    expect(await fromFile(huge)).toBeUndefined();
  });
});
