// Soundpad's sound engine: a ticker becomes a track, right in the browser. No samples, no server: every sound is
// synthesized with Web Audio, so the same ticker, style and seed always make the same track.
// The rule: each letter picks a note of the coin's minor key (A = the 1st note, B = the 2nd ... G = the 7th, then H
// starts again), and each note lands as close as possible to the one before. Digits pick notes the same way.
(function () {
  'use strict';
  const SCALE = [0, 2, 3, 5, 7, 8, 10];
  const KEYS = [5, 7, 9, 2, 0, 4];                                   // F G A D C E minor
  const PROGS = [[5, 6, 0, 6], [0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6]];
  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const STY = {
    trap: { bpm: 140, bars: 8, tail: 3.2, color: '#ff5c1f', label: 'trap' },
    house: { bpm: 124, bars: 8, tail: 2.8, color: '#2fe6c8', label: 'house' },
    lofi: { bpm: 84, bars: 5, tail: 3.0, color: '#ff8fb1', label: 'lo-fi', swing: 0.2 },
    chip: { bpm: 150, bars: 8, tail: 2.4, color: '#b6ff3b', label: '8-bit' },
  };
  const mf = m => 440 * Math.pow(2, (m - 69) / 12);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- seeded randomness ----------
  function hash(s) { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return (h ^= h >>> 16) >>> 0; }; }
  function rng(seed) { let a = hash(String(seed))(); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- the rule ----------
  function spell(ticker, root, start) {
    root = root == null ? 5 : root; start = start || 72;
    const out = []; let prev = null;
    for (const ch of String(ticker || '').toUpperCase()) {
      const c = ch.charCodeAt(0); let deg;
      if (c >= 65 && c <= 90) deg = (c - 65) % 7; else if (c >= 48 && c <= 57) deg = (c - 48) % 7; else continue;
      const pc = (root + SCALE[deg]) % 12, ref = prev == null ? start : prev; let best = null;
      for (let o = 1; o < 9; o++) { const m = pc + 12 * o, d = Math.abs(m - ref), bd = best == null ? 1e9 : Math.abs(best - ref); if (d < bd || (d === bd && m < best)) best = m; }
      out.push(best); prev = best;
    }
    return out.slice(0, 10);
  }
  function genes(o) {
    const style = STY[o.style] ? o.style : 'trap', r = rng((o.seed || 'soundpad') + '|' + String(o.symbol || '').toUpperCase());
    const root = o.root != null ? o.root : KEYS[Math.floor(r() * KEYS.length)];
    const prog = o.prog || PROGS[Math.floor(r() * PROGS.length)];
    return { style, root, prog, S: STY[style], key: NAMES[root] + ' minor' };
  }
  const deg2 = (d, root, base) => base + root + SCALE[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const chordOf = (d, root) => { const n = [d, d + 2, d + 4].map(x => deg2(x, root, 48)); return n.map(m => (m > 66 ? m - 12 : m)).sort((a, b) => a - b); };
  const bassOf = (d, root) => { let m = deg2(d, root, 24); if (m > 35) m -= 12; return m; };
  // two bars of melody: the first five letters, then the rest (or an answer that comes home to the key's note)
  const POS = [0, 3, 6, 8, 10];
  function phrase(notes, root) {
    let A = notes.slice(0, 5), B = notes.slice(5, 10);
    if (!A.length) A = [deg2(0, root, 60)];
    if (A.length < 3) A = A.concat(A).slice(0, 4);
    if (!B.length) { const last = A[A.length - 1]; let tonic = null; for (let o = 3; o < 8; o++) { const m = root + 12 * o; if (tonic == null || Math.abs(m - last) < Math.abs(tonic - last)) tonic = m; } B = A.slice(0, Math.min(2, A.length)).concat([tonic]); }
    const ev = [];
    [[A, 0], [B, 16]].forEach(([arr, off]) => arr.forEach((m, i) => { const p = POS[i], nx = i + 1 < arr.length ? POS[i + 1] : 16; ev.push({ p: off + p, m, l: Math.min(nx - p, off && i + 1 === arr.length ? 10 : 6), i: off ? 5 + i : i }); }));
    return ev;
  }
  const length = o => { const G = genes(o); return G.S.bars * 4 * 60 / G.S.bpm + 0.05 + G.S.tail; };

  // ---------- the instruments ----------
  const cache = new WeakMap();
  function kit(ac) {
    let k = cache.get(ac); if (k) return k;
    const sr = ac.sampleRate, nb = ac.createBuffer(1, sr * 2, sr), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ir = ac.createBuffer(2, Math.floor(sr * 2.4), sr);
    for (let c = 0; c < 2; c++) { const x = ir.getChannelData(c); let lp = 0; for (let i = 0; i < x.length; i++) { lp += 0.38 * ((Math.random() * 2 - 1) - lp); x[i] = lp * Math.exp(-6.9 * (i / sr) / 2.1) * (i < sr * 0.02 ? 0 : 1); } }
    const cr = ac.createBuffer(1, sr * 3, sr), cx = cr.getChannelData(0);
    for (let i = 0; i < cx.length; i++) cx[i] = (Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.9 : 0) + (Math.random() * 2 - 1) * 0.015;
    const curve = drive => { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(drive * x) / Math.tanh(drive); } return c; };
    k = { noise: nb, ir, crackle: cr, curve };
    cache.set(ac, k); return k;
  }
  function Mixer(ac, out) {
    const K = kit(ac), N = (t, f) => { const n = ac.createBufferSource(); n.buffer = K.noise; n.loop = true; n.loopStart = Math.random(); return n; };
    const master = ac.createGain(); master.gain.value = 0.62;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    const lim = ac.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.08;
    master.connect(comp); comp.connect(lim); lim.connect(out);
    const rev = ac.createConvolver(); rev.buffer = K.ir; const revG = ac.createGain(); revG.gain.value = 0.3; rev.connect(revG); revG.connect(master);
    const dly = ac.createDelay(2), fb = ac.createGain(), dlf = ac.createBiquadFilter(), dlyG = ac.createGain();
    dlf.type = 'lowpass'; dlf.frequency.value = 3200; fb.gain.value = 0.33; dlyG.gain.value = 0.26;
    dly.connect(dlf); dlf.connect(fb); fb.connect(dly); dlf.connect(dlyG); dlyG.connect(master);
    const duck = ac.createGain(); duck.connect(master);
    const drums = ac.createGain(); drums.connect(master);
    const sat = ac.createWaveShaper(); sat.curve = K.curve(2.2); sat.oversample = '2x'; sat.connect(drums);
    const sat808 = ac.createWaveShaper(); sat808.curve = K.curve(2.8); sat808.oversample = '2x'; const bassG = ac.createGain(); bassG.gain.value = 0.62; sat808.connect(bassG); bassG.connect(master);
    const ducks = [];
    const M = {
      ac, K, rev, dly, duck, drums, master,
      send(node, r, d) { if (r) { const g = ac.createGain(); g.gain.value = r; node.connect(g); g.connect(rev); } if (d) { const g = ac.createGain(); g.gain.value = d; node.connect(g); g.connect(dly); } },
      pan(node, p) { if (!p || !ac.createStereoPanner) return node; const s = ac.createStereoPanner(); s.pan.value = p; node.connect(s); return s; },
      setDelay(sec) { dly.delayTime.value = Math.min(1.9, sec); },
      kick(t, v = 1, sc = 0.55) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.setValueAtTime(175, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.065); o.frequency.exponentialRampToValueAtTime(43, t + 0.4);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.0015); g.gain.setTargetAtTime(0.0001, t + 0.03, 0.085);
        o.connect(g); g.connect(sat); o.start(t); o.stop(t + 0.7);
        const n = N(), h = ac.createBiquadFilter(), gc = ac.createGain(); h.type = 'highpass'; h.frequency.value = 2600;
        gc.gain.setValueAtTime(0.32 * v, t); gc.gain.setTargetAtTime(0.0001, t, 0.0025); n.connect(h); h.connect(gc); gc.connect(sat); n.start(t); n.stop(t + 0.05);
        if (sc) ducks.push([t, sc]);
      },
      b808(t, m, dur, v = 1, glide) {
        const f = mf(m), o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), g2 = ac.createGain();
        o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.025);
        o2.frequency.setValueAtTime(f * 3, t); o2.frequency.exponentialRampToValueAtTime(f * 2, t + 0.025);
        if (glide) { o.frequency.setValueAtTime(f, t + Math.max(0.03, dur - 0.13)); o.frequency.exponentialRampToValueAtTime(mf(glide), t + dur); o2.frequency.setValueAtTime(f * 2, t + Math.max(0.03, dur - 0.13)); o2.frequency.exponentialRampToValueAtTime(mf(glide) * 2, t + dur); }
        g2.gain.value = 0.45; o2.connect(g2); g2.connect(g); o.connect(g);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.95, t + 0.004); g.gain.setTargetAtTime(v * 0.25, t + 0.02, 0.7); g.gain.setTargetAtTime(0.0001, t + dur, 0.025);
        g.connect(sat808); o.start(t); o2.start(t); o.stop(t + dur + 0.25); o2.stop(t + dur + 0.25);
      },
      clap(t, v = 1, r = 0.18) {
        const n = N(), b = ac.createBiquadFilter(), g = ac.createGain(); b.type = 'bandpass'; b.frequency.value = 1350; b.Q.value = 0.8;
        const p = g.gain; p.setValueAtTime(0.0001, t);
        [0, 0.011, 0.022].forEach(d => { p.setValueAtTime(v, t + d); p.setTargetAtTime(v * 0.06, t + d, 0.0035); });
        p.setValueAtTime(v * 0.85, t + 0.03); p.setTargetAtTime(0.0001, t + 0.03, 0.06);
        n.connect(b); b.connect(g); g.connect(drums); M.send(g, r); n.start(t); n.stop(t + 0.5);
        const o = ac.createOscillator(), go = ac.createGain(); o.frequency.value = 190; go.gain.setValueAtTime(0.25 * v, t); go.gain.setTargetAtTime(0.0001, t, 0.025); o.connect(go); go.connect(drums); o.start(t); o.stop(t + 0.2);
      },
      snare(t, v = 1) {
        const n = N(), b = ac.createBiquadFilter(), g = ac.createGain(); b.type = 'bandpass'; b.frequency.value = 2200; b.Q.value = 0.6;
        g.gain.setValueAtTime(v * 0.8, t); g.gain.setTargetAtTime(0.0001, t, 0.05); n.connect(b); b.connect(g); g.connect(drums); M.send(g, 0.15); n.start(t); n.stop(t + 0.4);
        const o = ac.createOscillator(), go = ac.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
        go.gain.setValueAtTime(0.45 * v, t); go.gain.setTargetAtTime(0.0001, t, 0.04); o.connect(go); go.connect(drums); o.start(t); o.stop(t + 0.3);
      },
      hat(t, v = 0.5, open = false, pan = 0.25) {
        const n = N(), h = ac.createBiquadFilter(), g = ac.createGain(); h.type = 'highpass'; h.frequency.value = 7200;
        g.gain.setValueAtTime(v * 0.45, t); g.gain.setTargetAtTime(0.0001, t, open ? 0.09 : 0.016);
        n.connect(h); h.connect(g); M.pan(g, pan).connect(drums); n.start(t); n.stop(t + (open ? 0.6 : 0.15));
      },
      crash(t, v = 1) {
        const n = N(), h = ac.createBiquadFilter(), g = ac.createGain(); h.type = 'highpass'; h.frequency.value = 4200;
        g.gain.setValueAtTime(0.22 * v, t); g.gain.setTargetAtTime(0.0001, t, 0.55); n.connect(h); h.connect(g); g.connect(master); M.send(g, 0.2); n.start(t); n.stop(t + 3);
      },
      riser(t, dur, v = 1) {
        const n = N(), b = ac.createBiquadFilter(), g = ac.createGain(); b.type = 'bandpass'; b.Q.value = 1.4;
        b.frequency.setValueAtTime(350, t); b.frequency.exponentialRampToValueAtTime(9000, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32 * v, t + dur); g.gain.setValueAtTime(0.0001, t + dur + 0.01);
        n.connect(b); b.connect(g); g.connect(master); n.start(t); n.stop(t + dur + 0.05);
      },
      boom(t, v = 1) {
        const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(64, t); o.frequency.exponentialRampToValueAtTime(31, t + 0.9);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.7 * v, t + 0.006); g.gain.setTargetAtTime(0.0001, t + 0.05, 0.4); o.connect(g); g.connect(sat808); o.start(t); o.stop(t + 2.2);
      },
      crackle(t, dur, v = 1) {
        const s = ac.createBufferSource(), h = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = K.crackle; s.loop = true; h.type = 'highpass'; h.frequency.value = 900;
        g.gain.value = 0.5 * v; s.connect(h); h.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
      },
      // a voice: oscillators through a filter and an envelope
      lead(t, m, dur, v = 1, kind = 'saw', pan = 0, rv = 0.22, dl = 0.2) {
        const f = mf(m), g = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
        const os = [];
        const add = (type, fr, det, gain) => { const o = ac.createOscillator(), og = ac.createGain(); o.type = type; o.frequency.value = fr; o.detune.value = det; og.gain.value = gain; o.connect(og); og.connect(lp); os.push(o); return o; };
        let rel = 0.09, peak = v * 0.32;
        if (kind === 'saw') {
          add('sawtooth', f, -11, 0.5); add('sawtooth', f, 11, 0.5); add('square', f / 2, 0, 0.28);
          lp.frequency.setValueAtTime(7200, t); lp.frequency.setTargetAtTime(1800, t, 0.12);
        } else if (kind === 'pluck') {
          add('sawtooth', f, -7, 0.55); add('square', f, 7, 0.3);
          lp.frequency.setValueAtTime(6200, t); lp.frequency.setTargetAtTime(700, t, 0.07); dur = Math.min(dur, 0.32); rel = 0.08; peak = v * 0.36;
        } else if (kind === 'keys') {
          const o = add('sine', f, 0, 0.9); add('sine', f * 2, 3, 0.18);
          const mo = ac.createOscillator(), mg = ac.createGain(); mo.frequency.value = f; mg.gain.setValueAtTime(f * 1.6, t); mg.gain.setTargetAtTime(f * 0.2, t, 0.25); mo.connect(mg); mg.connect(o.frequency); os.push(mo);
          lp.frequency.value = 3200; rel = 0.25; peak = v * 0.42;
        } else if (kind === 'square') {
          add('square', f, 0, 0.42); add('square', f, 8, 0.2); lp.frequency.value = 9000; rel = 0.04; peak = v * 0.24;
        }
        if (dur > 0.35 && kind !== 'pluck') { const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 5.6; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.0065, t + 0.4); lfo.connect(lg); os.filter(o => o.type !== 'sine' || kind === 'keys').forEach(o => lg.connect(o.frequency)); os.push(lfo); }
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.005);
        if (kind === 'pluck') g.gain.setTargetAtTime(0.0001, t + 0.01, 0.1);
        else { g.gain.setTargetAtTime(peak * (kind === 'keys' ? 0.35 : 0.72), t + 0.01, kind === 'keys' ? 0.6 : 0.12); g.gain.setTargetAtTime(0.0001, t + dur, rel); }
        lp.connect(g); const o2 = M.pan(g, pan); o2.connect(master); M.send(g, rv, dl);
        os.forEach(o => { o.start(t); o.stop(t + dur + rel * 6 + 0.1); });
      },
      bell(t, m, v = 1, len = 1.6, pan = -0.12, rv = 0.45, dl = 0.3) {
        const f = mf(m), c = ac.createOscillator(), mo = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
        c.frequency.value = f; mo.frequency.value = f * 3.5; mg.gain.setValueAtTime(f * 2.4, t); mg.gain.setTargetAtTime(f * 0.22, t, 0.16);
        mo.connect(mg); mg.connect(c.frequency);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2 * v, t + 0.002); g.gain.setTargetAtTime(0.0001, t + 0.004, len / 3.2);
        c.connect(g); const o = M.pan(g, pan); o.connect(master); M.send(g, rv, dl);
        c.start(t); mo.start(t); c.stop(t + len + 0.3); mo.stop(t + len + 0.3);
      },
      pad(t, notes, dur, v = 1, cut = 1700, open) {
        const g = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
        if (open) { lp.frequency.setValueAtTime(380, t); lp.frequency.exponentialRampToValueAtTime(cut, t + dur); } else lp.frequency.value = cut;
        const os = [];
        notes.forEach((m, i) => [-8, 8].forEach(dc => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mf(m); o.detune.value = dc; const og = ac.createGain(); og.gain.value = 0.5 / notes.length; o.connect(og); og.connect(lp); os.push(o); }));
        const pk = 0.3 * v; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + Math.min(0.25, dur * 0.3)); g.gain.setTargetAtTime(0.0001, t + dur, 0.2);
        lp.connect(g); g.connect(duck); M.send(g, 0.3);
        os.forEach(o => { o.start(t); o.stop(t + dur + 1.4); });
      },
      tri(t, m, dur, v = 1) {
        const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = mf(m);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.42 * v, t + 0.004); g.gain.setValueAtTime(0.42 * v, t + dur * 0.9); g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
      },
      bass(t, m, dur, v = 1) {
        const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = mf(m); lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(950, t); lp.frequency.setTargetAtTime(260, t, 0.05);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * v, t + 0.005); g.gain.setTargetAtTime(0.0001, t + dur, 0.03);
        o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.2);
        const s = ac.createOscillator(), sg = ac.createGain(); s.frequency.value = mf(m); sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(0.4 * v, t + 0.005); sg.gain.setTargetAtTime(0.0001, t + dur, 0.03); s.connect(sg); sg.connect(master); s.start(t); s.stop(t + dur + 0.2);
      },
      finish() {
        ducks.sort((a, b) => a[0] - b[0]).forEach(([t, d]) => { duck.gain.setValueAtTime(1, t); duck.gain.linearRampToValueAtTime(1 - d, t + 0.008); duck.gain.setTargetAtTime(1, t + 0.012, 0.075); });
      },
    };
    return M;
  }

  // ---------- the arrangements ----------
  function build(ac, out, o) {
    const G = genes(o), S = G.S, spb = 60 / S.bpm, s16 = spb / 4, bar = spb * 4, t0 = o.t0 || 0.05;
    const notes = spell(o.symbol, G.root), ph = phrase(notes, G.root);
    const chords = G.prog.map(d => chordOf(d, G.root)), bass = G.prog.map(d => bassOf(d, G.root)), tonic = chordOf(0, G.root), troot = bassOf(0, G.root);
    const sw = S.swing || 0, at = (b, p) => t0 + b * bar + p * s16 + (sw && Math.floor(p) % 2 === 1 ? sw * s16 : 0);
    const M = Mixer(ac, out); M.setDelay(s16 * 3);
    const hits = [];                                                 // when each letter sounds, for the pads on screen
    const melody = (b, kind, v, oct = 0, extra) => ph.forEach(e => { const t = at(b, e.p); M.lead(t, e.m + oct, e.l * s16, v, kind, 0, 0.22, 0.2); if (extra) extra(t, e); hits.push({ t: t - t0, i: e.i, m: e.m, d: e.l * s16 }); });
    const bells = (b, v = 0.9, oct = 0) => ph.forEach(e => { const t = at(b, e.p); M.bell(t, e.m + oct, v, 1.7); hits.push({ t: t - t0, i: e.i, m: e.m, d: e.l * s16 }); });
    const end = t => { M.kick(t, 1, 0); M.b808(t, troot, 2.6, 0.9); M.crash(t); M.boom(t, 0.7); M.pad(t, tonic, 1.2, 1); tonic.concat([tonic[0] + 12]).forEach((m, i) => M.bell(t + i * 0.012, m + 12, 0.55 + (i === 3 ? 0.3 : 0), 3)); hits.push({ t: t - t0, i: -1, m: tonic[0] + 12, d: 2 }); };
    const st = G.style, last = S.bars;
    if (st === 'trap') {
      M.pad(at(0, 0), chords[0], bar, 0.9, 2400, true); M.pad(at(1, 0), chords[1], bar, 0.9, 2600, true);
      bells(0, 0.95);
      for (let p = 8; p < 16; p += 2) M.hat(at(1, p), 0.3 + 0.04 * (p - 8));
      [8, 9, 10, 11, 12, 12.5, 13, 13.5, 14, 14.5, 15].forEach((p, k) => M.clap(at(1, p), 0.16 + 0.05 * k, 0.12));
      M.riser(at(1, 0), bar - s16 * 0.5, 0.9);
      const KS = [[0, 10], [0, 7, 10], [0, 10], [0, 3, 10, 13]];
      for (let b = 2; b < last; b++) {
        const k = (b - 2) % 4, ks = KS[k];
        if (k === 0) { M.crash(at(b, 0), b === 2 ? 1 : 0.7); if (b === 2) M.boom(at(b, 0)); }
        M.pad(at(b, 0), chords[k], bar, 1);
        ks.forEach((p, j) => { const nx = j + 1 < ks.length ? ks[j + 1] : 16; M.kick(at(b, p), p === 0 || p === 10 ? 1 : 0.8); M.b808(at(b, p), bass[k], (nx - p) * s16 - 0.01, 1, k === 3 && j === ks.length - 1 ? bass[(k + 1) % 4] : 0); });
        M.clap(at(b, 8), 1); if (k === 3) M.clap(at(b, 15), 0.45);
        for (let p = 0; p < 16; p += 2) { if (k === 3 && p >= 12) continue; if (k === 1 && p === 14) { M.hat(at(b, p), 0.7, true); continue; } M.hat(at(b, p) + (p % 4 ? 0.006 : 0), p % 4 === 0 ? 0.85 : 0.55); }
        if (k === 1) [12, 13].forEach(p => M.hat(at(b, p), 0.4));
        if (k === 3) for (let i = 0; i < 9; i++) M.hat(at(b, 12 + i * 4 / 9), 0.35 + 0.06 * i);
      }
      for (let b = 2; b < last; b += 2) melody(b, 'saw', 1, 0, b >= 6 ? (t, e) => M.bell(t, e.m + 12, 0.3, 1, -0.3, 0.4, 0) : null);
    } else if (st === 'house') {
      for (let b = 0; b < last; b++) {
        const k = b % 4;
        for (let p = 0; p < 16; p += 4) M.kick(at(b, p), 1, b < 2 ? 0.3 : 0.5);
        for (let p = 0; p < 16; p++) M.hat(at(b, p), p % 2 ? 0.28 : 0.18, false, 0.35);
        if (b < 2) { M.pad(at(b, 0), chords[k], bar, 0.8, 1500, true); continue; }
        if (b === 2) M.crash(at(b, 0));
        [4, 12].forEach(p => M.clap(at(b, p), 0.95));
        [2, 6, 10, 14].forEach(p => { M.hat(at(b, p), 0.6, true, -0.2); M.bass(at(b, p), bass[k] + 12, s16 * 1.6, 0.9); });
        [6, 14].forEach(p => chords[k].forEach((m, i) => M.lead(at(b, p), m + 12, s16 * 1.5, 0.42, 'pluck', i % 2 ? 0.3 : -0.3, 0.25, 0.1)));
        M.pad(at(b, 0), chords[k], bar, 0.55, 1300);
      }
      bells(0, 0.9);
      M.riser(at(1, 8), bar / 2 - s16 * 0.5, 0.7);
      for (let b = 2; b < last; b += 2) melody(b, 'pluck', 1.05, 12);
    } else if (st === 'lofi') {
      M.crackle(at(0, 0), last * bar + 2.5, 1);
      for (let b = 0; b < last; b++) {
        const k = b % 4;
        chords[k].forEach((m, i) => M.lead(at(b, 0) + i * 0.018, m, bar * 0.9, 0.42, 'keys', i % 2 ? 0.2 : -0.2, 0.3, 0));
        if (b === 0) continue;
        [0, 7, 10].forEach(p => M.kick(at(b, p), p ? 0.7 : 0.85, 0.25));
        [4, 12].forEach(p => M.snare(at(b, p), 0.75));
        for (let p = 0; p < 16; p += 2) M.hat(at(b, p), 0.32, false, 0.2);
        M.b808(at(b, 0), bass[k] + 12, bar * 0.62, 0.5); M.b808(at(b, 10), bass[k] + 12, bar * 0.36, 0.42);
      }
      for (let b = 1; b < last; b += 2) melody(b, 'keys', 1.1, 0, (t, e) => M.bell(t, e.m + 12, 0.22, 1.2, -0.25, 0.35, 0));
    } else {                                                          // chip
      for (let b = 0; b < last; b++) {
        const k = b % 4, ch = chords[k].concat([chords[k][0] + 12]);
        for (let p = 0; p < 16; p++) M.lead(at(b, p), ch[[0, 1, 2, 3, 2, 1][p % 6]] + 12, s16 * 0.9, 0.38, 'square', p % 2 ? 0.25 : -0.25, 0.08, 0);
        if (b < 2) continue;
        for (let p = 0; p < 16; p += 2) M.tri(at(b, p), bass[k] + (p % 4 ? 19 : 12), s16 * 1.8, 0.9);
        [0, 8, 11].forEach(p => M.kick(at(b, p), 0.85, 0.3));
        [4, 12].forEach(p => M.snare(at(b, p), 0.7));
        for (let p = 2; p < 16; p += 4) M.hat(at(b, p), 0.4, false, 0);
      }
      M.crash(at(2, 0), 0.7);
      melody(0, 'square', 0.9, 0); for (let b = 2; b < last; b += 2) melody(b, 'square', 1.1, b >= 6 ? 12 : 0);
    }
    end(at(last, 0));
    M.finish();
    hits.sort((a, b) => a.t - b.t);
    return { duration: last * bar + 0.05 + S.tail, hits, notes, genes: G, bar, s16 };
  }

  // ---------- playing, one track at a time ----------
  let AC = null, cur = null;
  function ctx() {
    if (!AC) { const C = window.AudioContext || window.webkitAudioContext; if (!C) throw new Error('This browser can’t play sound.'); AC = new C({ latencyHint: 'interactive' }); }
    if (AC.state !== 'running') AC.resume().catch(() => {});
    return AC;
  }
  const listeners = new Set();
  function emit(kind, p) { listeners.forEach(f => { try { f(kind, p); } catch {} }); }
  function stop() { if (!cur) return; const p = cur; cur = null; try { p.out.gain.setTargetAtTime(0.0001, p.ac.currentTime, 0.03); } catch {} setTimeout(() => { try { p.out.disconnect(); } catch {} }, 400); clearTimeout(p.tm); emit('stop', p); }
  function play(o) {
    stop();
    const ac = ctx(), out = ac.createGain(), an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.72;
    out.connect(an); an.connect(ac.destination);
    const t0 = ac.currentTime + 0.08, info = build(ac, out, Object.assign({}, o, { t0 }));
    const p = Object.assign({ ac, out, analyser: an, t0, o, time: () => ac.currentTime - t0, id: Math.random() }, info);
    p.tm = setTimeout(() => { if (cur === p) { cur = null; emit('end', p); try { out.disconnect(); } catch {} } }, (info.duration + 0.2) * 1000);
    cur = p; emit('play', p); return p;
  }
  const playing = () => cur;
  // one note, now (the pads you press)
  let HM = null;
  function hit(m, style) {
    const ac = ctx(); if (!HM || HM.ac !== ac) { const out = ac.createGain(); out.connect(ac.destination); HM = Mixer(ac, out); }
    const M = HM, t = ac.currentTime + 0.01, st = STY[style] ? style : 'trap';
    if (st === 'chip') M.lead(t, m, 0.22, 0.9, 'square', 0, 0.1, 0); else if (st === 'lofi') M.lead(t, m, 0.6, 0.9, 'keys', 0, 0.3, 0); else if (st === 'house') M.lead(t, m + 12, 0.3, 1, 'pluck', 0, 0.25, 0.1); else M.bell(t, m, 0.9, 1.4, 0, 0.3, 0.12);
  }

  // a ticker's notes, played quickly (the radio): onNote(i) fires as each one sounds
  function motif(o, onNote) {
    const G = genes(o), ns = spell(o.symbol, G.root), ac = ctx(), gap = 0.135;
    if (!HM || HM.ac !== ac) { const out = ac.createGain(); out.connect(ac.destination); HM = Mixer(ac, out); }
    const t0 = ac.currentTime + 0.03;
    ns.forEach((m, i) => { const t = t0 + i * gap; if (G.style === 'chip') HM.lead(t, m, 0.12, 0.8, 'square', 0, 0.1, 0); else HM.bell(t, m, 0.8, 1.2, 0, 0.35, 0.1); if (onNote) setTimeout(() => onNote(i), (t - ac.currentTime) * 1000); });
    const end = t0 + ns.length * gap; HM.bell(end + 0.02, ns.length ? ns[0] - 12 : 60, 0.35, 1.4, 0, 0.4, 0);
    return (ns.length * gap + 0.6) * 1000;
  }

  // ---------- files: wav, mp3, and a video you can post ----------
  async function render(o) {
    const C = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!C) throw new Error('This browser can’t render audio. Try Chrome or Safari.');
    const dur = length(o), oc = new C(2, Math.ceil(44100 * dur), 44100);
    const info = build(oc, oc.destination, Object.assign({}, o, { t0: 0.05 }));
    const buf = await oc.startRendering(); buf.info = info; return buf;
  }
  function wav(buf) {
    const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, bl = n * ch * 2, ab = new ArrayBuffer(44 + bl), v = new DataView(ab);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + bl, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, bl, true);
    const cs = []; for (let c = 0; c < ch; c++) cs.push(buf.getChannelData(c));
    let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, cs[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Blob([ab], { type: 'audio/wav' });
  }
  let lame = null;
  function loadLame() { if (window.lamejs) return Promise.resolve(window.lamejs); if (lame) return lame; lame = new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/assets/vendor/lame.min.js'; s.onload = () => ok(window.lamejs); s.onerror = () => { lame = null; no(new Error('Couldn’t load the mp3 encoder. Check your connection.')); }; document.head.appendChild(s); }); return lame; }
  async function mp3(buf, onProgress) {
    const L = await loadLame(), enc = new L.Mp3Encoder(2, buf.sampleRate, 192), n = buf.length, a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
    const toI = (x, s, e) => { const o = new Int16Array(e - s); for (let i = s; i < e; i++) { const v = Math.max(-1, Math.min(1, x[i])); o[i - s] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
    const parts = [], step = 1152 * 20;
    for (let i = 0; i < n; i += step) { const e = Math.min(n, i + step), d = enc.encodeBuffer(toI(a, i, e), toI(b, i, e)); if (d.length) parts.push(new Uint8Array(d)); if (onProgress) onProgress(e / n); if ((i / step) % 8 === 7) await new Promise(r => setTimeout(r)); }
    const f = enc.flush(); if (f.length) parts.push(new Uint8Array(f));
    return new Blob(parts, { type: 'audio/mpeg' });
  }
  function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000); }
  // a vertical video: the track playing, its pads lighting up letter by letter, recorded in real time
  async function video(o, onProgress) {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('This browser can’t record video. Try Chrome or Safari.');
    const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mime = types.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } });
    if (!mime) throw new Error('This browser can’t record video. Try Chrome or Safari.');
    const buf = await render(o), info = buf.info;
    const ac = ctx(), cv = document.createElement('canvas'); cv.width = 720; cv.height = 1280; const g = cv.getContext('2d');
    const src = ac.createBufferSource(), an = ac.createAnalyser(), dest = ac.createMediaStreamDestination(); src.buffer = buf; an.fftSize = 2048; src.connect(an); an.connect(dest);
    const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5e6, audioBitsPerSecond: 192000 }), chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((ok, no) => { rec.onstop = () => ok(new Blob(chunks, { type: mime.split(';')[0] })); rec.onerror = e => no(e.error || new Error('Recording failed.')); });
    const T = buf.duration, view = { hits: info.hits, notes: info.notes, symbol: o.symbol, style: o.style, title: o.title };
    draw(g, 720, 1280, 0, an, view);
    rec.start(250); const ts = ac.currentTime + 0.12; src.start(ts);
    await new Promise(res => { const iv = setInterval(() => { const t = ac.currentTime - ts; draw(g, 720, 1280, Math.max(0, t - 0.05), an, view); if (onProgress) onProgress(Math.min(1, t / T)); if (t >= T + 0.15) { clearInterval(iv); res(); } }, 1000 / 30); });
    rec.stop(); src.disconnect();
    return { blob: await done, ext: mime.includes('mp4') ? 'mp4' : 'webm' };
  }

  // ---------- pictures: the pads, the spectrum, the cover ----------
  const FONT = '"SG", "Space Grotesk", ui-sans-serif, system-ui, sans-serif';
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16), c = [n >> 16, n >> 8 & 255, n & 255].map(v => Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k)); return `rgb(${c[0]},${c[1]},${c[2]})`; }
  // one pad: lit is 0..1 (how hard it was just hit)
  function padShape(g, x, y, s, col, lit, label) {
    const r = s * 0.18;
    g.fillStyle = '#060606'; rr(g, x - s * 0.04, y - s * 0.04, s * 1.08, s * 1.08, r * 1.15); g.fill();
    if (lit > 0.01) { g.globalAlpha = 0.18 * lit; g.fillStyle = col; rr(g, x - s * 0.16, y - s * 0.16, s * 1.32, s * 1.32, r * 1.6); g.fill(); g.globalAlpha = 1; }
    const k = 0.42 + 0.58 * lit;
    g.fillStyle = shade(col, 0.62 * k); rr(g, x, y, s, s, r); g.fill();
    g.fillStyle = shade(col, k); rr(g, x + s * 0.06, y + s * 0.045, s * 0.88, s * 0.88, r * 0.8); g.fill();
    g.fillStyle = shade(col, k * 1.06 > 1 ? 1 + (k * 1.06 - 1) : k * 1.06); rr(g, x + s * 0.2, y + s * 0.18, s * 0.6, s * 0.6, r * 0.6); g.fill();
    if (label) { g.fillStyle = lit > 0.3 ? 'rgba(20,8,4,.9)' : 'rgba(10,10,10,.75)'; g.font = `700 ${Math.round(s * 0.5)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x + s / 2, y + s * 0.5); }
  }
  function grain(g, w, h, seed, a) { const r = rng(seed || 'g'); g.fillStyle = `rgba(255,255,255,${a || 0.035})`; for (let i = 0; i < w * h / 90; i++) g.fillRect(r() * w, r() * h, 1, 1); }
  function bg(g, w, h) { g.fillStyle = '#121214'; g.fillRect(0, 0, w, h); const v = g.createRadialGradient(w / 2, h * 0.45, h * 0.1, w / 2, h / 2, h * 0.8); v.addColorStop(0, 'rgba(255,255,255,.03)'); v.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = v; g.fillRect(0, 0, w, h); }
  function litOf(hits, i, t) { let v = 0; for (const h of hits) { if (h.t > t) break; if (h.i === i || h.i === -1) v = Math.max(v, Math.exp(-(t - h.t) / 0.32)); } return v; }
  // the video frame
  function draw(g, w, h, t, an, v) {
    const col = (STY[v.style] || STY.trap).color, sym = String(v.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    bg(g, w, h); grain(g, w, h, sym, 0.03);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.font = `700 ${Math.round(w * 0.12)}px ${FONT}`; g.fillText('$' + sym, w / 2, h * 0.2);
    if (v.title) { g.fillStyle = 'rgba(255,255,255,.62)'; g.font = `500 ${Math.round(w * 0.04)}px ${FONT}`; g.fillText(v.title.slice(0, 40), w / 2, h * 0.255); }
    const n = Math.max(1, sym.length), cols = n > 5 ? Math.ceil(n / 2) : n, rows = n > 5 ? 2 : 1, s = Math.min(w * 0.8 / cols, 150), gap = s * 0.16;
    const gx = (w - (cols * s + (cols - 1) * gap)) / 2, gy = h * 0.42 - (rows * s + (rows - 1) * gap) / 2;
    for (let i = 0; i < n; i++) { const c = i % cols, r = Math.floor(i / cols); padShape(g, gx + c * (s + gap), gy + r * (s + gap), s, col, litOf(v.hits, i, t), sym[i]); }
    if (an) {
      const d = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(d);
      const nb = 48, bw = w * 0.8 / nb, base = h * 0.78;
      for (let i = 0; i < nb; i++) { const lo = Math.floor(Math.pow(i / nb, 2) * 300) + 2, hi = Math.floor(Math.pow((i + 1) / nb, 2) * 300) + 3; let m = 0; for (let k = lo; k < hi; k++) m = Math.max(m, d[k] || 0); const bh = 6 + (m / 255) * h * 0.14; g.fillStyle = i / nb < 0.5 ? col : shade(col, 0.75); rr(g, w * 0.1 + i * bw + bw * 0.2, base - bh / 2, bw * 0.6, bh, bw * 0.3); g.fill(); }
    }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `600 ${Math.round(w * 0.034)}px ${FONT}`; g.fillText('every ticker has a sound.', w / 2, h * 0.9);
    g.fillStyle = col; g.font = `700 ${Math.round(w * 0.04)}px ${FONT}`; g.fillText('soundpad', w / 2, h * 0.94);
  }
  // the coin's picture: one lit pad, its bars drawn from the ticker's own notes
  function coverCanvas(o, px) {
    const cv = document.createElement('canvas'); cv.width = cv.height = px || 768; const g = cv.getContext('2d'), W = cv.width;
    const col = (STY[o.style] || STY.trap).color, G = genes(o), ns = spell(o.symbol, G.root);
    bg(g, W, W); grain(g, W, W, o.seed, 0.04);
    const s = W * 0.56, x = (W - s) / 2, y = W * 0.11;
    g.globalAlpha = 0.14; g.fillStyle = col; rr(g, x - s * 0.14, y - s * 0.14, s * 1.28, s * 1.28, s * 0.3); g.fill(); g.globalAlpha = 1;
    padShape(g, x, y, s, col, 1, '');
    const bars = ns.length ? ns : [60], lo = Math.min(...bars), hi = Math.max(...bars), nb = bars.length, bw = Math.min(s * 0.09, s * 0.62 / (nb * 1.6)), gp = bw * 0.6, tot = nb * bw + (nb - 1) * gp;
    bars.forEach((m, i) => { const hh = s * (0.2 + 0.42 * (hi > lo ? (m - lo) / (hi - lo) : 0.6)); g.fillStyle = 'rgba(20,8,4,.88)'; rr(g, x + s / 2 - tot / 2 + i * (bw + gp), y + s / 2 - hh / 2, bw, hh, bw / 2); g.fill(); });
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; const sym = '$' + String(o.symbol || '').toUpperCase().slice(0, 10);
    g.font = `700 ${Math.round(W * (sym.length > 8 ? 0.09 : 0.11))}px ${FONT}`; g.fillText(sym, W / 2, W * 0.93);
    return cv;
  }
  const cover = (o, px) => coverCanvas(o, px).toDataURL('image/jpeg', 0.92);
  const ready = () => (document.fonts ? document.fonts.load(`700 40px ${FONT}`).catch(() => null) : Promise.resolve());
  const newSeed = () => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; for (const b of crypto.getRandomValues(new Uint8Array(10))) s += a[b % a.length]; return s; };
  const describe = o => { const G = genes(o), ns = spell(o.symbol, G.root); return { key: G.key, bpm: G.S.bpm, style: G.S.label, notes: ns.map(m => NAMES[m % 12]), seconds: Math.round(length(o)) }; };

  window.Snd = { STY, spell, genes, describe, length, play, stop, playing, hit, motif, render, wav, mp3, video, save, cover, coverCanvas, draw, padShape, litOf, ready, newSeed, ctx, on: f => listeners.add(f), NAMES, calm };
})();
