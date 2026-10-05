// GET /api/board  every coin and its latest track (newest first), the latest tracks, and how the listeners are doing, read from
// Soundpad's records, which the cycle keeps in step with the chain.
const L = require('./_lib');
const COLS = `c.mint, c.slot, c.name, c.symbol, c.line, c.seed, c.look, c.payer, c.born_at, c.state, c.mcap_sol, c.complete, c.last_trade_at, c.vault_lamports, c.notes, c.note_at, c.likes, c.pushed_at, c.pushes, c.xhandle, jsonb_array_length(c.gods) AS ngods,
  (SELECT n.text FROM snd_notes n WHERE n.mint = c.mint AND n.kind IN ('first','note','push') ORDER BY n.id DESC LIMIT 1) AS caption`;
module.exports = async (req, res) => {
  const base = { open: !!L.STUDIO, studio: L.STUDIO || null, life: L.LIFE_MINT || null, minBurn: L.MIN_BURN, xi: L.XI, split: { yours: L.YOURS, gods: L.GODS, house: L.HOUSE, max: L.MAX_GODS } };
  if (!L.dbReady()) return L.send(res, 200, { ok: true, offline: true, coins: [], notes: [], elders: [], lives: { alive: 0, dead: 0 }, ...base });
  try {
    await L.ready();
    const [coins, notes, counts, elders, solUsd] = await Promise.all([
      L.q(`SELECT ${COLS} FROM snd_coins c WHERE c.status='live' ORDER BY c.slot DESC LIMIT 500`),
      L.q(`SELECT n.id, n.mint, n.kind, n.text, n.at, (n.audio IS NOT NULL) AS voiced, c.name, c.symbol, c.seed, c.state, c.style FROM snd_notes n JOIN snd_coins c ON c.mint = n.mint
        WHERE n.kind IN ('first','note','push') ORDER BY n.id DESC LIMIT 30`),
      L.q(`SELECT count(*) FILTER (WHERE state='alive')::int AS alive, count(*) FILTER (WHERE state='dead')::int AS dead FROM snd_lives`),
      L.q(`SELECT l.wallet, l.born_at, l.lives, (SELECT count(*)::int FROM snd_coins c WHERE c.status='live' AND c.gods @> jsonb_build_array(jsonb_build_object('wallet', l.wallet))) AS kids
        FROM snd_lives l WHERE l.state='alive' ORDER BY l.born_at ASC LIMIT 10`),
      L.solPrice().catch(() => null),
    ]);
    L.send(res, 200, { ok: true, coins, notes: notes.map(n => ({ ...n, audio: n.voiced ? '/api/talk?n=' + n.id : null })), lives: counts[0] || { alive: 0, dead: 0 },
      elders: elders.map(e => ({ ...e, ...L.stageOf(e.born_at) })), solUsd, ...base }, L.CACHE(6, 60));
  } catch (e) { L.send(res, 200, { ok: false, error: 'Soundpad’s records didn’t answer.', ...base }); }
};
