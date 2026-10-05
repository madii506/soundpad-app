// Soundpad: the page. The hero you can press, the studio, the chart, the radio, the listeners, the liner notes.
(function () {
  'use strict';
  const C = window.Core, $ = C.$, $$ = C.$$, esc = C.esc;
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3.1 1.7-2 3.2-3.1 5.3-3.1 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>';
  const LABEL = { alive: 'live', asleep: 'quiet', dead: 'dead', ascended: 'graduated', unborn: 'not live yet' };
  const STYLES = ['trap', 'house', 'lofi', 'chip'], SL = { trap: 'trap', house: 'house', lofi: 'lo-fi', chip: '8-bit' };
  const COL = { trap: '#ff5c1f', house: '#2fe6c8', lofi: '#ff8fb1', chip: '#b6ff3b' };
  const S = { board: null, sort: 'hot', liked: C.store.get('sp-liked') || {}, style: 'trap', seed: Snd.newSeed(), kid: new Map(), radio: false, born: 0 };
  const THEME = { symbol: 'SOUNDPAD', style: 'trap', seed: 'soundpad', root: 5, prog: [5, 6, 0, 6], title: 'every ticker has a sound.' };
  const fmt = n => (n == null ? '0' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
  const pushedNow = k => k.pushed_at && Date.now() - new Date(k.pushed_at) < 36e5;
  const coins = () => (S.board && S.board.coins) || [];
  const coinOf = m => coins().find(k => k.mint === m);
  const kOf = m => { const c = S.kid.get(m); return (c && c.j && c.j.coin) || coinOf(m); };
  const usd = k => (k.mcap_sol != null && S.board && S.board.solUsd ? C.usd(k.mcap_sol * S.board.solUsd) : '—');
  const optOf = (k, drop) => ({ symbol: k.symbol, style: STYLES.includes(k.look) ? k.look : 'trap', seed: drop ? k.seed + ':' + drop : k.seed, title: k.caption || '' });
  const symOf = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const hashN = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const anyOpt = b => { const sym = symOf(b.symbol) || 'COIN'; return { symbol: sym, style: STYLES[hashN(b.mint) % 4], seed: b.mint, title: 'just born on pump.fun' }; };
  const noteNames = o => { const d = Snd.describe(o); return d.notes; };
  // famous tickers, by their real addresses; their pictures come from Jupiter's token list at runtime
  const CLASSICS = [['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'BONK'], ['EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 'WIF'], ['7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', 'POPCAT'], ['ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', 'MOODENG'], ['CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', 'GOAT'], ['2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', 'PNUT'], ['9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', 'FARTCOIN'], ['2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', 'PENGU']];
  const classicOpt = (mint, sym) => ({ symbol: sym, style: STYLES[hashN(mint) % 4], seed: mint, title: 'what $' + sym + ' sounds like' });
  const pic = url => '/api/logos?img=' + encodeURIComponent(url);     // every picture comes through this site, small and cached
  // a record: the coin's own picture is the label (or its pad, when there's no picture)
  function recEl(cls) { const d = document.createElement('div'); d.className = 'rec' + (cls ? ' ' + cls : ''); d.innerHTML = '<span class="lbl"></span>'; return d; }
  function label(el, url, o) {
    const l = el.querySelector('.lbl'); l.style.setProperty('--c', COL[o.style] || COL.trap); l.innerHTML = '';
    const pad = () => { l.innerHTML = ''; Snd.ready().then(() => l.appendChild(Snd.coverCanvas(o, 160))); };
    if (!url) return pad();
    const im = new Image(); im.alt = ''; im.decoding = 'async'; im.onerror = pad; im.src = pic(url); l.appendChild(im);
  }
  // real token pictures: Jupiter's token list (it lists new pump.fun coins within seconds), read in the browser
  async function jup(mints) {
    const ok = t => t && typeof t.icon === 'string' && /^https:\/\//.test(t.icon) ? t.icon : null;
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
      const a = await fetch('https://lite-api.jup.ag/tokens/v2/search?query=' + mints.join(','), { signal: ctl.signal }).then(r => r.json()); clearTimeout(tm);
      const out = {}; for (const t of Array.isArray(a) ? a : []) if (t && t.id) out[t.id] = { symbol: String(t.symbol || ''), name: String(t.name || ''), icon: ok(t) }; return out;
    } catch { const j = await C.get('/api/logos?mints=' + mints.join(',')).catch(() => null); return (j && j.ok && j.tokens) || {}; }
  }
  const waiting = new Map();                        // mint → { o, recs, tries }: new coins still waiting for their picture
  const pics = new Map();
  function wantPic(mint, o, rec) { rec.dataset.m = mint; if (pics.has(mint)) { label(rec, pics.get(mint), o); return; } const w = waiting.get(mint) || { o, recs: [], tries: 0 }; w.recs.push(rec); waiting.set(mint, w); }
  setInterval(async () => {
    if (document.hidden || !waiting.size) return;
    const ms = [...waiting.keys()].slice(-20), got = await jup(ms);
    ms.forEach(m => { const w = waiting.get(m); if (!w) return; const t = got[m]; if (t && t.icon) { pics.set(m, t.icon); w.recs.forEach(r => { if (r.isConnected && r.dataset.m === m) label(r, t.icon, w.o); }); waiting.delete(m); } else if (++w.tries > 6) waiting.delete(m); });
  }, 7000);

  // ---------- pads ----------
  function pads(el, sym, o, lit) {
    const letters = [...symOf(sym)], names = letters.length ? noteNames(Object.assign({}, o, { symbol: letters.join('') })) : [];
    el.innerHTML = letters.map((ch, i) => `<button type="button" class="pad${lit ? ' lit' : ''}" data-i="${i}" data-n="${names[i] || ''}" aria-label="${ch}, the note ${names[i] || ''}">${ch}</button>`).join('');
    return el;
  }
  function flash(el, i, ms) { const b = el && el.children[i]; if (!b) return; b.classList.add('hit'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('hit'), ms || 170); }
  function pressable(el, getO) {
    el.addEventListener('pointerdown', e => {
      const b = e.target.closest('.pad'); if (!b || !el.contains(b)) return;
      const o = getO(), i = +b.dataset.i, ns = Snd.spell(o.symbol, Snd.genes(o).root);
      try { Snd.hit(ns[i], o.style); } catch (err) { C.toast(C.human(err)); }
      flash(el, i, 200);
    });
  }

  // ---------- playing: one track at a time, its pads and spectrum follow it ----------
  let VIEW = null, raf = 0;
  const lows = new Uint8Array(1024);
  function drawViz(cv, an, col) {
    const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (!w || !h) return; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
    const n = 64, bw = w / n; let d = null;
    if (an) { d = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(d); }
    for (let i = 0; i < n; i++) {
      let m = 0; if (d) { const lo = Math.floor(Math.pow(i / n, 2) * 340) + 1, hi = Math.floor(Math.pow((i + 1) / n, 2) * 340) + 2; for (let k = lo; k < hi; k++) m = Math.max(m, d[k] || 0); }
      const bh = Math.max(2 * dpr, (m / 255) * h * 0.9);
      g.fillStyle = m ? col : '#2a2a2f'; g.globalAlpha = m ? 0.35 + 0.65 * (m / 255) : 1;
      g.fillRect(i * bw + bw * 0.18, (h - bh) / 2, bw * 0.64, bh);
    }
    g.globalAlpha = 1;
  }
  function idle(cv) { if (cv) drawViz(cv, null, '#333'); }
  function onTheBeat(p, t, i) { for (const h of p.hits) { if (h.t > t) break; if ((h.i === i || h.i === -1) && t < h.t + Math.max(0.14, Math.min(h.d, 0.38))) return true; } return false; }
  function loop() {
    const v = VIEW, p = Snd.playing();
    if (!v || !p || p !== v.p) { endView(); return; }
    const t = p.time();
    if (v.pads) for (let i = 0; i < v.pads.children.length; i++) v.pads.children[i].classList.toggle('hit', onTheBeat(p, t, i));
    if (v.canvas) drawViz(v.canvas, p.analyser, COL[v.style] || COL.trap);
    if (v.woof) { p.analyser.getByteFrequencyData(lows); let s = 0; for (let k = 1; k < 6; k++) s += lows[k]; const e = Math.pow(s / 5 / 255, 1.6); $$('.woof').forEach(w => w.style.setProperty('--pump', (1 + 0.04 * e).toFixed(4))); }
    raf = requestAnimationFrame(loop);
  }
  function endView() {
    cancelAnimationFrame(raf); const v = VIEW; VIEW = null; if (!v) return;
    if (v.pads) [...v.pads.children].forEach(b => b.classList.remove('hit'));
    if (v.canvas) idle(v.canvas);
    $$('.woof').forEach(w => w.style.setProperty('--pump', 1));
    if (v.btn) setBtn(v.btn, false);
    (v.recs || []).forEach(r => r.classList.remove('spin')); if (v.card) v.card.classList.remove('on'); if (v.row) v.row.classList.remove('playing'); $('#hero').classList.remove('playing');
  }
  function setBtn(b, on) { b.classList.toggle('on', on); const pi = b.querySelector('.pi'); if (pi) pi.textContent = on ? '❚❚' : '▶'; else if (b.classList.contains('pl')) b.textContent = on ? '❚❚' : '▶'; }
  function playTrack(o, view, btn, force) {
    if (!force && VIEW && VIEW.btn === btn && Snd.playing()) { Snd.stop(); return; }
    let p; try { p = Snd.play(o); } catch (e) { C.toast(C.human(e)); return; }
    endView(); VIEW = Object.assign({ p, btn, style: o.style }, view || {});
    if (btn) setBtn(btn, true);
    (VIEW.recs || []).forEach(r => r.classList.add('spin')); if (VIEW.card) VIEW.card.classList.add('on'); if (VIEW.row) VIEW.row.classList.add('playing'); if (VIEW.woof) $('#hero').classList.add('playing');
    const n = $('#now'); n.hidden = false; $('#nowTxt').textContent = '$' + o.symbol + ' · ' + (SL[o.style] || o.style);
    loop();
  }
  Snd.on((kind) => { if (kind === 'end' || kind === 'stop') { endView(); if (!Snd.playing()) $('#now').hidden = true; } });
  $('#now').onclick = () => Snd.stop();

  // ---------- files ----------
  async function saveMp3(o, btn) {
    const lab = btn.querySelector('.lab') || btn, was = lab.textContent; btn.disabled = true;
    try { lab.textContent = 'Rendering…'; const buf = await Snd.render(o); lab.textContent = 'Encoding…'; const b = await Snd.mp3(buf, p => { lab.textContent = 'Encoding ' + Math.round(p * 100) + '%'; }); Snd.save(b, `${o.symbol.toLowerCase()}-soundpad.mp3`); C.toast('Your mp3 is downloading.'); }
    catch (e) { C.toast(C.human(e)); } finally { btn.disabled = false; lab.textContent = was; }
  }
  async function saveVideo(o, btn) {
    const lab = btn.querySelector('.lab') || btn, was = lab.textContent; btn.disabled = true;
    try { await Snd.ready(); Snd.stop(); lab.textContent = 'Recording…'; const r = await Snd.video(o, p => { lab.textContent = 'Recording ' + Math.round(p * 100) + '%'; }); Snd.save(r.blob, `${o.symbol.toLowerCase()}-soundpad.${r.ext}`); C.toast(r.ext === 'mp4' ? 'Your video is downloading.' : 'Your video is downloading (webm: X wants mp4, so convert it or record in Safari).'); }
    catch (e) { C.toast(C.human(e)); } finally { btn.disabled = false; lab.textContent = was; }
  }
  async function share(k) {
    const url = location.origin + '/c/' + k.mint, text = `$${k.symbol} has a sound`;
    if (navigator.share) { try { await navigator.share({ title: 'Soundpad', text, url }); return; } catch {} }
    C.copy(url);
  }
  function pop(b) { if (!b) return; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  async function doLike(m, btn) {
    pop(btn); if (S.liked[m]) return;
    S.liked[m] = 1; C.store.set('sp-liked', S.liked); $$(`[data-like="${m}"]`).forEach(b => b.classList.add('on'));
    const r = await C.post('/api/like', { mint: m }).catch(() => null);
    if (r && r.ok) { const k = coinOf(m); if (k) k.likes = r.likes; $$(`[data-like="${m}"] .n`).forEach(n => n.textContent = fmt(r.likes)); }
    else if (r && !r.ok) C.toast(r.error);
  }

  // ---------- nav + reveal ----------
  if ('IntersectionObserver' in window) {
    const links = $$('.links a');
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); }), { rootMargin: '-45% 0px -50% 0px' });
    $$('main section[id]').forEach(s => io.observe(s));
  }
  $$('.trk, .studio > *, #sorts, .radio > *, .lede, .vgrid, .credits, .splitx, .faq').forEach(e => e.classList.add('reveal'));
  C.reveal();

  // ---------- the hero: press the pads, or play the whole thing ----------
  const hp = pads($('#heroPads'), 'SOUNDPAD', THEME, true);
  pressable(hp, () => THEME);
  $('#heroPlay').onclick = e => playTrack(THEME, { pads: hp, woof: true }, e.currentTarget);
  // when nothing plays, the pads run a little light chase on their own, like a drum machine in demo mode
  setInterval(() => {
    if (document.hidden || Snd.playing() || Snd.calm) return; const r = $('#hero').getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
    [...hp.children].forEach((b, i) => setTimeout(() => flash(hp, i, 150), i * 80));
  }, 3600);

  // ---------- the tape under the hero: real coins and their records, rolling ----------
  const tape = $('#tape'); let tx = 0, tlast = 0;
  function tapeAdd(it) {
    const d = document.createElement('span'); d.className = 'ti' + (it.fresh ? ' new' : ''); d.title = 'Play $' + it.sym;
    const r = recEl(); label(r, it.url, it.o); d.appendChild(r);
    d.insertAdjacentHTML('beforeend', `<b>$${esc(it.sym)}</b><small>${esc(it.sub || '')}</small>`);
    d.onclick = () => playTrack(it.o, { recs: [r] }, d);
    if (it.fresh && tape.children.length > 6) tape.insertBefore(d, tape.children[Math.min(tape.children.length, 7)]); else tape.appendChild(d);
    while (tape.children.length > 36) { const f = tape.firstElementChild; tx += f.offsetWidth + 30; f.remove(); }
    return r;
  }
  (function roll(now) {
    const dt = tlast ? Math.min(64, now - tlast) : 16; tlast = now;
    if (!document.hidden && tape.scrollWidth > tape.parentNode.clientWidth && !Snd.calm) {
      tx -= dt * 0.042; const f = tape.firstElementChild;
      if (f && tx + f.offsetWidth + 30 < 0) { tx += f.offsetWidth + 30; tape.appendChild(f); }
      tape.style.transform = `translate3d(${tx.toFixed(1)}px,0,0)`;
    }
    requestAnimationFrame(roll);
  })(0);

  // ---------- A1 the classics ----------
  async function classics() {
    const el = $('#crates');
    el.innerHTML = CLASSICS.map(([m, s], i) => { const o = classicOpt(m, s); return `<div class="crate" data-m="${m}" style="--i:${i}"><div class="stack"></div><div class="meta"><span style="--c:${COL[o.style]}"><i></i>${SL[o.style]} · ${Snd.describe(o).key}</span><button class="pl" type="button" aria-label="Play $${s}">▶</button></div></div>`; }).join('');
    const tk = await jup(CLASSICS.map(c => c[0]));
    $$('.crate', el).forEach(card => {
      const m = card.dataset.m, s0 = CLASSICS.find(c => c[0] === m)[1], t = tk[m], url = t && t.icon && symOf(t.symbol) === s0 ? t.icon : null, o = classicOpt(m, s0);
      const st = card.querySelector('.stack'), r = recEl(); label(r, url, o); st.appendChild(r);
      const sl = document.createElement('div'); sl.className = 'sleeve';
      const art = () => Snd.ready().then(() => sl.prepend(Snd.coverCanvas(o, 400)));
      if (url) { const im = new Image(); im.alt = '$' + s0; im.decoding = 'async'; im.onerror = () => { im.remove(); const t = sl.querySelector('b'); if (t) t.remove(); art(); }; im.src = pic(url); sl.appendChild(im); sl.insertAdjacentHTML('beforeend', `<b>$${esc(s0)}</b>`); } else art();
      st.appendChild(sl);
      const go = () => playTrack(o, { recs: [r], card }, card.querySelector('.pl'));
      card.querySelector('.pl').onclick = e => { e.stopPropagation(); go(); };
      card.addEventListener('click', go);
      tapeAdd({ sym: s0, sub: SL[o.style], url, o });
    });
    el.insertAdjacentHTML('beforeend', '<p class="note">Not launched here. This is just what their tickers sound like.</p>');
  }
  classics();

  // ---------- A1 the studio ----------
  const tk = $('#tk'), sp = $('#sPads'), viz = $('#sViz');
  const sym = () => symOf(tk.value) || 'YOURS';
  const sOpt = () => ({ symbol: sym(), style: S.style, seed: S.seed, title: $('#ttl').value.trim() });
  function meta() {
    const d = Snd.describe(sOpt());
    $('#sMeta').innerHTML = `<b>$${esc(sym())}</b> · ${d.key} · ${d.bpm} bpm · ${d.style} · ${d.seconds}s · notes ${d.notes.join(' ')}`;
  }
  function syncPads() { pads(sp, sym(), sOpt(), !!symOf(tk.value)); }
  let lastLen = 0;
  tk.addEventListener('input', () => {
    const v = symOf(tk.value); if (v !== tk.value) tk.value = v;
    syncPads(); meta();
    if (v.length > lastLen) { const o = sOpt(), ns = Snd.spell(o.symbol, Snd.genes(o).root); try { Snd.hit(ns[v.length - 1], S.style); } catch {} flash(sp, v.length - 1, 260); }
    lastLen = v.length;
  });
  pressable(sp, sOpt);
  $$('#styles [data-s]').forEach(b => b.onclick = () => { S.style = b.dataset.s; $$('#styles [data-s]').forEach(x => x.classList.toggle('on', x === b)); meta(); if (Snd.playing() && VIEW && VIEW.btn === $('#sPlay')) playTrack(sOpt(), { pads: sp, canvas: viz }, $('#sPlay'), true); });
  $('#remix').onclick = () => { S.seed = Snd.newSeed(); meta(); playTrack(sOpt(), { pads: sp, canvas: viz }, $('#sPlay'), true); C.say('New mix.'); };
  $('#sPlay').onclick = e => playTrack(sOpt(), { pads: sp, canvas: viz }, e.currentTarget);
  $('#sMp3').onclick = e => saveMp3(sOpt(), e.currentTarget);
  $('#sVid').onclick = e => saveVideo(sOpt(), e.currentTarget);
  syncPads(); meta(); idle(viz); addEventListener('resize', () => { if (!VIEW || VIEW.canvas !== viz) idle(viz); });

  // ---------- A1 releasing it ----------
  const buy = Cross.buyBox($('#buyBox'));
  function splitBox(gods) {
    const j = S.board || {}, pool = (j.lives && j.lives.alive) || 0, n = gods ? gods.length : Math.min(8, pool), has = n > 0, you = has ? 70 : 85;
    $('#split').innerHTML = `<div class="bars"><i style="width:${you}%"></i><i style="width:${has ? 15 : 0}%"></i><i style="width:15%"></i></div>
      <dl><div><dt>you</dt><dd>${you}%</dd></div><div><dt>first listeners</dt><dd>${has ? 15 : 0}%</dd><div class="vw">${Array.from({ length: 8 }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('')}</div></div><div><dt>house</dt><dd>15%</dd></div></dl>
      <p>${gods ? (gods.length ? 'Drawn just now: ' + gods.map(g => `${C.short(g.wallet)} (${g.stage})`).join(', ') + '.' : 'No listeners to draw yet, so their 15% is yours.') : has ? `${pool} listener${pool === 1 ? '' : 's'} in the draw. 8 are drawn the moment you launch.` : 'No listeners yet, so the first listeners’ 15% stays with you.'}</p>`;
  }
  function goLabel() { const b = $('#goBtn'), j = S.board; if (j && !j.open) { b.disabled = true; b.textContent = 'Launching opens soon'; return; } b.disabled = false; b.textContent = C.S.me ? `Launch $${symOf(tk.value) || 'it'} on pump.fun` : 'Connect wallet to launch'; }
  tk.addEventListener('input', goLabel);
  const status = (t, c) => { const s = $('#goStatus'); s.className = 'status' + (c ? ' ' + c : ''); s.innerHTML = t || ''; };
  $('#goBtn').onclick = async () => {
    if (!C.S.me) { await C.connect(); return; }
    const symbol = symOf(tk.value), name = $('#nm').value.trim(), line = $('#line').value.trim();
    if (!symbol) { tk.focus(); return status('Type its ticker first, up in the studio.', 'err'); }
    if (!name) return status('Give it a name.', 'err');
    if (line.length < 8) return status('Write what your coin is: one line.', 'err');
    if (buy.over()) return status('Up to 5 SOL in the first buy.', 'err');
    const btn = $('#goBtn'), prog = $('#goProg'); btn.disabled = true; status(''); $('#goRes').hidden = true;
    try {
      await Snd.ready();
      const r = await Cross.run({ name, symbol, line, look: S.style, seed: S.seed, caption: $('#ttl').value.trim(), x: $('#xh').value.trim(), devBuy: buy.lamports(), onStep: i => Cross.steps(prog, i), onDraw: m => splitBox(m.gods) });
      Cross.steps(prog, Cross.STEPS.length, true);
      const res = $('#goRes'); res.hidden = false;
      res.innerHTML = `<div class="res"><b>$${esc(symbol)} is out, with its first track.</b>${r.buyNote ? ' ' + esc(r.buyNote) : ''}<br><a href="/c/${r.mint}">Open its track →</a> · <a href="https://pump.fun/coin/${r.mint}" target="_blank" rel="noopener">pump.fun ↗</a></div>`;
      status('Done.', 'ok'); S.seed = Snd.newSeed(); meta(); load();
    } catch (e) { status(esc(C.human(e)) + (e.mint ? ` <a href="/c/${e.mint}">Open it</a>` : ''), 'err'); }
    finally { btn.disabled = false; goLabel(); }
  };

  // ---------- A2 the chart ----------
  function sorted(ks) {
    const a = ks.slice(), t = k => new Date(k.born_at || 0).getTime();
    if (S.sort === 'new') return a.sort((x, y) => t(y) - t(x));
    if (S.sort === 'likes') return a.sort((x, y) => (y.likes || 0) - (x.likes || 0) || t(y) - t(x));
    const s = k => (pushedNow(k) ? 1e9 : 0) + (k.likes || 0) * 3 + (k.state === 'alive' || k.state === 'ascended' ? 20 : 0) - (k.state === 'dead' ? 60 : 0);
    return a.sort((x, y) => s(y) - s(x) || t(y) - t(x));
  }
  function chart() {
    const ks = sorted(coins()), el = $('#tracks');
    if (!ks.length) {
      el.innerHTML = `<li class="empty"><div class="pads sm" id="emptyPads"></div><div><h3>No tracks yet.</h3><p>Every coin launched here shows up as a track. The first one is number one by default.</p><a class="btn acc" href="#studio">Make the first one</a></div></li>`;
      pads($('#emptyPads'), '1ST', { symbol: '1ST', style: 'trap', seed: 'first' }, true);
      return;
    }
    el.innerHTML = ks.map((k, i) => `<li class="tr" data-m="${k.mint}" style="--i:${Math.min(i, 10)}"><span class="no">${i + 1}</span><span class="cv"></span>
      <span class="nm"><b>$${esc(k.symbol)}${pushedNow(k) ? '<em class="one">#1 this hour</em>' : ''}</b><span>${esc(k.name)}${k.caption ? ' · ' + esc(k.caption) : ''}</span></span>
      <span class="sty" style="--c:${COL[k.look] || COL.trap}"><i></i>${SL[k.look] || 'trap'}</span>
      <span class="st ${k.state}"><i></i>${LABEL[k.state] || k.state}</span>
      <button class="lk ${S.liked[k.mint] ? 'on' : ''}" type="button" data-like="${k.mint}" aria-label="Like">${HEART}<span class="n">${fmt(k.likes)}</span></button>
      <button class="pl" type="button" aria-label="Play $${esc(k.symbol)}">▶</button></li>`).join('');
    Snd.ready().then(() => $$('.tr', el).forEach(li => { const k = coinOf(li.dataset.m); if (k) li.querySelector('.cv').appendChild(Snd.coverCanvas(optOf(k), 112)); }));
    $$('.tr', el).forEach(li => {
      const m = li.dataset.m;
      li.addEventListener('click', e => { if (e.target.closest('button')) return; openTrack(m); });
      li.querySelector('.lk').onclick = e => doLike(m, e.currentTarget);
      li.querySelector('.pl').onclick = e => { const k = coinOf(m); if (k) playTrack(optOf(k), { row: li }, e.currentTarget); };
    });
    Live.watch(ks.filter(k => k.state !== 'ascended').map(k => k.mint));
  }
  $$('#sorts button').forEach(b => b.onclick = () => { S.sort = b.dataset.s; $$('#sorts button').forEach(x => x.classList.toggle('on', x === b)); chart(); });
  Live.on('trade', t => {
    const li = $(`#tracks .tr[data-m="${t.mint}"]`); if (!li) return;
    li.classList.remove('buy', 'sell'); void li.offsetWidth; li.classList.add(t.side); setTimeout(() => li.classList.remove(t.side), 1400);
    const s = li.querySelector('.st'); if (s && !s.classList.contains('ascended')) { s.className = 'st alive'; s.innerHTML = '<i></i>live'; }
  });

  // ---------- a track, opened ----------
  async function loadDetail(m) {
    const c = S.kid.get(m); if (c && Date.now() - c.at < 30000) return c.j;
    const j = await C.get('/api/kid?mint=' + m).catch(() => null);
    if (j && j.ok) S.kid.set(m, { at: Date.now(), j }); return j;
  }
  function detailHtml(m) {
    const k = kOf(m); if (!k) return '<p class="mut">Loading…</p>';
    const c = S.kid.get(m), j = c && c.j, gods = k.gods || [], st = k.status && k.status !== 'live' ? 'unborn' : k.state;
    const drops = ((j && j.drops) || []).filter(d => d.kind !== 'answer'), comments = (j && j.comments) || [];
    return `<dl class="dstat"><div><dt>mcap</dt><dd>${usd(k)}</dd></div><div><dt>likes</dt><dd>${fmt(k.likes)}</dd></div><div><dt>to pay out</dt><dd>${C.sol(k.vault_lamports || 0)}</dd></div></dl>
      <div class="mut" style="font:11px GM;text-transform:uppercase;letter-spacing:.07em">first listeners · ${LABEL[st] || st}</div><div class="vw">${Array.from({ length: 8 }, (_, i) => `<i class="${i < gods.length ? 'on' : ''}" title="${gods[i] ? C.short(gods[i].wallet) : ''}"></i>`).join('')}</div>
      <div class="dbtn"><a class="btn sm acc" href="https://pump.fun/coin/${k.mint}" target="_blank" rel="noopener">pump.fun ↗</a><a class="btn sm" href="https://dexscreener.com/solana/${k.mint}" target="_blank" rel="noopener">chart ↗</a><button class="btn sm" type="button" data-copy="${k.mint}">copy CA</button><button class="btn sm" type="button" data-pay="${k.mint}" ${k.status === 'live' ? '' : 'disabled'}>pay out</button></div>
      <div class="drops"><h4>its tracks</h4>${drops.length ? drops.map((d, i) => `<div class="drop"><button class="pl" type="button" data-drop="${i === drops.length - 1 ? '' : d.id}" aria-label="Play">▶</button><b>${esc(d.text)}</b><span>${C.ago(new Date(d.at).getTime())}</span></div>`).join('') : '<p class="mut" style="margin:0;font-size:13px">Its first track title is on its way.</p>'}</div>
      <div class="cmts"><h4>comments</h4>${comments.length ? comments.map(x => `<div class="cm"><q>${esc(x.q || '')}</q><p>${esc(x.text)}</p></div>`).join('') : '<p class="mut" style="margin:0;font-size:13px">No replies yet. Comment and it answers.</p>'}</div>
      <div class="ask"><input class="in" maxlength="200" placeholder="add a comment…" data-ask="${k.mint}"><button class="btn sm acc" type="button" data-send="${k.mint}">send</button></div>`;
  }
  function wire(root, m) {
    $$('[data-copy]', root).forEach(b => b.onclick = () => C.copy(b.dataset.copy));
    $$('[data-pay]', root).forEach(b => b.onclick = async () => { b.disabled = true; try { const r = await Cross.feed(m); if (r) C.toast('Paid out to everyone in its split.'); S.kid.delete(m); } catch (e) { C.toast(C.human(e)); } b.disabled = false; });
    $$('[data-drop]', root).forEach(b => b.onclick = () => { const k = kOf(m); if (k) playTrack(optOf(k, b.dataset.drop), { pads: $('#tpPads'), canvas: $('#tpViz') }, b); });
    const inp = root.querySelector('[data-ask]'), send = root.querySelector('[data-send]');
    const go = async () => {
      const q = inp.value.trim(); if (q.length < 2) return; send.disabled = true;
      const r = await C.post('/api/talk', { mint: m, ask: q }).catch(() => null); send.disabled = false;
      if (!r || !r.ok) { C.toast((r && r.error) || 'No reply this time.'); return; }
      const c = S.kid.get(m); if (c && c.j) (c.j.comments = c.j.comments || []).unshift({ q, text: r.text });
      root.innerHTML = detailHtml(m); wire(root, m);
    };
    if (send) { send.onclick = go; inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); }
  }
  async function openTrack(m) {
    const k0 = coinOf(m);
    C.sheet(k0 ? '$' + k0.symbol : 'track', `<div class="tp"><div class="cov" id="tpCov"></div><div><div class="ttl" id="tpTtl"><b>${k0 ? '$' + esc(k0.symbol) : 'Loading…'}</b><span></span></div>
      <div class="pads row sm" id="tpPads"></div><canvas class="viz" id="tpViz"></canvas>
      <div class="acts"><button class="btn acc" id="tpPlay" type="button"><span class="pi">▶</span><span>Play</span></button><button class="btn lk" id="tpLike" type="button" data-like="${m}" aria-label="Like">${HEART}<span class="n">${fmt(k0 && k0.likes)}</span></button><button class="btn" id="tpShare" type="button">share</button><button class="btn" id="tpMp3" type="button"><span class="lab">⬇ mp3</span></button><button class="btn" id="tpVid" type="button"><span class="lab">⬇ video</span></button></div>
      <div id="sd"><p class="mut">Loading…</p></div></div></div>`);
    if (location.pathname !== '/c/' + m) history.replaceState(null, '', '/c/' + m + location.hash);
    C.closeSheet.after = () => { if (VIEW && VIEW.pads === $('#tpPads')) Snd.stop(); if (location.pathname.startsWith('/c/')) history.replaceState(null, '', '/' + location.hash); };
    await loadDetail(m);
    const k = kOf(m), sd = $('#sd'); if (!sd) return;
    if (!k) { sd.innerHTML = '<p class="mut">No track lives at that address.</p>'; return; }
    const o = optOf(k), d = Snd.describe(o);
    $('#sheetTitle').textContent = '$' + k.symbol;
    $('#tpTtl').innerHTML = `<b>$${esc(k.symbol)}</b><span>${esc(k.name)} · ${d.style} · ${d.key} · ${d.bpm} bpm</span>`;
    await Snd.ready(); $('#tpCov').appendChild(Snd.coverCanvas(o, 440));
    const tp = pads($('#tpPads'), k.symbol, o, true); pressable(tp, () => o); idle($('#tpViz'));
    const lk = $('#tpLike'); if (S.liked[m]) lk.classList.add('on'); lk.querySelector('.n').textContent = fmt(k.likes); lk.onclick = () => doLike(m, lk);
    $('#tpPlay').onclick = e => playTrack(o, { pads: tp, canvas: $('#tpViz') }, e.currentTarget);
    $('#tpShare').onclick = () => share(k); $('#tpMp3').onclick = e => saveMp3(o, e.currentTarget); $('#tpVid').onclick = e => saveVideo(o, e.currentTarget);
    sd.innerHTML = detailHtml(m); wire(sd, m);
  }

  // ---------- B1 radio: pump.fun, live ----------
  const rb = $('#radioBtn'), births = $('#births'), rp = $('#rPads'); let busy = 0, list = [];
  rb.onclick = () => {
    S.radio = !S.radio; rb.setAttribute('aria-pressed', S.radio); rb.querySelector('span').textContent = S.radio ? 'Radio is on' : 'Turn on the radio';
    if (S.radio) { try { Snd.ctx(); } catch (e) { C.toast(C.human(e)); } if (list[0]) onAir(list[0]); else $('#rLab').textContent = 'waiting for the next coin'; }
  };
  function onAir(b) {
    const o = anyOpt(b), rr = $('#rRec'); $('#rSym').textContent = '$' + o.symbol; $('#rName').textContent = b.name || ''; $('#rLab').textContent = 'just born on pump.fun';
    pads(rp, o.symbol, o, true); rr.dataset.m = b.mint; label(rr, pics.get(b.mint) || null, o); if (!pics.has(b.mint)) wantPic(b.mint, o, rr);
    $$('#births li').forEach(li => li.classList.toggle('on', li.dataset.m === b.mint));
    if (!S.radio || (Snd.playing() && VIEW && VIEW.btn && !VIEW.radio) || Date.now() < busy) return;
    try { const ms = Snd.motif(o, i => flash(rp, i, 220)); busy = Date.now() + ms; rr.classList.add('spin'); setTimeout(() => rr.classList.remove('spin'), ms); } catch {}
  }
  Live.on('status', up => {
    $('#kDot').classList.toggle('on', up);
    if (!up && !S.born) births.innerHTML = '<li class="mut">pump.fun’s live feed is offline right now. New coins show up here when it’s back.</li>';
  });
  Live.on('birth', b => {
    S.born++; $('#bornN').textContent = S.born.toLocaleString('en-US');
    if (S.born === 1) births.innerHTML = '';
    list.unshift(b); list = list.slice(0, 30);
    const o = anyOpt(b), li = document.createElement('li'); li.dataset.m = b.mint;
    li.innerHTML = `<div><b>$${esc(o.symbol)}</b><span>${esc(b.name || '')} · ${SL[o.style]}</span></div><a class="pl" href="https://pump.fun/coin/${esc(b.mint)}" target="_blank" rel="noopener" aria-label="Open on pump.fun">↗</a><button class="pl" type="button" aria-label="Play its track">▶</button>`;
    const r = recEl(); label(r, null, o); li.prepend(r);
    const tr = tapeAdd({ sym: o.symbol, sub: 'just born', url: null, o, fresh: true });
    wantPic(b.mint, o, r); wantPic(b.mint, o, tr);
    li.querySelector('button').onclick = e => playTrack(o, { pads: pads(rp, o.symbol, o, true), radio: true, recs: [r] }, e.currentTarget);
    births.prepend(li); while (births.children.length > 12) births.lastChild.remove();
    if (S.radio || !$('#rSym').textContent || $('#rSym').textContent === '—') onAir(b);
  });
  Live.start();

  // ---------- B2 listeners ----------
  function ladder() {
    const R = [['new', '1x', 'from day 0'], ['regular', '1.5x', 'from day 3'], ['superfan', '2x', 'from day 10'], ['day one', '3x', 'from day 30']];
    const el = $('#ladder'); el.classList.add('stg');
    el.innerHTML = R.map((r, i) => `<div class="rung"><span class="pad lit" style="display:grid;place-items:center">${['N', 'R', 'S', 'D'][i]}</span><b>${r[0]}</b><div class="x">${r[1]}</div><small>${r[2]}</small></div>`).join('');
    C.reveal($('#listeners'));
  }
  const TOK = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'], CB = 'ComputeBudget111111111111111111111111111111';
  async function me() {
    const el = $('#me'), j = S.board || {};
    if (!C.S.me) { el.innerHTML = `<h3>You</h3><div class="big">not listening</div><p class="mut">Connect the wallet that holds your $SOUNDPAD.</p><button class="btn acc" id="meC" type="button">Connect wallet</button>`; $('#meC').onclick = () => C.connect(); return; }
    if (!j.life) { el.innerHTML = `<h3>You</h3><div class="big">soon</div><p class="mut">Joining opens when $SOUNDPAD launches.</p>`; return; }
    el.innerHTML = '<h3>You</h3><p class="mut">Reading…</p>';
    const r = await C.get('/api/born?w=' + C.S.me).catch(() => null);
    if (!r || !r.ok) { el.innerHTML = `<h3>You</h3><p class="mut">${esc((r && r.error) || 'Didn’t load. Try again.')}</p>`; return; }
    const l = r.life, min = r.minBurn || 10000, form = label => `<div class="burn"><input class="in" id="bAmt" inputmode="numeric" value="${min}"><button class="btn acc" id="bBtn" type="button">${label}</button></div><p class="mut" style="font-size:13px;margin:8px 0 0">You hold ${r.balance == null ? '—' : Number(r.balance).toLocaleString('en-US')} $SOUNDPAD. Joining burns at least ${min.toLocaleString('en-US')}.</p><p class="status" id="bSt"></p>`;
    if (!l) el.innerHTML = `<h3>You</h3><div class="big">not listening</div>${form('Burn and start listening')}`;
    else if (l.state === 'dead') el.innerHTML = `<h3>You</h3><div class="big">left</div><p class="mut">This wallet sold below what it held after joining. Coins it was a first listener of still pay it.</p>${form('Listen again')}`;
    else el.innerHTML = `<h3>You</h3><div class="big">${esc(l.stage === 'fan' ? 'superfan' : l.stage)}</div><dl><div><dt>listening</dt><dd>${Math.floor(l.days || 0)} days</dd></div><div><dt>tickets</dt><dd>${l.mult}x</dd></div><div><dt>next</dt><dd>${l.next ? (l.next.stage === 'fan' ? 'superfan' : l.next.stage) + ' in ' + Math.ceil(l.next.in) + 'd' : 'top stage'}</dd></div><div><dt>first listener of</dt><dd>${(l.godchildren || []).length}</dd></div></dl>
      <div class="kids">${(l.godchildren || []).slice(0, 10).map(c => `<a href="/c/${c.mint}"><span>$${esc(c.symbol)}</span><span>${C.sol(c.vault_lamports || 0)} waiting</span></a>`).join('')}</div>${form('Burn more')}`;
    const b = $('#bBtn'); if (b) b.onclick = () => burn(r);
  }
  async function burn(info) {
    const st = (t, c) => { const s = $('#bSt'); if (s) { s.className = 'status' + (c ? ' ' + c : ''); s.textContent = t; } };
    const amt = Math.floor(Number(String($('#bAmt').value).replace(/[, _]/g, '')));
    if (!(amt >= (info.minBurn || 10000))) return st(`Joining burns at least ${(info.minBurn || 10000).toLocaleString('en-US')} $SOUNDPAD.`, 'err');
    const btn = $('#bBtn'); btn.disabled = true;
    try {
      st('Building the burn…');
      const r = await C.post('/api/born', { wallet: C.S.me, amount: amt }); if (!r.ok) throw new Error(r.error);
      const w3 = await C.loadWeb3(), tx = w3.VersionedTransaction.deserialize(Uint8Array.from(atob(r.tx), c => c.charCodeAt(0)));
      const msg = tx.message, keys = msg.staticAccountKeys.map(k => k.toBase58()); let ok = false;
      for (const ix of msg.compiledInstructions) {
        const prog = keys[ix.programIdIndex], d = ix.data; if (prog === CB) continue;
        if (!TOK.includes(prog) || d[0] !== 15 || ok) throw new Error('The burn isn’t what was shown, so nothing was signed.');
        let v = 0n; for (let i = 8; i >= 1; i--) v = v * 256n + BigInt(d[i]);
        const ks = ix.accountKeyIndexes.map(i => keys[i]);
        if (v !== BigInt(r.amount) || ks[1] !== r.mint || ks[2] !== C.S.me) throw new Error('The burn isn’t what was shown, so nothing was signed.');
        ok = true;
      }
      if (!ok) throw new Error('The burn is missing, so nothing was signed.');
      st('Waiting for your wallet…'); const [signed] = await C.signAll([tx]); const sig = await C.send(signed); st('Burning…'); await C.confirm(sig);
      st('Reading it from Solana…'); let v = null;
      for (let i = 0; i < 6; i++) { v = await C.post('/api/born', { wallet: C.S.me, sig }).catch(() => null); if (v && v.ok) break; await new Promise(z => setTimeout(z, 2000)); }
      if (!v || !v.ok) throw new Error((v && v.error) || 'The burn landed; it shows after the next check.');
      C.toast('You’re listening.'); load();
    } catch (e) { st(C.human(e), 'err'); btn.disabled = false; }
  }
  function vtop() {
    const e = (S.board && S.board.elders) || [];
    $('#vtop').innerHTML = `<h3>Longest listening</h3>` + (e.length ? `<table class="tbl"><thead><tr><th>#</th><th>wallet</th><th>stage</th><th>first listener of</th></tr></thead><tbody>${e.map((x, i) => `<tr><td>${i + 1}</td><td>${C.short(x.wallet)}</td><td>${esc(x.stage === 'fan' ? 'superfan' : x.stage)}</td><td>${x.kids}</td></tr>`).join('')}</tbody></table>` : `<p class="mut">${S.board && S.board.life ? 'Nobody is listening yet. The first one stays on top for a while.' : 'Opens when $SOUNDPAD launches.'}</p>`);
  }

  // ---------- load ----------
  function caBox() {
    const m = S.board && S.board.life, el = $('#caBox'); el.hidden = !m; if (!m) return;
    el.innerHTML = `<span>$SOUNDPAD</span><code>${C.short(m, 6)}</code><button type="button" id="caC">copy</button><a href="https://pump.fun/coin/${m}" target="_blank" rel="noopener">buy</a><a href="https://dexscreener.com/solana/${m}" target="_blank" rel="noopener">chart</a>`;
    $('#caC').onclick = () => C.copy(m);
  }
  let first = true;
  async function load() {
    const j = await C.get('/api/board').catch(() => null);
    S.board = j && (j.ok || j.offline) ? j : { coins: [], notes: [], elders: [], lives: { alive: 0 }, open: false };
    chart(); splitBox(); goLabel(); caBox(); me(); vtop();
    if (first) { first = false; ladder(); const mm = location.pathname.match(/^\/c\/([1-9A-HJ-NP-Za-km-z]{32,44})/); if (mm) openTrack(mm[1]); }
  }
  C.onWallet(() => { goLabel(); me(); });
  load();
  setInterval(() => {
    if (document.hidden) return;
    C.get('/api/board').then(j => {
      if (!j || !j.ok) return;
      const sig = b => JSON.stringify(((b && b.coins) || []).map(k => [k.mint, k.state, k.caption, k.pushed_at, k.likes]));
      const changed = sig(j) !== sig(S.board); S.board = j; if (changed && !(VIEW && VIEW.btn && VIEW.btn.closest && VIEW.btn.closest('#tracks'))) chart(); vtop();
    }).catch(() => {});
  }, 60000);
})();
