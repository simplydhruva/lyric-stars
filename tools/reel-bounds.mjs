// The Reel layout checked with REAL glyph metrics: for every bundled font (and for the random font mixes), many lines, seeds
// and screen sizes, the page measures each letter with canvas measureText (actualBoundingBox*) and checks where the ink
// really is: non-hero letters inside the 5% safe margin and above the bottom (controls) zone, hero letters cut by no more
// than 30% each with at least 70% whole, nothing sitting on the hero's shadow.
//   node --experimental-websocket tools/reel-bounds.mjs [--verbose]
import { startSession, waitFor } from './lib/headless.mjs';

const verbose = process.argv.includes('--verbose');
const s = await startSession({ port: 5421, width: 1280, height: 720 });
const PAGE = `(async () => {
  const M = await import('/js/scenes/reel-motion.js');
  const F = await import('/js/scenes/reel-fonts.js');
  const K = await import('/js/scenes/kinetic-layout.js');
  await Promise.all(F.FONTS.map((f) => document.fonts.load('400 100px "' + f.family + '"', 'ABC')));
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d');
  const adv = new Map();
  const advanceOf = (id, ch) => { const k = id + ch; let v = adv.get(k); if (v === undefined) { g.font = F.weightOf(id) + ' 100px ' + F.familyOf(id); v = g.measureText(ch).width / 100; adv.set(k, v); } return v; };
  const metrics = (t, id, cap, key) => M.metricsOf(t, id, cap, advanceOf, key);
  const LINES = [
    'Love is a burning fire tonight', 'Dancing under the moon and the stars', 'Tears fall like rain on the ocean',
    'In the middle of the night when the stars are bright and the world is quiet and still and nobody knows my name at all',
    'Kiss me in the sunshine, dream of me', 'Hold me closer tonight', 'Burning', 'Oh', 'Yeah yeah yeah', 'I can\\u2019t stop',
    'Caf\\u00e9 \\u201c\\u00d1and\\u00fa\\u201d 100% don\\u2019t', 'Why', 'We will rock you', 'Everybody wants to rule the world',
  ];
  const SIZES = [[1920, 1080], [2560, 1440], [700, 900], [390, 844], [1280, 720]];
  const modes = F.FONT_IDS.map((id) => 'single:' + id).concat(['mix']);
  const out = { plans: 0, bad: [], worstCut: 0, minVis: 1, worstOverlap: 0, perFont: {} };
  const inkBox = (word, l) => {
    g.font = F.weightOf(l.font) + ' ' + l.size + 'px ' + F.familyOf(l.font);
    const m = g.measureText(l.ch);
    return [-l.adv / 2 - m.actualBoundingBoxLeft, word.cap / 2 - m.actualBoundingBoxAscent, -l.adv / 2 + m.actualBoundingBoxRight, word.cap / 2 + m.actualBoundingBoxDescent];
  };
  const corners = (word, l, grow, dx, dy) => {
    const [x0, y0, x1, y1] = inkBox(word, l);
    const lc = [[x0 - grow, y0 - grow], [x1 + grow, y0 - grow], [x1 + grow, y1 + grow], [x0 - grow, y1 + grow]];
    const cl = Math.cos(l.rot), sl = Math.sin(l.rot), cw = Math.cos(word.rot), sw = Math.sin(word.rot);
    const lx = l.x - word.width / 2 + l.adv / 2, ly = l.dy;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [px, py] of lc) {
      const rx = px * cl - py * sl + lx, ry = px * sl + py * cl + ly;
      const X = word.cx + rx * cw - ry * sw + (dx || 0), Y = word.cy + rx * sw + ry * cw + (dy || 0);
      if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
    }
    return [minX, minY, maxX, maxY];
  };
  for (const [w, h] of SIZES) {
    const botY = M.bottomLimit(h);
    for (const mode of modes) {
      const single = mode.startsWith('single:') ? mode.slice(7) : null;
      const pf = out.perFont[single || 'mix'] || (out.perFont[single || 'mix'] = { plans: 0, bad: 0 });
      for (let seed = 1; seed <= 4; seed++) {
        const picker = F.createFontPicker();
        picker.configure(seed * 7919, F.FONT_IDS, false, null);
        let prev = null;
        LINES.forEach((text, li) => {
          const words = text.split(' ').map((t, i) => ({ text: t, start: i * 400, end: i * 400 + 350 }));
          const heroIdx = K.loudestIndex(words);
          const picks = single ? words.map(() => single) : picker.lineFonts(li, words.length, heroIdx);
          const texts = words.map((wd, i) => F.caseOf(picks[i], wd.text));
          const plan = M.planLine({ w, h, li, seed: seed * 7919, words, texts, fonts: picks, prevCenter: prev && prev.words.length ? prev.heroCenter : null, prevKind: prev ? prev.kind : null, kind: M.kindOf(seed * 7919, li), metrics });
          prev = plan;
          out.plans++; pf.plans++;
          const tag = w + 'x' + h + ' ' + (single || 'mix') + ' seed' + seed + ' line' + li + ' ' + plan.kind;
          const fail = (m) => {
            pf.bad++;
            const c = m.replace(/[0-9]+/g, '#').split(' ').slice(0, 4).join(' ');
            out.bySize = out.bySize || {}; out.bySize[w + 'x' + h] = (out.bySize[w + 'x' + h] || 0) + 1;
            out.kinds = out.kinds || {};
            out.kinds[c] = (out.kinds[c] || 0) + 1;
            if (out.bad.length < 60) out.bad.push(tag + ': ' + m);
          };
          const heroW = plan.words[plan.hero];
          const vertical = Math.abs(Math.sin(heroW.rot)) > 0.7;
          let whole = 0, cutWorst = 0;
          for (const l of heroW.letters) {
            const b = corners(heroW, l, 0);
            const lo = vertical ? b[1] : b[0], hi = vertical ? b[3] : b[2], max = vertical ? h : w;
            const cut = (Math.max(0, -lo) + Math.max(0, hi - max)) / Math.max(1e-6, hi - lo);
            if (cut < 0.02) whole++;
            cutWorst = Math.max(cutWorst, cut);
            const a = vertical ? [b[0], b[2], w] : [b[1], b[3], botY];
            if (a[0] < -1 || a[1] > a[2] + 1) fail('hero letter ' + l.ch + ' leaves the screen across its axis ' + a.map(Math.round));
          }
          const vis = whole / heroW.letters.length;
          out.worstCut = Math.max(out.worstCut, cutWorst); out.minVis = Math.min(out.minVis, vis);
          if (cutWorst > 0.3) fail('hero letter cut ' + Math.round(cutWorst * 100) + '%');
          if (vis < 0.7) fail('hero letters whole ' + Math.round(vis * 100) + '%');
          for (const wd of plan.words) {
            if (wd === heroW) continue;
            for (const l of wd.letters) {
              // the letter itself must be inside the safe margin and above the controls zone; its black outline (cap*0.085)
              // may reach into the margin but must stay on screen and no more than 1% of the height into the controls zone
              const tol = Math.min(w, h) * 0.012 + 1; // the 5% margin is kept to within 1.2% of the smaller side
              const b = corners(wd, l, 0), o = corners(wd, l, wd.cap * 0.085);
              if (b[0] < w * M.SAFE - tol || b[2] > w * (1 - M.SAFE) + tol || b[1] < h * M.SAFE - tol || b[3] > botY + tol || o[0] < 0 || o[1] < 0 || o[2] > w || o[3] > botY + h * 0.01) { fail('"' + wd.text + '" ink ' + b.map(Math.round) + ' (outline ' + o.map(Math.round) + ')' + ' outside safe zone ' + [w * M.SAFE, h * M.SAFE, w * (1 - M.SAFE), botY].map(Math.round)); break; }
            }
          }
          const cap = heroW.cap;
          for (const hl of heroW.letters) {
            const sb = corners(heroW, hl, cap * 0.085, cap * 0.07, cap * 0.085);
            for (const wd of plan.words) {
              if (wd === heroW || wd.i < plan.hero) continue; // earlier words sit under the hero by design
              for (const l of wd.letters) {
                const b = corners(wd, l, 0);
                const ox = Math.min(sb[2], b[2]) - Math.max(sb[0], b[0]);
                const oy = Math.min(sb[3], b[3]) - Math.max(sb[1], b[1]);
                if (ox > 0 && oy > 0) {
                  const d = Math.min(ox, oy);
                  out.worstOverlap = Math.max(out.worstOverlap, d);
                  if (d > 1.5) fail('"' + wd.text + '" letter ' + l.ch + ' on the hero shadow by ' + Math.round(d) + ' px');
                }
              }
            }
          }
        });
      }
    }
  }
  return JSON.stringify(out);
})()`;
try {
  await s.goto(`${s.base}/?demo=&title=B&artist=B&duration=60&paused=&scene=reel`);
  await waitFor('page', () => s.js(`!!document.getElementById('card')`), 15000);
  const r = JSON.parse(await s.js(PAGE));
  console.log(`plans checked: ${r.plans}, worst hero letter cut ${(r.worstCut * 100).toFixed(1)}%, fewest whole hero letters ${(r.minVis * 100).toFixed(0)}%, worst shadow overlap ${r.worstOverlap.toFixed(1)} px`);
  console.log('problems by screen size:', JSON.stringify(r.bySize || {}));
  console.log('problem kinds:', JSON.stringify(r.kinds || {}));
  console.log('fonts checked:', Object.keys(r.perFont).join(', '));
  console.log(r.bad.length ? `${r.bad.length}+ problems:` : 'no problems');
  for (const b of r.bad.slice(0, verbose ? 60 : 15)) console.log('  ' + b);
  const bad = Object.entries(r.perFont).filter(([, v]) => v.bad);
  if (bad.length) console.log('problems per font:', bad.map(([k, v]) => `${k} ${v.bad}`).join(', '));
  if (s.logs.length) console.log('console errors:', s.logs.join(' | '));
  process.exitCode = r.bad.length ? 1 : 0;
} finally {
  await s.cleanup();
}
