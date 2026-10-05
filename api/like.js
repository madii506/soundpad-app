// POST /api/like {mint}  a real like from a real visitor: one per visitor per coin, counted toward the algorithm's push.
const crypto = require('crypto');
const L = require('./_lib');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'POST only.' });
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'Soundpad’s records are offline.' });
  if (L.limited('like:' + L.ip(req), 60, 600000)) return L.send(res, 200, { ok: false, error: 'Slow down a little.' });
  const b = await L.body(req, 2048), mint = String(b.mint || '');
  if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'That isn’t a coin.' });
  const who = crypto.createHash('sha256').update(L.ip(req) + ':' + (process.env.LIKE_SALT || 'Soundpad') + ':' + String(req.headers['user-agent'] || '')).digest('hex').slice(0, 24);
  try {
    await L.ready();
    const k = (await L.q(`SELECT mint FROM snd_coins WHERE mint=$1 AND status='live'`, [mint]))[0];
    if (!k) return L.send(res, 200, { ok: false, error: 'No coin lives there yet.' });
    const ins = await L.q(`INSERT INTO snd_likes (mint, who) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING mint`, [mint, who]);
    const r = ins.length ? await L.q(`UPDATE snd_coins SET likes=likes+1 WHERE mint=$1 RETURNING likes`, [mint]) : await L.q(`SELECT likes FROM snd_coins WHERE mint=$1`, [mint]);
    L.send(res, 200, { ok: true, liked: true, fresh: ins.length > 0, likes: r[0] ? r[0].likes : null });
  } catch (e) { L.send(res, 200, { ok: false, error: 'The like didn’t save. Try again.' }); }
};
