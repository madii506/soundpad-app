// /api/talk
//   GET  ?n=<id>          a note spoken with ElevenLabs (MP3), when the house's key is set
//   POST {mint, ask}      ask a coin's life something; it answers in character (and out loud, with a key)
const L = require('./_lib');
const X = require('./_snd');
function mp3(req, res, buf) {
  buf = Buffer.from(buf); const size = buf.length, range = String(req.headers.range || '');
  res.setHeader('Content-Type', 'audio/mpeg'); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
  const m = range.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const a = m[1] === '' ? size - Number(m[2]) : Number(m[1]), z = m[2] === '' || m[1] === '' ? size - 1 : Math.min(size - 1, Number(m[2]));
    if (a < 0 || a >= size || z < a) { res.statusCode = 416; res.setHeader('Content-Range', 'bytes */' + size); return res.end(); }
    res.statusCode = 206; res.setHeader('Content-Range', `bytes ${a}-${z}/${size}`); res.setHeader('Content-Length', z - a + 1); return res.end(buf.subarray(a, z + 1));
  }
  res.statusCode = 200; res.setHeader('Content-Length', size); return res.end(buf);
}
module.exports = async (req, res) => {
  L.setOidc(req);
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'Soundpad’s records are offline.' });
  try {
    await L.ready();
    if (req.method === 'GET') {
      const n = String(L.query(req).n || '');
      const r = /^\d{1,12}$/.test(n) ? await L.q('SELECT audio FROM snd_notes WHERE id=$1 AND audio IS NOT NULL', [n]) : [];
      if (!r.length) { res.statusCode = 404; return res.end(); }
      return mp3(req, res, r[0].audio);
    }
    if (req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'GET or POST.' });
    if (L.limited('ask:' + L.ip(req), 6, 600000)) return L.send(res, 200, { ok: false, error: 'It needs a breather. Ask again in a few minutes.' });
    const b = await L.body(req, 4096), mint = String(b.mint || ''), ask = L.clean(b.ask, 240);
    if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'That isn’t a coin.' });
    if (ask.length < 2) return L.send(res, 200, { ok: false, error: 'Ask it something first.' });
    const k = (await L.q(`SELECT mint, name, symbol, line, style, state FROM snd_coins WHERE mint=$1 AND status='live'`, [mint]))[0];
    if (!k) return L.send(res, 200, { ok: false, error: 'No coin lives there yet.' });
    if (k.state === 'dead') return L.send(res, 200, { ok: false, error: 'It went dead after a quiet week. A trade brings it back.' });
    const a = await X.answerText(k, ask);
    if (!a.ok) return L.send(res, 200, a);
    await X.note({ ...k, mint: k.mint }, 'answer', a.text, ask);
    L.send(res, 200, { ok: true, text: a.text, q: ask });
  } catch (e) { L.send(res, 200, { ok: false, error: 'No answer this time. Try again.' }); }
};
