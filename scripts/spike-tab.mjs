const { chromium } = await import('playwright');
const browser = await chromium.launch({ channel: 'chromium', args: ['--auto-accept-this-tab-capture'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.route('https://spike.test/', (r) => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;height:2000px;background:rgb(0,0,255)"><input type=password value=secret style="position:fixed;top:10px;left:10px"></body>' }));
await page.goto('https://spike.test/');
await page.evaluate(() => scrollTo(0, 100));
await page.mouse.click(5, 5);
const out = await page.evaluate(async () => {
  const log = [];
  try {
    log.push('CropTarget=' + typeof window.CropTarget + ' Restriction=' + typeof window.RestrictionTarget);
    // needs a gesture? try without first
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true, selfBrowserSurface: 'include' });
    const [track] = stream.getVideoTracks();
    log.push('settings=' + JSON.stringify(track.getSettings()));
    const target = await CropTarget.fromElement(document.documentElement);
    await track.cropTo(target);
    log.push('cropTo ok');
    const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play();
    await new Promise(r => video.requestVideoFrameCallback(() => r()));
    await new Promise(r => video.requestVideoFrameCallback(() => r()));
    log.push('frame=' + video.videoWidth + 'x' + video.videoHeight + ' client=' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight + ' dpr=' + devicePixelRatio);
    track.stop();
  } catch (e) { log.push('error ' + e.name + ': ' + e.message); }
  return log;
});
console.log(out.join('\n'));
await browser.close();
