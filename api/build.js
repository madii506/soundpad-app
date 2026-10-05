// POST /api/build {mint, payer, devBuy, only}  the transactions that launch a coin, built with pump.fun's own SDK for the
// launcher's wallet to sign: the coin (you are its creator), then its split, locked (exactly the shares recorded for it:
// you, its godparents, the house), then your first buy if you chose one. only:'route' rebuilds just the split, for a coin that landed without it.
// Nothing here can sign: the server has no key.
const L = require('./_lib');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'POST only.' });
  if (L.limited('build:' + L.ip(req), 30, 600000)) return L.send(res, 200, { ok: false, error: 'Too many tries. Wait a few minutes.' });
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'Soundpad’s records are offline.' });
  if (!L.STUDIO) return L.send(res, 200, { ok: false, error: 'Launching opens soon.' });
  const b = await L.body(req, 8 * 1024), mint = String(b.mint || ''), payer = String(b.payer || '');
  if (!L.isAddr(mint) || !L.isAddr(payer)) return L.send(res, 200, { ok: false, error: 'That request doesn’t look right.' });
  try {
    await L.ready();
    const k = (await L.q('SELECT mint, id, name, symbol, payer, status, shares FROM snd_coins WHERE mint=$1', [mint]))[0];
    if (!k) return L.send(res, 200, { ok: false, error: 'Record the coin first.' });
    if (k.payer !== payer) return L.send(res, 200, { ok: false, error: 'Only the wallet that started this can sign it.' });
    if (k.status === 'live') return L.send(res, 200, { ok: false, error: 'This token is already launched.' });
    const shares = typeof k.shares === 'string' ? JSON.parse(k.shares) : k.shares;
    const P = require('./_pump');
    const bh = (await L.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
    const devBuy = Math.max(0, Math.min(5e9, Math.round(Number(b.devBuy) || 0)));
    const out = await P.buildSpawn({ rpcUrl: L.RPC_URL(), mock: L.MOCK, mint, user: payer, name: k.name, symbol: k.symbol, uri: L.origin(req) + '/m/' + k.id,
      shares, prefund: [], devBuy: b.only === 'route' ? 0 : devBuy, blockhash: bh });
    if (b.only === 'route') out.txs = [out.txs[1]];
    L.send(res, 200, { ok: true, ...out, shares, studio: L.STUDIO });
  } catch (e) { L.send(res, 200, { ok: false, error: 'The transactions didn’t build: ' + String(e && e.message || e).slice(0, 160) }); }
};
