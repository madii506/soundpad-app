// Soundpad core: helpers, wallet connect (Phantom, Solflare, Backpack), Solana via /api/rpc, sheet, toast, reveal.
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (a, n = 4) => (a ? String(a).slice(0, n) + '…' + String(a).slice(-n) : '');
  const usd = v => (v == null || !isFinite(v) ? '—' : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? '$' + (v / 1e3).toFixed(1) + 'K' : v >= 1 ? '$' + v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 }) : '$' + v.toFixed(2));
  const sol = l => { const v = Number(l) / 1e9; return (v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v >= .01 ? v.toFixed(4) : v.toFixed(5)).replace(/\.?0+$/, '') + ' SOL'; };
  const ago = t => { const s = Math.max(1, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const say = t => { const el = $('#live-sr'); if (el) el.textContent = t; };
  const solscan = (kind, v) => 'https://solscan.io/' + kind + '/' + v;

  async function get(url) { const r = await fetch(url); return r.json(); }
  async function post(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); }
  async function rpc(method, params) { const j = await post('/api/rpc', { method, params }); if (!j.ok) { const e = new Error(j.error || 'Solana didn’t answer.'); e.logs = j.logs; throw e; } return j.result; }

  let tt; function toast(t, ms = 3400) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), ms); say(t); }
  async function copy(t) { try { await navigator.clipboard.writeText(t); toast('Copied.'); } catch { toast('Couldn’t copy. Select it and copy by hand.'); } }

  // ---------- sheet ----------
  function sheet(title, html) {
    const s = $('#sheet'); $('#sheetTitle').textContent = title; $('#sheetBody').innerHTML = html; s.hidden = false; document.body.style.overflow = 'hidden';
    setTimeout(() => { const f = $('#sheetBody input, #sheetBody button'); if (f && !matchMedia('(pointer:coarse)').matches) f.focus(); }, 30);
  }
  function closeSheet() { const s = $('#sheet'); if (s.hidden) return; s.hidden = true; document.body.style.overflow = ''; const a = closeSheet.after; closeSheet.after = null; a && a(); }
  document.addEventListener('click', e => { if (e.target.id === 'sheet' || e.target.closest('#sheetX')) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  // ---------- wallets ----------
  const S = { me: null, prov: null };
  const PROVS = [
    { id: 'phantom', name: 'Phantom', col: '#ab9ff2', get: () => (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom && window.solana), url: 'https://phantom.com', deep: u => 'https://phantom.app/ul/browse/' + encodeURIComponent(u) + '?ref=' + encodeURIComponent(location.origin) },
    { id: 'solflare', name: 'Solflare', col: '#fc7227', get: () => (window.solflare && window.solflare.isSolflare && window.solflare) || null, url: 'https://solflare.com', deep: u => 'https://solflare.com/ul/v1/browse/' + encodeURIComponent(u) + '?ref=' + encodeURIComponent(location.origin) },
    { id: 'backpack', name: 'Backpack', col: '#e33e3f', get: () => window.backpack && (window.backpack.solana || window.backpack), url: 'https://backpack.app', deep: null },
  ];
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const listeners = []; const onWallet = f => listeners.push(f);
  function connect() {
    return new Promise(res => {
      const row = p => {
        const has = !!p.get(), ic = `<i class="wic" style="background:${p.col}">${p.name[0]}</i>`;
        if (has) return `<button type="button" data-p="${p.id}">${ic}${p.name}<small>detected</small></button>`;
        const href = mobile && p.deep ? p.deep(location.href) : p.url;
        return `<a href="${href}" target="_blank" rel="noopener">${ic}${p.name}<small class="off">${mobile && p.deep ? 'open in app' : 'install'} ↗</small></a>`;
      };
      sheet('connect a wallet', `<div class="wlist">${PROVS.map(row).join('')}</div>`);
      $$('#sheetBody [data-p]').forEach(b => b.addEventListener('click', async () => {
        const p = PROVS.find(x => x.id === b.dataset.p), pr = p.get();
        try { const r = await pr.connect(); const pk = (r && r.publicKey) || pr.publicKey; if (!pk) throw 0; setMe(pk.toString(), pr, p.id); closeSheet.after = null; closeSheet(); res(true); }
        catch { toast('The wallet didn’t connect.'); res(false); }
      }));
      closeSheet.after = () => res(false);
    });
  }
  function setMe(pk, pr, id) {
    S.me = pk; S.prov = pr; store.set('sp-wallet', id);
    const b = $('#walletBtn'); b.classList.add('on'); b.innerHTML = `<i></i><span>${short(pk)}</span>`;
    if (pr.on) try { pr.on('accountChanged', k => { if (k) setMe(k.toString(), pr, id); else logout(); }); } catch {}
    listeners.forEach(f => f(S.me));
  }
  function logout() { try { S.prov && S.prov.disconnect && S.prov.disconnect(); } catch {} S.me = S.prov = null; store.set('sp-wallet', null); const b = $('#walletBtn'); b.classList.remove('on'); b.innerHTML = '<i></i><span>connect</span>'; listeners.forEach(f => f(null)); }
  $('#walletBtn').addEventListener('click', async () => {
    if (!S.me) { await connect(); return; }
    sheet('your wallet', `<p style="margin:0 0 6px;word-break:break-all;font-size:13px">${S.me}</p><p class="note" id="balLine" style="margin-top:0">Reading balance…</p>
      <div id="myCoins"></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="btn sm ghost" type="button" id="cpBtn">Copy address</button><button class="btn sm ghost" type="button" id="outBtn">Disconnect</button></div>`);
    $('#outBtn').onclick = () => { logout(); closeSheet(); };
    $('#cpBtn').onclick = () => copy(S.me);
    rpc('getBalance', [S.me, { commitment: 'confirmed' }]).then(r => { const el = $('#balLine'); if (el) el.textContent = sol(r.value) + ' in this wallet'; }).catch(() => { const el = $('#balLine'); if (el) el.textContent = 'Balance didn’t load.'; });
    get('/api/board').then(j => {
      const mine = (j.coins || []).filter(k => k.payer === S.me), el = $('#myCoins'); if (!el || !mine.length) return;
      el.innerHTML = `<p class="note" style="margin:14px 0 8px">Coins you launched</p><div class="wlist">${mine.map(c => `<a href="/c/${c.mint}">${esc(c.name)} <small>$${esc(c.symbol)}</small></a>`).join('')}</div>`;
    }).catch(() => {});
  });
  (async function reconnect() { const id = store.get('sp-wallet'); const p = PROVS.find(x => x.id === id); if (!p) return; for (let i = 0; i < 8 && !p.get(); i++) await new Promise(r => setTimeout(r, 250)); if (!p.get()) return; try { const pr = p.get(); const r = await pr.connect({ onlyIfTrusted: true }); const pk = (r && r.publicKey) || pr.publicKey; if (pk) setMe(pk.toString(), pr, id); } catch {} })();

  // ---------- transactions ----------
  let web3 = null;
  function loadWeb3() { if (window.solanaWeb3) return Promise.resolve(window.solanaWeb3); if (web3) return web3; web3 = new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/assets/vendor/web3.min.js'; s.onload = () => ok(window.solanaWeb3); s.onerror = () => { web3 = null; no(new Error('Couldn’t load the Solana library. Check your connection.')); }; document.head.appendChild(s); }); return web3; }
  const toB64 = u => { let s = ''; const a = u instanceof Uint8Array ? u : Uint8Array.from(u); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  async function confirm(sig) {
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 1400));
      const st = await rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: false }]).catch(() => null);
      const s = st && st.value && st.value[0];
      if (s && s.err) throw new Error('It failed on-chain, so nothing changed. ' + (JSON.stringify(s.err).includes('6018') || JSON.stringify(s.err).includes('6025') ? 'The launch shape was refused.' : ''));
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return true;
    }
    throw new Error('Solana hasn’t confirmed it yet. Check your wallet’s activity before trying again.');
  }
  async function send(tx) { return rpc('sendTransaction', [toB64(tx.serialize()), { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5 }]); }
  async function simulate(tx) {
    const r = await rpc('simulateTransaction', [toB64(tx.serialize()), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }]);
    const v = r && r.value; if (!v) throw new Error('Solana didn’t simulate it.');
    if (v.err) { const e = new Error(explain(v.err, v.logs)); e.logs = v.logs; throw e; }
    return v;
  }
  function explain(err, logs) {
    const s = JSON.stringify(err) + ' ' + (logs || []).join(' ');
    if (/insufficient lamports|InsufficientFunds|0x1\b|insufficient funds/i.test(s)) return 'Not enough SOL in your wallet for this.';
    if (/6018|6025/.test(s)) return 'The launch shape was refused. Reload the page so the numbers refresh, then try again.';
    if (/already in use/i.test(s)) return 'That coin address is taken. Try again; the page makes a new one.';
    if (/AccountNotFound/i.test(s)) return 'Your wallet has no SOL on it yet.';
    return 'Solana would reject this: ' + String(JSON.stringify(err)).slice(0, 140);
  }
  const human = m => { m = String((m && m.message) || m); return /reject|denied|cancel|declined|closed/i.test(m) ? 'You cancelled it in your wallet. Nothing was sent.' : /insufficient|0x1\b|lamports/i.test(m) ? 'Not enough SOL in your wallet for that.' : m.slice(0, 280); };
  async function signAll(txs) {
    if (txs.length > 1 && S.prov.signAllTransactions) return S.prov.signAllTransactions(txs);
    const out = []; for (const t of txs) out.push(await S.prov.signTransaction(t)); return out;
  }

  // ---------- top bar, section highlight, reveal-on-scroll ----------
  const top = $('#top');
  let sT = false;
  const onScroll = () => { sT = false; if (top) top.classList.toggle('scrolled', scrollY > 30); };
  addEventListener('scroll', () => { if (!sT) { sT = true; requestAnimationFrame(onScroll); } }, { passive: true }); addEventListener('resize', onScroll); onScroll();
  // the section you're in: its link lights up
  const navs = $$('.nav a').filter(a => (a.getAttribute('href') || '').startsWith('#'));
  if (navs.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) navs.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); }), { rootMargin: '-45% 0px -50% 0px' });
    $$('main section[id]').forEach(s => io.observe(s));
  }
  // .reveal fades a thing up as it arrives; .stg does the same to each of its children, one after another
  function reveal(root) {
    const R = root || document; R.querySelectorAll('.stg').forEach(g => [...g.children].forEach((c, k) => c.style.setProperty('--k', Math.min(k, 8))));
    const els = R.querySelectorAll('.reveal:not(.shown), .stg:not(.shown)'); if (calm || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('shown')); return; }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('shown'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' }); els.forEach(e => io.observe(e));
  }
  reveal();
  (function sew() {
    const bands = $$('.band'); if (calm || !('IntersectionObserver' in window)) { bands.forEach(b => b.classList.add('sewn')); return; }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('sewn'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' }); bands.forEach(b => io.observe(b));
  })();

  // ---------- prove you're the launcher: sign a plain message (no transaction, no fee) ----------
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(bytes) { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b === 0) s = '1' + s; else break; } return s; }
  async function signMessage(text) {
    if (!S.prov || !S.prov.signMessage) throw new Error('This wallet can’t sign messages. Try Phantom or Solflare.');
    const r = await S.prov.signMessage(new TextEncoder().encode(text), 'utf8');
    const sig = r && (r.signature || r); return b58(sig instanceof Uint8Array ? sig : Uint8Array.from(sig));
  }
  // a voice for the clones: the browser's own speech, shaped by the style picked at launch
  const VOICE = { deep: [.62, .92], bright: [1.35, 1.05], calm: [1, .9], fast: [1.05, 1.28] };
  function speak(text, style) {
    try {
      if (!('speechSynthesis' in window) || store.get('sp-mute')) return;
      speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(String(text).slice(0, 300)), v = VOICE[style] || VOICE.calm;
      const en = speechSynthesis.getVoices().filter(x => /^en/i.test(x.lang)); if (en.length) u.voice = en[(style ? style.length : 0) % en.length];
      u.pitch = v[0]; u.rate = v[1]; speechSynthesis.speak(u);
    } catch {}
  }
  window.Core = { $, $$, esc, short, usd, sol, ago, calm, store, say, get, post, rpc, toast, copy, sheet, closeSheet, connect, onWallet, S, loadWeb3, toB64, confirm, send, simulate, explain, human, signAll, reveal, solscan, signMessage, speak };
})();
