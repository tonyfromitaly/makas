import './fonts.js';
import './style.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import { COPY, PANELS } from './copy.js';

gsap.registerPlugin(ScrollTrigger, SplitText);
document.documentElement.classList.add('js');

const BRAND = __BRAND__;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => BRAND[k] ?? '');

// ---------------------------------------------------------------- language
const stored = (() => {
  try {
    return localStorage.getItem('usta.lang');
  } catch {
    return null;
  }
})();
let lang = stored || ((navigator.language || 'tr').toLowerCase().startsWith('tr') ? 'tr' : 'en');
const original = new Map($$('[data-k]').map((el) => [el, el.innerHTML]));
const originalTitle = document.title;

function applyLang() {
  document.documentElement.lang = lang;
  for (const [el, html] of original) {
    const k = el.dataset.k;
    el.innerHTML = lang === 'tr' ? html : fill(COPY.en[k] ?? html);
  }
  document.title = lang === 'tr' ? originalTitle : fill(COPY.en.docTitle);
  $('#lang').textContent = lang === 'tr' ? 'EN' : 'TR';
  renderPanel(currentType, false);
}

$('#lang').addEventListener('click', () => {
  lang = lang === 'tr' ? 'en' : 'tr';
  try {
    localStorage.setItem('usta.lang', lang);
  } catch {
    /* private mode */
  }
  splits.forEach((s) => s.revert());
  applyLang();
  splitHeadings(false);
});

