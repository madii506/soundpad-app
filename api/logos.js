// GET /api/logos?mints=a,b,c  the real token pictures (and names) of up to 20 Solana tokens, read from Jupiter's token
// list. Also: GET /api/logos?uri=<metadata url>  a new pump.fun coin's picture, read from its own metadata.
// The page shows these as each coin's own image; when a read fails it says nothing and draws the coin's pad instead.
const L = require('./_lib');
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const OKHOST = /^(ipfs\.io|[a-z0-9-]+\.mypinata\.cloud|gateway\.pinata\.cloud|cf-ipfs\.com|dweb\.link|nftstorage\.link|[a-z0-9-]+\.ipfs\.nftstorage\.link|arweave\.net|[a-z0-9-]+\.arweave\.net|metadata\.pump\.fun|pump\.fun|[a-z0-9-]+\.pump\.fun|cdn\.jsdelivr\.net)$/i;
module.exports = async (req, res) => {
  const qy = L.query(req);
  if (L.limited('logos:' + L.ip(req), 120, 60000)) return L.send(res, 200, { ok: false, error: 'Too many requests. Wait a minute.' });
  if (qy.uri) {
    let u; try { u = new URL(String(qy.uri)); } catch { return L.send(res, 200, { ok: false }); }
    if (u.protocol !== 'https:' || !OKHOST.test(u.hostname)) return L.send(res, 200, { ok: false }, L.CACHE(3600));
    try {
      const j = await L.getJson(u.toString(), {}, 6000);
      const img = j && typeof j.image === 'string' && /^https:\/\//.test(j.image) ? j.image.slice(0, 400) : null;
      return L.send(res, 200, { ok: !!img, image: img }, L.CACHE(86400));
    } catch { return L.send(res, 200, { ok: false }, L.CACHE(60)); }
  }
  const mints = String(qy.mints || '').split(',').map(s => s.trim()).filter(s => B58.test(s)).slice(0, 20);
  if (!mints.length) return L.send(res, 200, { ok: false, error: 'No token addresses.' });
  try {
    const j = await L.getJson('https://lite-api.jup.ag/tokens/v2/search?query=' + mints.join(','), {}, 8000);
    const out = {};
    for (const t of Array.isArray(j) ? j : []) if (t && mints.includes(t.id)) out[t.id] = { symbol: String(t.symbol || '').slice(0, 20), name: String(t.name || '').slice(0, 40), icon: typeof t.icon === 'string' && /^https:\/\//.test(t.icon) ? t.icon : null };
    L.send(res, 200, { ok: true, tokens: out }, L.CACHE(21600));
  } catch { L.send(res, 200, { ok: false, error: 'The token list didn’t answer.' }, L.CACHE(60)); }
};
