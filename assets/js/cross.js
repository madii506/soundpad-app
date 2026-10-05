// Soundpad: a launch on pump.fun. One wallet prompt signs the transactions the server built with pump's own SDK:
//   1  the token (create_v2, creator = you) + its fee-sharing config
//   2  its split, locked forever: 70% you, 15% its first listeners (drawn from $SOUNDPAD listeners), 15% the house
//   3  your first buy (optional), after the split is locked
// Before you sign, this page reads the transactions itself: the token is the one made here, the creator is you, and the
// split is exactly the one shown.
(function () {
  'use strict';
  const C = window.Core;
  const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
  const D_CREATE = '214,144,76,236,95,139,49,180', D_UPDATE = '111,251,49,6,78,78,106,18';
  // the opening curve, for the estimate shown before anything is built (the build itself uses the live Global)
  const VSOL = 30, VTOK = 1073000000, SUPPLY = 1e9, FEE = 0.0125;
  function quote(lam) { if (!lam) return null; const sol = Number(lam) / 1e9; if (sol > 5) return { over: true }; const net = sol * (1 - FEE), tokens = VTOK * net / (VSOL + net); return { tokens, pct: tokens / SUPPLY * 100 }; }
  const STEPS = ['Making its sound', 'Drawing its first listeners', 'Building the transactions', 'Reading them before you sign', 'Waiting for your wallet', 'Launching the token', 'Locking the split', 'Your first buy', 'Its first track title'];

  // the split the server wrote: you first with at least 70%, at most 8 godparents sharing at most 15%, the house at most 15%
  function sane(shares, me, house, gods) {
    if (!Array.isArray(shares) || !shares.length || shares.length > 10) return false;
    if (shares.reduce((t, s) => t + s.bps, 0) !== 10000) return false;
    if (shares[0].address !== me || shares[0].bps < 7000) return false;
    const seen = new Set(), godset = new Set((gods || []).map(g => g.wallet)); let godBps = 0;
    for (const s of shares.slice(1)) {
      if (seen.has(s.address) || s.address === me) return false; seen.add(s.address);
      if (s.address === house) { if (s.bps > 1500) return false; } else if (godset.has(s.address)) godBps += s.bps; else return false;
    }
    return godBps <= 1500;
  }
  function ixs(tx) { const m = tx.message, keys = m.staticAccountKeys.map(k => k.toBase58()); return m.compiledInstructions.map(ix => ({ prog: keys[ix.programIdIndex], keys: ix.accountKeyIndexes.map(i => keys[i]), data: ix.data })); }
  const head = d => Array.from(d.slice(0, 8)).join(',');
  function b58(bytes) { const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b === 0) s = '1' + s; else break; } return s; }
  const same = (x, y) => x.length === y.length && x.every((s, k) => s.address === y[k].address && s.bps === y[k].bps);
  function check(txs, want) {
    const create = ixs(txs[0]).find(i => i.prog === PUMP && head(i.data) === D_CREATE);
    if (!create) throw new Error('The token creation is missing, so nothing was signed.');
    if (create.keys[0] !== want.mint) throw new Error('That isn’t the token made here, so nothing was signed.');
    const d = create.data; let o = 8; for (let k = 0; k < 3; k++) { const n = d[o] | d[o + 1] << 8 | d[o + 2] << 16 | d[o + 3] << 24; o += 4 + n; }
    if (b58(d.slice(o, o + 32)) !== want.me) throw new Error('The token’s creator isn’t you, so nothing was signed.');
    const up = ixs(txs[1]).find(i => i.prog === FEES && head(i.data) === D_UPDATE);
    if (!up) throw new Error('The split is missing, so nothing was signed.');
    const u = up.data, n = u[8] | u[9] << 8 | u[10] << 16 | u[11] << 24, got = [];
    for (let k = 0, p = 12; k < n; k++, p += 34) got.push({ address: b58(u.slice(p, p + 32)), bps: u[p + 32] | u[p + 33] << 8 });
    if (!same(got, want.shares)) throw new Error('The split isn’t the one shown, so nothing was signed.');
    return got;
  }

  // o: { name, symbol, line, style, seed, x, devBuy (lamports, BigInt), onStep, onDraw }
  async function run(o) {
    const w3 = await C.loadWeb3(), kp = w3.Keypair.generate(), m = kp.publicKey.toBase58(), step = o.onStep || (() => {});
    step(0); const image = window.Snd.cover({ seed: o.seed, style: o.look, symbol: o.symbol }, 768);
    step(1);
    const meta = await C.post('/api/meta', { mint: m, payer: C.S.me, name: o.name, symbol: o.symbol, line: o.line, look: o.look, caption: o.caption, seed: o.seed, x: o.x, image });
    if (!meta.ok) throw new Error(meta.error);
    if (!sane(meta.shares, C.S.me, meta.studio, meta.gods)) throw new Error('The split didn’t match the rules shown, so nothing was sent. Reload and try again.');
    const want = meta.shares; o.onDraw && o.onDraw(meta);
    step(2);
    const b = await C.post('/api/build', { mint: m, payer: C.S.me, devBuy: String(o.devBuy || 0n) });
    if (!b.ok) throw new Error(b.error);
    const txs = b.txs.map(t => w3.VersionedTransaction.deserialize(Uint8Array.from(atob(t), c => c.charCodeAt(0))));
    step(3); check(txs, { mint: m, me: C.S.me, shares: want });
    await C.simulate(txs[0]);
    step(4); const signed = await C.signAll(txs); signed[0].sign([kp]);
    if (!signed[0].signatures.every(s => s && s.some(v => v !== 0))) throw new Error('A signature is missing, so nothing was sent.');
    step(5); const sig = await C.send(signed[0]); await C.confirm(sig);
    step(6);
    let routed = false;
    try { const s2 = await C.send(signed[1]); await C.confirm(s2); routed = true; }
    catch (e) { routed = await route(m).catch(() => false); }
    if (!routed) throw Object.assign(new Error('It’s on pump.fun, but its split isn’t locked yet. Open its page to finish: one more signature.'), { mint: m });
    let buyNote = null;
    if (signed[2]) { step(7); try { const s3 = await C.send(signed[2]); await C.confirm(s3); } catch { buyNote = 'It’s live; your first buy didn’t confirm. Check your wallet.'; } }
    step(8);
    let st = null; for (let i = 0; i < 8; i++) { st = await C.post('/api/settle', { mint: m }).catch(() => null); if (st && st.live) break; await new Promise(r => setTimeout(r, 2500)); }
    return { mint: m, sig, settle: st, buyNote, meta, shares: want };
  }
  // finish a launch whose coin landed but whose split didn't: rebuild just that transaction and sign it again
  async function route(mint) {
    const w3 = await C.loadWeb3();
    const b = await C.post('/api/build', { mint, payer: C.S.me, only: 'route' }); if (!b.ok) throw new Error(b.error);
    const tx = w3.VersionedTransaction.deserialize(Uint8Array.from(atob(b.txs[0]), c => c.charCodeAt(0)));
    const [signed] = await C.signAll([tx]); const s = await C.send(signed); await C.confirm(s);
    await C.post('/api/settle', { mint }).catch(() => null); return true;
  }
  // pay out: anyone can push a coin's waiting fees out of pump's vault, to every share of its split at once
  async function feed(mint) {
    const w3 = await C.loadWeb3();
    if (!C.S.me) { const ok = await C.connect(); if (!ok) return null; }
    const b = await C.post('/api/feed', mint ? { mint, payer: C.S.me } : { payer: C.S.me }); if (!b.ok) throw new Error(b.error);
    const tx = w3.VersionedTransaction.deserialize(Uint8Array.from(atob(b.tx), c => c.charCodeAt(0)));
    const [signed] = await C.signAll([tx]); const s = await C.send(signed); await C.confirm(s); return { sig: s, waiting: b.waiting };
  }
  function steps(el, i, done) { el.hidden = false; el.innerHTML = STEPS.map((s, k) => `<div class="${k < i || done ? 'done' : k === i ? 'now' : ''}">${s}</div>`).join(''); }
  function buyBox(root, onChange) {
    root.innerHTML = `<button type="button" class="chip on" data-v="0">no first buy</button><button type="button" class="chip" data-v="0.1">0.1 SOL</button><button type="button" class="chip" data-v="0.5">0.5 SOL</button><button type="button" class="chip" data-v="1">1 SOL</button><input inputmode="decimal" aria-label="First buy in SOL" placeholder="other"><span class="q"></span>`;
    const inp = root.querySelector('input'), qel = root.querySelector('.q'); let v = 0;
    const lam = () => (isFinite(v) && v > 0 ? BigInt(Math.round(v * 1e9)) : 0n);
    const show = () => {
      root.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', Number(c.dataset.v) === v && !inp.value));
      const l = lam(); if (!l) { qel.textContent = ''; return onChange && onChange(); }
      const r = quote(l); qel.textContent = r.over ? 'Up to 5 SOL in the first buy.' : `≈ ${r.tokens >= 1e6 ? (r.tokens / 1e6).toFixed(1) + 'M' : Math.round(r.tokens).toLocaleString()} tokens · ≈ ${r.pct.toFixed(2)}% of supply on the opening curve.`;
      onChange && onChange();
    };
    root.addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; v = Number(b.dataset.v); inp.value = ''; show(); });
    inp.addEventListener('input', () => { const n = parseFloat(String(inp.value).replace(',', '.')); v = isFinite(n) && n > 0 ? n : 0; show(); });
    show();
    return { lamports: lam, over: () => { const r = quote(lam()); return !!(r && r.over); }, refresh: show };
  }
  window.Cross = { run, route, feed, STEPS, steps, buyBox, quote, sane };
})();
