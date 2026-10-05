// POST /api/rpc {method, params} — a narrow window onto Solana for the page: read a balance, get a blockhash,
// simulate and send a transaction your wallet already signed, and check whether it landed. Nothing else gets through.
const L = require('./_lib');
const OK = new Set(['getSlot', 'getBalance', 'getAccountInfo', 'getLatestBlockhash', 'getSignatureStatuses', 'sendTransaction', 'simulateTransaction']);
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'POST only.' });
  if (L.limited('rpc:' + L.ip(req), 90, 60000)) return L.send(res, 200, { ok: false, error: 'Too many requests. Wait a minute.' });
  const b = await L.body(req, 24 * 1024);
  if (!OK.has(b.method) || !Array.isArray(b.params)) return L.send(res, 200, { ok: false, error: 'That call isn’t allowed here.' });
  try { const j = await L.rpcRaw(b.method, b.params, 15000); L.send(res, 200, j.error ? { ok: false, error: j.error.message, logs: j.error.data && j.error.data.logs } : { ok: true, result: j.result }); }
  catch (e) { L.send(res, 200, { ok: false, error: 'Solana didn’t answer just now.' }); }
};
