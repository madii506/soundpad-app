// GET /api/cycle  one cycle of Soundpad, run by a schedule (safe for anyone to call: it locks, and runs at most once per 25
// minutes). It finishes launches the page didn't see through, voids ones that never landed, reads every coin from the
// chain, ends the lives of holders who sold, and writes the next note for every life that's due: every six hours while
// its coin trades, every twelve while it sleeps, none once it's dead.
const L = require('./_lib');
const X = require('./_snd');
const PER_CYCLE = 6;
module.exports = async (req, res) => {
  L.setOidc(req);
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'records offline' });
  try {
    await L.ready();
    const got = await L.q(`UPDATE snd_state SET lock_at=now() WHERE id=1 AND (lock_at IS NULL OR lock_at < now() - interval '3 minutes') AND next_at <= now() RETURNING cycle`);
    if (!got.length) return L.send(res, 200, { ok: true, skipped: true });
    const cycle = got[0].cycle + 1, out = { ok: true, cycle, settled: 0, voided: 0, notes: 0 };
    try {
      for (const p of await L.q(`SELECT mint FROM snd_coins WHERE status='pending' AND created_at > now() - interval '3 hours'`)) { const r = await X.settle(p.mint).catch(() => null); if (r && r.live) out.settled++; }
      const v = await L.q(`UPDATE snd_coins SET status='void', img=NULL WHERE status='pending' AND created_at <= now() - interval '3 hours' RETURNING mint`); out.voided = v.length;
      const r = await X.readBoard(); out.coins = r.coins; out.changes = r.changes;
      const lv = await X.checkLives(); out.lives = lv;
      const due = await L.q(`SELECT mint, name, symbol, line, style, state, notes, mcap_sol, mcap_note, cap0 FROM snd_coins WHERE status='live' AND (
          notes = 0 OR
          (state IN ('alive','ascended') AND (note_at IS NULL OR note_at < now() - interval '6 hours')) OR
          (state = 'asleep' AND (note_at IS NULL OR note_at < now() - interval '12 hours')))
          AND state <> 'dead'
        ORDER BY note_at NULLS FIRST LIMIT ${PER_CYCLE}`);
      await L.pool(due, 2, async k => { const s = k.notes ? await X.shift(k) : await X.first(k); if (s.ok) out.notes++; else out.why = s.error; });
      try { out.push = await X.push(); } catch (e) { out.pushWhy = String(e && e.message).slice(0, 120); }
      await L.q(`DELETE FROM snd_notes WHERE kind='answer' AND at < now() - interval '7 days'`).catch(() => {});
    } finally {
      await L.q(`UPDATE snd_state SET cycle=$1, lock_at=NULL, next_at=now() + interval '25 minutes' WHERE id=1`, [cycle]);
    }
    L.send(res, 200, out);
  } catch (e) { L.send(res, 200, { ok: false, error: String(e && e.message || e).slice(0, 200) }); }
};
