// DOM side of the experience: language, navigation, scroll → progress mapping,
// stage cards, HUD, reveal-on-scroll, project drawings and the enquiry form.
import { STRINGS } from './i18n.js';
import { CONFIG } from './config.js';
import { STAGES, stageIndex } from './timeline.js';

const JOURNEY_SCREENS = 11; // journey height in viewport heights
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* storage unavailable (private mode) — language just won't persist */ }
  return null;
}

export function createUI() {
  const body = document.body;
  const journey = $('#journey');
  const hero = $('#hero');
  const stages = $$('.stage');
  const nav = $('#nav');
  const rail = $('#rail');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------ language
  let lang = store('bsg-lang');
  if (lang !== 'bg' && lang !== 'en') {
    lang = CONFIG.defaultLang === 'auto'
      ? ((navigator.languages || [navigator.language]).some((l) => /^bg\b/i.test(l || '')) ? 'bg' : 'en')
      : CONFIG.defaultLang;
  }
  const t = (key) => STRINGS[lang][key] ?? STRINGS.en[key] ?? '';

  function applyLang(next) {
    lang = next;
    document.documentElement.lang = lang;
    document.title = t('meta.title');
    $$('[data-i18n]').forEach((el) => {
      const v = t(el.dataset.i18n);
      if (v.includes('<br>')) el.innerHTML = v; else el.textContent = v;
    });
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    buildRail();
    lastHud = '';
    store('bsg-lang', lang);
  }
  $$('.lang button').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.lang)));

  // ------------------------------------------------------------ nav
  const burger = $('#burger');
  burger.addEventListener('click', () => {
    const open = !nav.classList.contains('is-open');
    nav.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
  });
  $$('.nav__links a').forEach((a) => a.addEventListener('click', () => {
    nav.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
  }));

  // ------------------------------------------------------------ journey geometry
  let vh = window.innerHeight, vw = window.innerWidth, journeyTop = 0, span = 1;
  const isMobile = () => vw <= 900;
  // where each card sits centred on screen; the last one clears before the final hero frame
  const stageMid = (i) => (i === 0 ? 0.07 : i === STAGES.length - 1 ? 0.935 : (STAGES[i].from + STAGES[i].to) / 2);

  function layout() {
    if (body.classList.contains('no-webgl')) { journey.style.height = ''; return; }
    journey.style.height = `${Math.round(JOURNEY_SCREENS * vh)}px`;
    journeyTop = journey.getBoundingClientRect().top + window.scrollY;
    span = Math.max(1, journey.offsetHeight - vh);
    const anchor = isMobile() ? 0.68 : 0.5;
    stages.forEach((el, i) => { el.style.top = `${Math.round(stageMid(i) * span + vh * anchor)}px`; });
  }
  window.addEventListener('resize', () => {
    // mobile browsers resize the viewport while the URL bar hides; ignore small height-only changes
    const w = window.innerWidth, h = window.innerHeight;
    if (w === vw && Math.abs(h - vh) < 120) return;
    vw = w; vh = h;
    layout();
  });

  function scrollToProgress(p) {
    window.scrollTo({ top: journeyTop + p * span + 2, behavior: reduced ? 'auto' : 'smooth' });
  }
  $$('a[href^="#stage-"]').forEach((a) => a.addEventListener('click', (e) => {
    if (body.classList.contains('no-webgl')) return;
    e.preventDefault();
    scrollToProgress(stageMid(Number(a.getAttribute('href').split('-')[1])));
  }));
  $('a[href="#journey"]').addEventListener('click', (e) => {
    if (body.classList.contains('no-webgl')) return;
    e.preventDefault();
    scrollToProgress(stageMid(0));
  });

  function buildRail() {
    rail.innerHTML = '';
    STAGES.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span></span><i></i>`;
      b.firstChild.textContent = `${String(i + 1).padStart(2, '0')} ${t(`stage.${i}.title`)}`;
      b.setAttribute('aria-label', t(`stage.${i}.title`));
      b.addEventListener('click', () => scrollToProgress(stageMid(i)));
      rail.appendChild(b);
    });
    lastStage = -1;
  }

  // ------------------------------------------------------------ per-frame UI
  const hud = { stage: $('#hudStage'), elev: $('#hudElev'), floors: $('#hudFloors'), pct: $('#hudPct'), bar: $('#hudBar') };
  let lastStage = -1, lastHud = '';

  function targetProgress() {
    return Math.min(1, Math.max(0, (window.scrollY - journeyTop) / span));
  }
  function journeyVisible() {
    return window.scrollY < journeyTop + journey.offsetHeight;
  }

  function onScroll() {
    const y = window.scrollY;
    nav.classList.toggle('is-solid', y > 40);
    body.classList.toggle('at-top', y < 40);
    body.classList.toggle('past-journey', y > journeyTop + span + vh * 0.15);
    // hero fades and drifts as the first metres are scrolled
    const k = Math.min(1, Math.max(0, (y - journeyTop) / (vh * 0.55)));
    hero.style.opacity = String(1 - k);
    hero.style.transform = `translateY(${-k * 40}px)`;
    hero.style.visibility = k >= 1 ? 'hidden' : 'visible';
    const p = targetProgress();
    stages.forEach((el, i) => {
      const s = STAGES[i];
      el.classList.toggle('is-active', p >= s.from + (i === 0 ? 0.03 : 0.004) && p <= (i === STAGES.length - 1 ? 0.975 : s.to - 0.004));
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /** info: { p, elevation, storeys, totalStoreys } — called from the render loop. */
  function update(info) {
    const i = stageIndex(info.p);
    if (i !== lastStage) {
      [...rail.children].forEach((b, k) => {
        b.classList.toggle('is-active', k === i);
        b.classList.toggle('is-done', k < i);
      });
      lastStage = i;
    }
    const e = info.elevation;
    const elev = `${e > 0.005 ? '+' : e < -0.005 ? '−' : '±'}${Math.abs(e).toFixed(2)} m`;
    const key = `${i}|${elev}|${info.storeys}|${Math.round(info.p * 100)}|${lang}`;
    if (key === lastHud) return;
    lastHud = key;
    hud.stage.textContent = `${String(i + 1).padStart(2, '0')} — ${t(`stage.${i}.title`)}`;
    hud.elev.textContent = elev;
    hud.floors.textContent = `${info.storeys} / ${info.totalStoreys}`;
    hud.pct.textContent = `${Math.round(info.p * 100)}%`;
    hud.bar.style.width = `${(info.p * 100).toFixed(1)}%`;
  }

  // ------------------------------------------------------------ reveal on scroll
  $$('.section .eyebrow, .section__title, .lead, .stat, .card, .project, .contact__info, .form').forEach((el) => el.classList.add('reveal'));
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    $$('.reveal').forEach((el) => io.observe(el));
  } else $$('.reveal').forEach((el) => el.classList.add('is-in'));

  // ------------------------------------------------------------ project drawings
  $$('.project__art').forEach((el) => { el.innerHTML = elevationSVG(Number(el.dataset.floors), el.dataset.variant); });

  // ------------------------------------------------------------ contact
  const emailLink = $('#emailLink');
  if (CONFIG.email) { emailLink.textContent = CONFIG.email; emailLink.href = `mailto:${CONFIG.email}`; } else $('#rowEmail').hidden = true;
  if (CONFIG.phone) {
    $('#rowPhone').hidden = false;
    $('#phoneLink').textContent = CONFIG.phone;
    $('#phoneLink').href = `tel:${CONFIG.phone.replace(/[^\d+]/g, '')}`;
  }
  const form = $('#contactForm');
  const note = $('#formNote');
  $$('[data-pick]').forEach((a) => a.addEventListener('click', () => { form.interest.value = a.dataset.pick; }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const name = (d.name || '').trim(), phone = (d.phone || '').trim(), email = (d.email || '').trim();
    if (!name || (!phone && !/^\S+@\S+\.\S+$/.test(email))) {
      note.textContent = t('form.err');
      note.classList.add('is-error');
      return;
    }
    note.classList.remove('is-error');
    const interest = d.interest === 'general' ? t('form.general') : t(d.interest);
    const subject = `${interest} — ${name}`;
    const bodyText = [`${t('form.name')}: ${name}`, phone && `${t('form.phone')}: ${phone}`, email && `${t('form.email')}: ${email}`, `${t('form.interest')}: ${interest}`, '', d.message || '']
      .filter((x) => x !== '' && x !== undefined && x !== false).join('\n');
    if (!CONFIG.email) return;
    window.location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
    note.textContent = `${t('form.ok')} ${CONFIG.email}`;
  });

  // ------------------------------------------------------------ loader / fallback
  const loaderBar = $('#loaderBar');
  function setLoad(x) { loaderBar.style.width = `${Math.round(x * 100)}%`; }
  function ready() { body.classList.remove('is-loading'); }
  function noWebGL() {
    body.classList.add('no-webgl');
    stages.forEach((el) => { el.style.top = ''; el.classList.add('is-active'); });
    layout();
    ready();
  }

  applyLang(lang);
  layout();
  onScroll();

  return { targetProgress, journeyVisible, update, setLoad, ready, noWebGL, layout, isMobile, reduced };
}

// Architectural elevation line drawings for the project cards.
function elevationSVG(floors, variant) {
  const W = 400, H = 320, base = 290;
  const fh = Math.min(22, 210 / floors);
  const bw = variant === 'b' ? 250 : variant === 'c' ? 170 : 210;
  const x0 = (W - bw) / 2, top = base - floors * fh;
  const cols = variant === 'b' ? 8 : variant === 'c' ? 5 : 6;
  const cw = bw / cols;
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`;
  s += `<defs><linearGradient id="g${variant}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9a15f" stop-opacity=".9"/><stop offset="1" stop-color="#c9a15f" stop-opacity=".35"/></linearGradient></defs>`;
  s += `<g fill="none" stroke="rgba(236,231,221,.08)" stroke-width="1">`;
  for (let x = 20; x < W; x += 20) s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
  for (let y = 10; y < H; y += 20) s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;
  s += `</g><g fill="none" stroke="url(#g${variant})" stroke-width="1.2">`;
  s += `<line x1="24" y1="${base}" x2="${W - 24}" y2="${base}"/>`;
  s += `<rect x="${x0}" y="${top}" width="${bw}" height="${base - top}"/>`;
  for (let f = 1; f < floors; f++) s += `<line x1="${x0}" y1="${base - f * fh}" x2="${x0 + bw}" y2="${base - f * fh}" stroke-opacity=".75"/>`;
  for (let f = 1; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      if (variant === 'c' && (c + f) % 3 === 0) continue;
      const wx = x0 + c * cw + cw * 0.18, wy = base - (f + 1) * fh + fh * 0.22;
      s += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${(cw * 0.64).toFixed(1)}" height="${(fh * 0.56).toFixed(1)}" stroke-opacity=".5"/>`;
    }
    if (variant !== 'c' && f % 2 === 1) s += `<line x1="${x0 - 8}" y1="${base - f * fh}" x2="${x0 + bw * 0.4}" y2="${base - f * fh}" stroke-width="2"/>`;
  }
  // ground floor storefront + entrance
  s += `<rect x="${W / 2 - 18}" y="${base - fh * 0.85}" width="36" height="${fh * 0.85}"/>`;
  if (variant === 'a' || variant === 'c') s += `<rect x="${x0 + bw * 0.2}" y="${top - fh}" width="${bw * 0.6}" height="${fh}"/>`;
  s += `<line x1="${x0 - 22}" y1="${base}" x2="${x0 - 22}" y2="${base - 34}"/><circle cx="${x0 - 22}" cy="${base - 46}" r="13"/>`;
  s += `<line x1="${x0 + bw + 26}" y1="${base}" x2="${x0 + bw + 26}" y2="${base - 28}"/><circle cx="${x0 + bw + 26}" cy="${base - 38}" r="10"/>`;
  s += `</g></svg>`;
  return s;
}
