// SPIKE (to be removed): can the test plumbing for #20 work in every engine?
import { expect, it } from 'vitest';

async function grab(stream: MediaStream): Promise<ImageData> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.videoWidth) resolve();
    else video.addEventListener('resize', () => resolve(), { once: true });
  });
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const paint = canvas.getContext('2d');
  if (!paint) throw new Error('no 2d');
  paint.drawImage(video, 0, 0);
  for (const track of stream.getTracks()) track.stop();
  return paint.getImageData(0, 0, canvas.width, canvas.height);
}

it('grabs a frame from a canvas stream', async () => {
  const source = document.createElement('canvas');
  source.width = 64;
  source.height = 48;
  const paint = source.getContext('2d');
  if (!paint) throw new Error('no 2d');
  paint.fillStyle = 'rgb(0, 200, 0)';
  paint.fillRect(0, 0, 64, 48);
  const stream = source.captureStream();
  // Some engines only send a frame once the canvas changes after capture starts.
  const timer = setInterval(() => {
    paint.fillRect(0, 0, 64, 48);
  }, 16);
  try {
    const frame = await grab(stream);
    expect([frame.width, frame.height]).toEqual([64, 48]);
    const [r, g, b] = frame.data;
    expect(r).toBeLessThan(40);
    expect(g).toBeGreaterThan(160);
    expect(b).toBeLessThan(40);
    expect(stream.getTracks().every((t) => t.readyState === 'ended')).toBe(true);
  } finally {
    clearInterval(timer);
  }
});

it('carries a file in synthetic paste and drop events', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
  const data = new DataTransfer();
  data.items.add(file);
  const target = document.createElement('textarea');
  document.body.append(target);
  const seen: string[] = [];
  target.addEventListener('paste', (event) => {
    seen.push(`paste:${String(event.clipboardData?.files[0]?.type)}`);
  });
  target.addEventListener('drop', (event) => {
    seen.push(`drop:${String(event.dataTransfer?.files[0]?.type)}:${String(event.dataTransfer?.types.includes('Files'))}`);
  });
  target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true }));
  target.remove();
  expect(seen).toEqual(['paste:image/png', 'drop:image/png:true']);
});
