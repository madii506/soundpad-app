// /api/born  a $LIFE holder's own life.
//   GET  ?w=<wallet>            its life (stage, age, godchildren), its $LIFE balance and the minimum a birth burns
//   POST {wallet, amount}       the burn transaction to be born (built here, signed in your own wallet)
//   POST {wallet, sig}          after the burn confirms: read it from the chain and record the birth
const L = require('./_lib');
const X = require('./_snd');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'Soundpad’s records are offline.' });
  try {
    await L.ready();
    if (req.method === 'GET') {
      const w = String(L.query(req).w || '');
      if (!L.isAddr(w)) return L.send(res, 200, { ok: false, error: 'That isn’t a wallet address.' });
      const t = await L.lifeToken().catch(() => null);
      let balance = null;
      if (t) { try { const [a] = await L.accounts([L.ataOf(w, t.mint, t.program)]); balance = (L.tokenAmount(a) / 10n ** BigInt(t.decimals)).toString(); } catch {} }
      return L.send(res, 200, { ok: true, life: await X.lifeOf(w), open: !!t, balance, minBurn: L.MIN_BURN, mint: L.LIFE_MINT || null });
    }
    if (req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'GET or POST.' });
    if (L.limited('born:' + L.ip(req), 30, 600000)) return L.send(res, 200, { ok: false, error: 'Too many tries. Wait a few minutes.' });
    const b = await L.body(req, 4096), wallet = String(b.wallet || '');
    if (!L.isAddr(wallet)) return L.send(res, 200, { ok: false, error: 'Connect your wallet first.' });
    if (!L.LIFE_MINT) return L.send(res, 200, { ok: false, error: 'Births open when $LIFE launches.' });
    if (b.sig) {
      if (!L.isSig(String(b.sig))) return L.send(res, 200, { ok: false, error: 'That isn’t a transaction signature.' });
      return L.send(res, 200, await X.verifyBirth(wallet, String(b.sig)));
    }
    try { L.send(res, 200, { ok: true, ...(await X.buildBurn(wallet, b.amount)) }); }
    catch (e) { L.send(res, 200, { ok: false, error: String(e && e.message || e).slice(0, 200) }); }
  } catch (e) { L.send(res, 200, { ok: false, error: 'Soundpad’s records didn’t answer.' }); }
};
