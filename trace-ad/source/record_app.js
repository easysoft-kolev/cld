// Drives the real TRACE app (served locally, API mocked) and records a phone-size screencast.
// usage: PWC=... node record_app.js <app-url> <frames-dir>
const { chromium } = require(process.env.PWC);
const fs = require('fs');
const path = require('path');
const [url, outDir] = process.argv.slice(2);

const ROWS = [
  { id: 'r2', when: '19/10/2026, 07:15:04', driver: 'Шофьор 1', plate: 'Кола 3', route: 'Регион 2', stops: 'Обект 11', start: 1553, end: 1786, dist: 233 },
  { id: 'r1', when: '19/10/2026, 06:40:51', driver: 'Шофьор 2', plate: 'Кола 1', route: 'Регион 1', stops: 'Обект 2, Обект 3, Обект 4', start: 98200, end: 98450, dist: 250 },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 822 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'bg-BG' });
  const page = await ctx.newPage();

  let rows = ROWS.slice();
  await page.route('https://trace.api/**', async route => {
    const q = new URL(route.request().url()).searchParams;
    const a = q.get('action');
    let body = { ok: false, error: 'unknown' };
    if (a === 'login') { await new Promise(r => setTimeout(r, 450)); body = { ok: true, token: 'TRACE-demo', user: 'demo' }; }
    if (a === 'list') body = { ok: true, rows };
    if (a === 'add') {
      await new Promise(r => setTimeout(r, 650));
      const s = +q.get('start'), e = +q.get('end');
      rows = [{ id: 'r3', when: '19/10/2026, 08:42:10', driver: q.get('driver'), plate: q.get('plate'), route: q.get('route'), stops: q.get('stops'), start: s, end: e, dist: e - s }].concat(rows);
      body = { ok: true, rows };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });

  // Visible finger-tap indicator
  await page.addInitScript(() => {
    window.__tap = (x, y) => {
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(234,255,251,.35);border:2px solid rgba(234,255,251,.9);z-index:99999;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out;transform:scale(.6)`;
      document.documentElement.appendChild(d);
      requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = 'scale(1.5)'; d.style.opacity = '0'; }));
      setTimeout(() => d.remove(), 600);
    };
  });

  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async f => {
    const n = frames.length;
    const file = path.join(outDir, `f_${String(n).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, ts: f.metadata.timestamp });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {}
  });

  await page.goto('about:blank');
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1644, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  const marks = {};
  const at = async s => { const w = t0 + s - Date.now() / 1000; if (w > 0) await page.waitForTimeout(w * 1000); };
  const tap = async loc => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    await page.evaluate(([x, y]) => window.__tap(x, y), [b.x + b.width / 2, b.y + b.height / 2]);
    await page.waitForTimeout(120);
    await loc.click();
  };
  const scrollTo = async (sel, offset) => page.evaluate(([sel, offset]) => {
    const el = document.querySelector(sel);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
  }, [sel, offset]);
  const pick = async (selectId, value) => {
    await tap(page.locator(`.sel:has(#${selectId}) .sel-trigger`));
    await page.waitForTimeout(650);
    await tap(page.locator(`.sel.open .sel-item:has(.sel-text:text-is("${value}"))`));
  };

  // 1. Home -> login
  marks.a = 0;
  await at(1.4); await tap(page.locator('#startBtn'));
  await at(2.0); await tap(page.locator('#username')); await page.locator('#username').pressSequentially('demo', { delay: 110 });
  await at(2.8); await tap(page.locator('#password')); await page.locator('#password').pressSequentially('demo', { delay: 110 });
  await at(3.6); await tap(page.locator('#loginBtn'));
  // 2. Driver, car, route
  await at(4.9); marks.b = 4.9;
  await pick('driver', 'Шофьор 3');
  await at(6.4); await pick('plate', 'Кола 2');
  await at(7.6); await pick('route', 'Регион 2');
  // 3. Stops
  await at(8.9); marks.c = 8.9;
  await scrollTo('#stopsList', 150);
  for (const [s, o] of [[9.6, 'Обект 11'], [10.2, 'Обект 12'], [10.8, 'Обект 14']]) {
    await at(s); await tap(page.locator('label.stop').filter({ hasText: new RegExp('^' + o + '$') }));
  }
  // 4. Kilometres
  await at(11.7); marks.d = 11.7;
  await scrollTo('#startKm', 300);
  await at(12.3); await tap(page.locator('#startKm')); await page.locator('#startKm').pressSequentially('124350', { delay: 85 });
  await at(13.3); await tap(page.locator('#endKm')); await page.locator('#endKm').pressSequentially('124600', { delay: 85 });
  // 5. Save -> history
  await at(14.8); marks.e = 14.8;
  await scrollTo('#saveBtn', 520);
  await at(15.5); await tap(page.locator('#saveBtn'));
  await at(17.3); await scrollTo('#logBody', 170);
  await at(19.2); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await at(21.2); marks.end = 21.2;

  await cdp.send('Page.stopScreencast');
  await page.waitForTimeout(200);
  fs.writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify({ t0, marks, frames }));
  console.log('frames', frames.length, 'first ts offset', (frames[0].ts - t0).toFixed(3));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
