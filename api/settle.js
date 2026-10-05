// POST /api/settle {mint}  after a launch confirms, the page asks: is the coin on Solana with its split locked, exactly
// as recorded? If so its life starts now. Anyone may call it; it acts once per coin.
const L = require('./_lib');
const X = require('./_snd');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'Soundpad’s records are offline.' });
  const b = req.method === 'POST' ? await L.body(req, 4096) : L.query(req);
  const mint = String(b.mint || '');
  if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'That isn’t a coin address.' });
  if (L.limited('settle:' + L.ip(req), 40, 600000)) return L.send(res, 200, { ok: false, error: 'Too many checks. Wait a minute.' });
  try {
    await L.ready(); L.setOidc(req);
    const r = await X.settle(mint);
    if (r.live && r.fresh) {                     // its first words, right away
      const k = (await L.q(`SELECT mint, name, symbol, line, style, state, notes, mcap_sol, mcap_note, cap0 FROM snd_coins WHERE mint=$1`, [mint]))[0];
      if (k) await Promise.race([X.first(k).catch(() => null), new Promise(ok => setTimeout(ok, 25000))]);
    }
    L.send(res, 200, r);
  }
  catch (e) { L.send(res, 200, { ok: false, error: 'The check didn’t finish. It happens by itself at the next cycle.' }); }
};
