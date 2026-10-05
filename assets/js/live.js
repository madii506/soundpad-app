// Soundpad live: what is really happening right now, read in the browser.
//  · pump.fun births and trades, streamed from PumpPortal's public websocket (one connection per page, as they ask)
//  · Solana's slot, read through /api/rpc every two seconds
// Nothing here is made up: if a feed is down, the page says nothing rather than inventing activity.
(function () {
  'use strict';
  const subs = { birth: [], trade: [], slot: [], status: [] };
  const on = (k, f) => { subs[k].push(f); };
  const emit = (k, v) => subs[k].forEach(f => { try { f(v); } catch {} });
  const S = { up: false, births: 0, since: Date.now(), last: null, keys: new Set(), slot: null };
  let ws = null, tries = 0, wantBirths = true;
  function connect() {
    if (ws && ws.readyState < 2) return;
    try { ws = new WebSocket('wss://pumpportal.fun/api/data'); } catch { return retry(); }
    ws.onopen = () => {
      tries = 0; S.up = true; emit('status', true);
      if (wantBirths) ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      if (S.keys.size) ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [...S.keys] }));
    };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (!m || !m.mint) return;
      if (m.txType === 'create') { S.births++; S.last = { mint: m.mint, at: Date.now(), sol: Number(m.solAmount) || 0, mcap: Number(m.marketCapSol) || null, name: String(m.name || '').slice(0, 40), symbol: String(m.symbol || '').slice(0, 14), uri: typeof m.uri === 'string' ? m.uri.slice(0, 300) : '' }; emit('birth', S.last); }
      else if (m.txType === 'buy' || m.txType === 'sell') emit('trade', { mint: m.mint, side: m.txType, sol: Number(m.solAmount) || 0, mcap: Number(m.marketCapSol) || null, who: m.traderPublicKey, at: Date.now() });
    };
    ws.onclose = () => { S.up = false; emit('status', false); retry(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function retry() { const d = Math.min(30000, 1500 * Math.pow(2, tries++)); setTimeout(() => { if (!document.hidden) connect(); else document.addEventListener('visibilitychange', function f() { if (!document.hidden) { document.removeEventListener('visibilitychange', f); connect(); } }); }, d); }
  // watch the trades of these coins (the children)
  function watch(mints) {
    const fresh = mints.filter(m => m && !S.keys.has(m)); if (!fresh.length) return;
    fresh.forEach(m => S.keys.add(m));
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: fresh }));
  }
  function births(yes) { wantBirths = yes; }
  // the chain's clock
  async function tick() {
    if (!document.hidden) {
      try {
        const r = await fetch('/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'getSlot', params: [{ commitment: 'confirmed' }] }) }).then(r => r.json());
        if (r && r.ok && r.result) { S.slot = r.result; emit('slot', r.result); }
      } catch {}
    }
    setTimeout(tick, 2000);
  }
  window.Live = { on, watch, births, S, start() { connect(); tick(); }, _test: emit };
})();
