// POST /api/feed {mint?, payer}  the transaction that pays a coin's waiting creator fees out of pump.fun's vault, to
// everyone in its locked split at once. Without a mint, it picks the coin with the most waiting. Permissionless
// on-chain: whoever signs pays a few thousand lamports.
const L = require('./_lib');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'POST only.' });
  if (L.limited('feed:' + L.ip(req), 30, 600000)) return L.send(res, 200, { ok: false, error: 'Too many tries. Wait a few minutes.' });
  const b = await L.body(req, 4096), payer = String(b.payer || '');
  let mint = String(b.mint || '');
  if ((mint && !L.isAddr(mint)) || !L.isAddr(payer)) return L.send(res, 200, { ok: false, error: 'That request doesn’t look right.' });
  try {
    if (!mint) {
      if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'Soundpad’s records are offline.' });
      await L.ready();
      const top = await L.q(`SELECT mint FROM snd_coins WHERE status='live' ORDER BY vault_lamports DESC LIMIT 6`);
      if (!top.length) return L.send(res, 200, { ok: false, error: 'No coin is launched yet.' });
      const vs = await L.accounts(top.map(t => L.vaultOf(t.mint)));
      let best = -1; vs.forEach((v, i) => { const w = v ? v.lamports - L.RENT0 : 0; if (w > best) { best = w; mint = top[i].mint; } });
    }
    const bh = (await L.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
    if (L.MOCK && L.MOCK.buildFeed) return L.send(res, 200, { ok: true, mint, ...(await L.MOCK.buildFeed({ mint, payer, blockhash: bh })) });
    const [v] = await L.accounts([L.vaultOf(mint)]);
    const waiting = v ? Math.max(0, v.lamports - L.RENT0) : 0;
    if (waiting < 20000) return L.send(res, 200, { ok: false, error: 'Nothing is waiting to be paid out yet. Trading puts fees there.' });
    const P = require('./_pump');
    L.send(res, 200, { ok: true, mint, waiting, ...(await P.buildFeed({ mint, payer, blockhash: bh, getAccounts: L.accounts })) });
  } catch (e) { L.send(res, 200, { ok: false, error: 'The payout didn’t build: ' + String(e && e.message || e).slice(0, 160) }); }
};
