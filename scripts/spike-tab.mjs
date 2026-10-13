// SPIKE (to be removed): real tab capture in CI only. Never run locally.
const { chromium } = await import('playwright');
if (!process.env.CI) throw new Error('CI only');
const attempts = [
  ['--auto-accept-this-tab-capture'],
  ['--auto-select-tab-capture-source-by-title=Spike'],
  ['--use-fake-ui-for-media-stream', '--auto-select-tab-capture-source-by-title=Spike'],
];
for (const args of attempts) {
  const browser = await chromium.launch({ channel: 'chromium', args });
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.route('https://spike.test/', (r) => r.fulfill({ contentType: 'text/html', body: '<title>Spike</title><body style="margin:0;height:2000px;background:rgb(0,0,255)"><input type=password value=secret style="position:fixed;top:10px;left:10px"></body>' }));
  await page.goto('https://spike.test/');
  await page.evaluate(() => scrollTo(0, 100));
  await page.mouse.click(5, 5);
  const out = await page.evaluate(async () => {
    const log = [];
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
    try {
      const stream = await Promise.race([navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true, selfBrowserSurface: 'include' }), timeout(15000)]);
      const [track] = stream.getVideoTracks();
      log.push('settings=' + JSON.stringify(track.getSettings()));
      await track.cropTo(await CropTarget.fromElement(document.documentElement));
      log.push('cropTo ok');
      const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play();
      for (let i = 0; i < 3; i++) await new Promise((r) => video.requestVideoFrameCallback(() => r()));
      log.push('frame=' + video.videoWidth + 'x' + video.videoHeight + ' client=' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight + ' inner=' + innerWidth + 'x' + innerHeight + ' dpr=' + devicePixelRatio);
      const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      const g = c.getContext('2d'); g.drawImage(video, 0, 0);
      const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data).join(',');
      log.push('px(200,200)=' + px(200, 200) + ' px(20,20)=' + px(20, 20) + ' px(w-3,150)=' + px(c.width - 3, 150));
      track.stop();
    } catch (e) { log.push('error ' + e.name + ': ' + e.message); }
    return log;
  });
  console.log(JSON.stringify(args) + '\n  ' + out.join('\n  '));
  await browser.close();
}
