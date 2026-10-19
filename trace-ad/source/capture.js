// usage: node capture.js <render.html> <out.mp4|stills-dir> [fps] [--stills t1,t2,...]
const { chromium } = require(process.env.PWC);
const { spawn } = require('child_process');
const path = require('path');
(async () => {
  const [html, out, fpsArg, flag, list] = process.argv.slice(2);
  const fps = +fpsArg || 30;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.resolve(html));
  const DUR = await page.evaluate(() => window.DUR || 32000);
  for (let t = 0; t < DUR; t += 2000) await page.evaluate(t => window.renderAt(t), t);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const stage = page.locator('#stage');
  if (flag === '--stills') {
    for (const t of list.split(',').map(Number)) {
      await page.evaluate(t => window.renderAt(t), t);
      await stage.screenshot({ path: `${out}/f_${t}.jpg`, type: 'jpeg', quality: 80 });
    }
  } else {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const START = +(process.env.START || 0), END = +(process.env.END || DUR);
    const N = Math.round((END - START) / 1000 * fps);
    for (let i = 0; i < N; i++) {
      await page.evaluate(t => window.renderAt(t), START + i * 1000 / fps);
      const buf = await stage.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 120 === 0) console.log('frame', i, '/', N);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