// ---------------------------------------------------------------- smooth scroll
let lenis = null;
if (!reduced) {
  lenis = new Lenis({ duration: 1.1, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
$$('a[href^="#"]').forEach((a) =>
  a.addEventListener('click', (e) => {
    const target = $(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(target, { offset: -72 });
    else target.scrollIntoView();
    history.replaceState(null, '', a.getAttribute('href'));
  }),
);

const nav = $('#nav');
const onScroll = () => nav.classList.toggle('is-scrolled', scrollY > 24);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---------------------------------------------------------------- headings
let splits = [];
function splitHeadings(animate) {
  splits = $$('.h2').map((h) => new SplitText(h, { type: 'lines', linesClass: 'split-line', mask: 'lines' }));
  if (!animate || reduced) return;
  splits.forEach((s) => {
    gsap.from(s.lines, {
      yPercent: 105,
      duration: 0.9,
      ease: 'power3.out',
      stagger: 0.08,
      scrollTrigger: { trigger: s.lines[0]?.parentElement ?? s.elements[0], start: 'top 82%', once: true },
    });
  });
}

// ---------------------------------------------------------------- the fogged mirror
/**
 * A shop mirror misted by hot towels. The app shows through where it is wiped (pointer or finger)
 * and the mist slowly returns. Drawn on canvas: sharp layer, blurred copy masked by the mist,
 * and a condensation haze with droplets. Reduced motion: no mist, no cycling.
 */
function fogMirror(canvas, urls) {
  const ctx = canvas.getContext('2d');
  const mist = document.createElement('canvas');
  const mctx = mist.getContext('2d');
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');
  const haze = document.createElement('canvas');
  const hctx = haze.getContext('2d');
  const images = urls.map((u) => Object.assign(new Image(), { src: u, decoding: 'async' }));
  const blurred = [];
  let W = 0,
    H = 0,
    dpr = 1,
    current = 0,
    fadeFrom = -1,
    fadeT = 1,
    last = null,
    running = false,
    lastTick = 0;
  const MIST_SCALE = 0.25;

  function cover(img, c, w, h) {
    // fit by width, keep the top (the app's header) in view
    const scale = w / img.naturalWidth;
    const sh = Math.min(img.naturalHeight, h / scale);
    c.drawImage(img, 0, 0, img.naturalWidth, sh, 0, 0, w, sh * scale);
  }

  function blurOf(img) {
    // Cheap, universal blur: shrink a lot, scale back up with smoothing.
    const small = document.createElement('canvas');
    small.width = Math.max(8, Math.round(W / 14));
    small.height = Math.max(8, Math.round(H / 14));
    cover(img, small.getContext('2d'), small.width, small.height);
    const big = document.createElement('canvas');
    big.width = W;
    big.height = H;
    const b = big.getContext('2d');
    b.imageSmoothingQuality = 'high';
    b.filter = 'saturate(0.6) brightness(1.08)';
    b.drawImage(small, 0, 0, W, H);
    return big;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const nd = Math.min(devicePixelRatio || 1, 2);
    const nW = Math.round(r.width * nd);
    const nH = Math.round(r.height * nd);
    // Mobile browsers fire resize while the address bar moves; the mirror itself doesn't change size.
    if (!nW || !nH || (nW === W && nH === H)) return;
    dpr = nd;
    W = nW;
    H = nH;
    canvas.width = layer.width = haze.width = W;
    canvas.height = layer.height = haze.height = H;
    // keep what was already wiped, scaled to the new size
    const old = mist.width ? Object.assign(document.createElement('canvas'), { width: mist.width, height: mist.height }) : null;
    if (old) old.getContext('2d').drawImage(mist, 0, 0);
    mist.width = Math.round(W * MIST_SCALE);
    mist.height = Math.round(H * MIST_SCALE);
    mctx.fillStyle = '#fff';
    mctx.fillRect(0, 0, mist.width, mist.height);
    if (old) {
      mctx.globalCompositeOperation = 'destination-in';
      mctx.drawImage(old, 0, 0, mist.width, mist.height);
      mctx.globalCompositeOperation = 'source-over';
    }
    // condensation: a pale cool haze with tiny droplets
    hctx.clearRect(0, 0, W, H);
    hctx.fillStyle = 'rgba(222, 233, 234, 0.55)';
    hctx.fillRect(0, 0, W, H);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < (W * H) / 900; i++) {
      const x = rand() * W,
        y = rand() * H,
        rr = (0.6 + rand() * 1.8) * dpr;
      hctx.fillStyle = `rgba(255,255,255,${0.25 + rand() * 0.35})`;
      hctx.beginPath();
      hctx.arc(x, y, rr, 0, Math.PI * 2);
      hctx.fill();
    }
    blurred.length = 0;
    images.forEach((img, i) => img.complete && img.naturalWidth && (blurred[i] = blurOf(img)));
  }

  function wipe(x, y, radius = 0.11) {
    const r = radius * mist.width;
    const g = mctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.85)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    mctx.globalCompositeOperation = 'destination-out';
    mctx.fillStyle = g;
    mctx.beginPath();
    mctx.arc(x, y, r, 0, Math.PI * 2);
    mctx.fill();
    mctx.globalCompositeOperation = 'source-over';
  }

  function stroke(x0, y0, x1, y1, radius) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(d / 3));
    for (let i = 0; i <= steps; i++) wipe(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, radius);
  }

  function draw(dt) {
    if (!W) return;
    // mist creeps back
    // half-life of a wiped patch is ~16 s
    mctx.fillStyle = `rgba(255,255,255,${Math.min(0.004, dt * 0.00004)})`;
    mctx.fillRect(0, 0, mist.width, mist.height);
    ctx.clearRect(0, 0, W, H);
    const show = (i, a) => {
      if (!images[i].complete) return;
      ctx.globalAlpha = a;
      cover(images[i], ctx, W, H);
      lctx.globalCompositeOperation = 'source-over';
      if (blurred[i]) {
        lctx.globalAlpha = a;
        lctx.drawImage(blurred[i], 0, 0);
      }
    };
    lctx.clearRect(0, 0, W, H);
    if (fadeFrom >= 0 && fadeT < 1) show(fadeFrom, 1 - fadeT);
    show(current, fadeFrom >= 0 ? fadeT : 1);
    ctx.globalAlpha = 1;
    lctx.globalAlpha = 1;
    lctx.drawImage(haze, 0, 0);
    // keep only the misted parts of the blurred layer + haze
    lctx.globalCompositeOperation = 'destination-in';
    lctx.imageSmoothingEnabled = true;
    lctx.drawImage(mist, 0, 0, W, H);
    lctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(layer, 0, 0);
  }

  function loop(t) {
    if (!running) return;
    const dt = lastTick ? t - lastTick : 16;
    lastTick = t;
    if (fadeT < 1) fadeT = Math.min(1, fadeT + dt / 900);
    draw(dt);
    requestAnimationFrame(loop);
  }

  const toMist = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * mist.width, ((e.clientY - r.top) / r.height) * mist.height];
  };
  canvas.addEventListener('pointermove', (e) => {
    const p = toMist(e);
    if (last) stroke(last[0], last[1], p[0], p[1]);
    else wipe(p[0], p[1]);
    last = p;
    const r = canvas.getBoundingClientRect();
    canvas.parentElement.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`);
    canvas.parentElement.style.setProperty('--gy', `${((e.clientY - r.top) / r.height) * 100}%`);
  });
  canvas.addEventListener('pointerleave', () => (last = null));
  canvas.addEventListener('pointerdown', (e) => (last = toMist(e)));

  function next() {
    fadeFrom = current;
    current = (current + 1) % images.length;
    fadeT = 0;
  }

  /** A towel wipes across the glass: an S on opening, a single pass when the picture changes. */
  function towel(pts = [
    [0.15, 0.32],
    [0.85, 0.36],
    [0.2, 0.55],
    [0.82, 0.62],
    [0.3, 0.78],
  ], duration = 1.6, delay = 0.5) {
    const state = { p: 0 };
    let prev = null;
    gsap.to(state, {
      p: 1,
      duration,
      delay,
      ease: 'power2.inOut',
      onUpdate() {
        const f = state.p * (pts.length - 1);
        const i = Math.min(pts.length - 2, Math.floor(f));
        const t = f - i;
        const x = (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t) * mist.width;
        const y = (pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t) * mist.height;
        if (prev) stroke(prev[0], prev[1], x, y, 0.16);
        prev = [x, y];
      },
    });
  }

  Promise.all(images.map((img) => img.decode().catch(() => null))).then(() => {
    resize();
    if (reduced) {
      mctx.clearRect(0, 0, mist.width, mist.height);
      draw(0);
      return;
    }
    new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      lastTick = 0;
      if (running) requestAnimationFrame(loop);
    }).observe(canvas);
    towel();
    setInterval(() => {
      if (!running) return;
      next();
      // keep the app readable for visitors who never touch the mirror
      const y = 0.25 + Math.random() * 0.5;
      towel([
        [0.1, y],
        [0.9, y + 0.06],
      ], 1.1, 0.2);
    }, 4800);
  });
  addEventListener('resize', () => {
    resize();
    if (reduced) draw(0);
  });
}

fogMirror($('#mirror-canvas'), ['/shots/barber-today.webp', '/shots/barber-assistant.webp', '/shots/salon-today.webp', '/shots/barber-books.webp']);

// ---------------------------------------------------------------- who it is for
let currentType = 'barber';
const panel = $('#panel');

function renderPanel(type, transition = true) {
  const d = PANELS[type];
  const t = d[lang] ?? d.tr;
  const update = () => {
    currentType = type;
    panel.dataset.type = type;
    $('#panel-photo').src = d.photo;
    $('#panel-photo').alt = t.photoAlt;
    $('#panel-shot').src = d.shot;
    $('#panel-shot').alt = '';
    $('#panel-title').textContent = fill(t.title);
    $('#panel-points').innerHTML = t.points.map(([b, s]) => `<li><b>${b}</b><span>${fill(s)}</span></li>`).join('');
    $('#panel-menu').innerHTML = (t.menu ?? d.menu)
      .map((m) => (Array.isArray(m) ? `<li>${m[0]}<b>$${m[1]}</b></li>` : `<li>${m}</li>`))
      .join('');
    $('#panel-next').innerHTML = type === 'next' ? (t.menu ?? d.menu).map((m) => `<span>${m}</span>`).join('') : '';
    const link = $('#panel-link');
    link.href = d.link.startsWith('#') ? d.link : `${BRAND.demoUrl}${d.link}`;
    link.firstElementChild.textContent = t.linkLabel;
    $$('[role="tab"]').forEach((b) => {
      const on = b.dataset.type === type;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) panel.setAttribute('aria-labelledby', b.id);
    });
    moveRail();
    swapStoryShots(d.story);
  };
  if (transition && document.startViewTransition && !reduced) document.startViewTransition(update);
  else update();
}

function moveRail() {
  const on = $('[role="tab"][aria-selected="true"]');
  const rail = $('.tab-rail');
  if (!on || !rail) return;
  rail.style.width = `${on.offsetWidth}px`;
  rail.style.transform = `translateX(${on.offsetLeft}px)`;
}

const tabs = $$('[role="tab"]');
tabs.forEach((b, i) => {
  b.addEventListener('click', () => b.dataset.type !== currentType && renderPanel(b.dataset.type));
  b.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const n = tabs[(i + dir + tabs.length) % tabs.length];
    n.focus();
    renderPanel(n.dataset.type);
  });
});
addEventListener('resize', moveRail);

// ---------------------------------------------------------------- product story
function swapStoryShots(kind) {
  $$('.phone-shot').forEach((img) => (img.src = `/shots/${kind}-${img.dataset.shot}.webp`));
  $$('.beat-shot').forEach((img, i) => (img.src = `/shots/${kind}-${['assistant', 'today', 'books', 'clients'][i]}.webp`));
}
const beats = $$('.beat');
function activate(beat) {
  beats.forEach((b) => b.classList.toggle('is-active', b === beat));
  $$('.phone-shot').forEach((img) => img.classList.toggle('is-on', img.dataset.shot === beat.dataset.shot));
}
activate(beats[0]);
beats.forEach((b) =>
  ScrollTrigger.create({ trigger: b, start: 'top 55%', end: 'bottom 45%', onToggle: (self) => self.isActive && activate(b) }),
);

// ---------------------------------------------------------------- demo request (Netlify Forms)
const form = $('#demo-form');
const done = () => {
  $$('.field, .field-row, .consent, #form-submit, .form-error', form).forEach((el) => (el.hidden = true));
  $('#form-done').hidden = false;
};
if (new URLSearchParams(location.search).has('gonderildi')) done();
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#form-error');
  err.textContent = '';
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const btn = $('#form-submit');
  btn.disabled = true;
  try {
    const res = await fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString(),
    });
    if (!res.ok) throw new Error(String(res.status));
    done();
  } catch {
    err.textContent = fill((COPY[lang] ?? COPY.tr).formError);
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------- opening sequence
applyLang();
document.fonts.ready.then(() => {
  splitHeadings(true);
  if (reduced) return;
  const title = new SplitText('.hero-title', { type: 'words', mask: 'words' });
  gsap
    .timeline({ defaults: { ease: 'power3.out' } })
    .from(title.words, { yPercent: 110, duration: 1, stagger: 0.08 })
    .from('.hero-lead, .hero-actions, .hero-note', { y: 18, opacity: 0, duration: 0.7, stagger: 0.08 }, '-=0.6')
    .from('.mirror-wrap', { y: 30, opacity: 0, duration: 1 }, 0.1);
  moveRail();
});
