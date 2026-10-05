// POST /api/meta {mint, payer, name, symbol, line, look, x, seed, image}  before a launch: record the coin and its sound
//   (its one line, its look, its seed, the picture of it), draw its first listeners from $SOUNDPAD listeners, and write its
//   split (locked on-chain at birth).
// GET  /m/<id>    (→ /api/meta?id=)    the metadata JSON the token's on-chain uri points at.
// GET  /i/<mint>  (→ /api/meta?img=)   its picture.
const L = require('./_lib');
const X = require('./_snd');

const bytes = s => Buffer.byteLength(s, 'utf8');
const STYLES = ['calm', 'deep', 'bright', 'fast'];
const LOOKS = ['trap', 'house', 'lofi', 'chip'];
function metaJson(k, site) {
  const page = site + '/c/' + k.mint;
  return {
    name: k.name, symbol: k.symbol,
    description: `Every ticker has a sound. Hear this one: ${page.replace(/^https?:\/\//, '')}`,
    image: site + '/i/' + k.mint, external_url: page, showName: true,
    website: page, twitter: k.xhandle ? 'https://x.com/' + k.xhandle : undefined, extensions: { website: page }, createdOn: site,
    soundpad: { v: 1, mint: k.mint, seed: k.seed, shares: k.shares },
  };
}
function img(res, buf, type, live) {
  res.statusCode = 200; res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', live ? 'public, max-age=86400, s-maxage=31536000, immutable' : 'public, max-age=30');
  return res.end(Buffer.from(buf));
}
async function get(req, res) {
  const qy = L.query(req);
  if (!L.dbReady()) return L.send(res, 404, { error: 'not found' });
  await L.ready();
  if (qy.img) {
    const mint = String(qy.img).replace(/\.\w+$/, '');
    const r = L.isAddr(mint) ? await L.q('SELECT img, status FROM snd_coins WHERE mint=$1 AND img IS NOT NULL', [mint]).catch(() => []) : [];
    if (!r.length) { res.statusCode = 404; res.setHeader('Cache-Control', 'public, max-age=30'); return res.end(); }
    return img(res, r[0].img, 'image/jpeg', r[0].status === 'live');
  }
  const id = String(qy.id || '').replace(/\.json$/, '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{8,44}$/.test(id)) return L.send(res, 404, { error: 'not found' });
  const r = await L.q('SELECT mint, name, symbol, xhandle, shares, seed FROM snd_coins WHERE id=$1', [id]).catch(() => []);
  if (!r.length) return L.send(res, 404, { error: 'not found' }, 'public, max-age=30');
  L.send(res, 200, metaJson(r[0], L.origin(req)), 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
}
async function picture(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 2.5e6) return null;
  return require('sharp')(buf, { animated: false, limitInputPixels: 40e6 }).resize(768, 768, { fit: 'cover' }).flatten({ background: '#050706' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
async function post(req, res) {
  if (L.limited('meta:' + L.ip(req), 20, 600000)) return L.send(res, 200, { ok: false, error: 'Too many from here. Wait a few minutes.' });
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'Soundpad’s records are offline, so launching is paused. Try again shortly.' });
  if (!L.STUDIO) return L.send(res, 200, { ok: false, error: 'Launching opens soon.' });
  const b = await L.body(req, 3.5 * 1024 * 1024);
  if (b.tooBig) return L.send(res, 200, { ok: false, error: 'That picture is too big.' });
  const mint = String(b.mint || ''), payer = String(b.payer || '');
  if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'The new token address is missing.' });
  if (!L.isAddr(payer)) return L.send(res, 200, { ok: false, error: 'Connect your wallet first.' });
  const name = L.clean(b.name, 64), symbol = L.clean(b.symbol, 20).replace(/^\$/, '').toUpperCase(), line = L.clean(b.line, 300);
  const style = STYLES.includes(b.style) ? b.style : 'calm', look = LOOKS.includes(b.look) ? b.look : 'trap', seed = String(b.seed || '');
  const x = String(b.x || '').trim().replace(/^@/, '').replace(/^https?:\/\/(x|twitter)\.com\//i, '').replace(/\/.*$/, '');
  if (x && !/^[A-Za-z0-9_]{1,15}$/.test(x)) return L.send(res, 200, { ok: false, error: 'That X handle doesn’t look right.' });
  if (!name || bytes(name) > 32) return L.send(res, 200, { ok: false, error: 'Give it a name of up to 32 characters.' });
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return L.send(res, 200, { ok: false, error: 'The ticker is 1–10 letters or numbers.' });
  if (line.length < 8) return L.send(res, 200, { ok: false, error: 'Write what your coin is first: one line.' });
  if (!/^[a-z0-9]{6,24}$/.test(seed)) return L.send(res, 200, { ok: false, error: 'Its sound didn’t come through. Reload and try again.' });
  if (L.BANNED.test(name + ' ' + symbol + ' ' + line)) return L.send(res, 200, { ok: false, error: 'Pick other words: those break the house rules.' });
  const cap0 = L.clean(b.caption, 90) || null;
  if (cap0 && L.BANNED.test(cap0)) return L.send(res, 200, { ok: false, error: 'Pick another title: that one breaks the house rules.' });
  const pic = await picture(b.image).catch(() => null);
  if (!pic) return L.send(res, 200, { ok: false, error: 'Its picture didn’t come through. Try again.' });
  try {
    if (!L.MOCK) { const acct = await L.rpc('getAccountInfo', [L.bondingCurveOf(mint), { encoding: 'base64' }]); if (acct && acct.value) return L.send(res, 200, { ok: false, error: 'That token is already launched; its record can’t change.' }); }
  } catch { return L.send(res, 200, { ok: false, error: 'Solana didn’t answer just now. Try again in a moment.' }); }
  try {
    await L.ready();
    const id = L.metaId(mint);
    const prev = await L.q('SELECT mint, status FROM snd_coins WHERE id=$1', [id]);
    if (prev.length && (prev[0].mint !== mint || prev[0].status !== 'pending')) return L.send(res, 200, { ok: false, error: 'Try again: the page will make a new token address.' });
    const { gods, draw } = await X.drawGods(mint, payer);
    const shares = L.sharesOf(payer, gods.map(g => g.wallet));
    await L.q(`INSERT INTO snd_coins (mint, id, name, symbol, line, style, seed, xhandle, payer, shares, gods, draw, img, look, cap0) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (mint) DO UPDATE SET name=EXCLUDED.name, symbol=EXCLUDED.symbol, line=EXCLUDED.line, style=EXCLUDED.style, seed=EXCLUDED.seed, xhandle=EXCLUDED.xhandle,
        payer=EXCLUDED.payer, shares=EXCLUDED.shares, gods=EXCLUDED.gods, draw=EXCLUDED.draw, img=EXCLUDED.img, look=EXCLUDED.look, cap0=EXCLUDED.cap0, created_at=now() WHERE snd_coins.status='pending'`,
      [mint, id, name, symbol, line, style, seed, x || null, payer, JSON.stringify(shares), JSON.stringify(gods), JSON.stringify(draw), pic, look, cap0]);
    const site = L.origin(req);
    L.send(res, 200, { ok: true, uri: site + '/m/' + id, image: site + '/i/' + mint, studio: L.STUDIO, name, symbol, shares, gods, draw });
  } catch (e) { L.send(res, 200, { ok: false, error: /drawn/.test(String(e && e.message)) ? String(e.message) : 'Its record didn’t save. Try again.' }); }
}
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (req.method === 'POST') return post(req, res);
  return get(req, res);
};
