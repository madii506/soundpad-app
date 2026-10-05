// GET /api/ping  is everything life needs answering? The database, the AI Gateway token, the house wallet, $LIFE, voices.
const L = require('./_lib');
module.exports = async (req, res) => {
  L.setOidc(req);
  const out = { ok: true, db: L.dbReady(), ai: !!L.gatewayToken(), open: !!L.STUDIO, life: L.LIFE_MINT || null, xi: L.XI, minBurn: L.MIN_BURN };
  if (out.db) { try { await L.ready(); const s = (await L.q('SELECT cycle, talk, talk_day, chars, chars_day FROM snd_state WHERE id=1'))[0]; out.today = s; } catch (e) { out.db = false; out.why = String(e && e.message).slice(0, 120); } }
  if (out.life) { try { out.token = await L.lifeToken(); } catch (e) { out.token = null; out.tokenWhy = String(e && e.message).slice(0, 120); } }
  L.send(res, 200, out);
};
