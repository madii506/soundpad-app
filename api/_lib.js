// Soundpad's shared server code. Every upstream call has a timeout and an honest failure message.
// Upstreams: Solana RPC, Jupiter's price API, the AI Gateway (words) and ElevenLabs (voices, when its key is set).
// Nothing here holds a wallet key: there is no wallet on this server.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const SOL = 'So11111111111111111111111111111111111111112';
const RPCS = (process.env.RPC_URLS || 'https://solana-rpc.publicnode.com,https://api.mainnet-beta.solana.com').split(',').map(s => s.trim()).filter(Boolean);
const MOCK = process.env.NI_MOCK ? require(process.env.NI_MOCK) : null;   // dev only: canned upstreams

function send(res, code, obj, cache = 'no-store') {
  res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (/s-maxage/.test(cache)) { res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate'); res.setHeader('CDN-Cache-Control', cache.replace(/max-age=0,\s*/, '')); }
  else res.setHeader('Cache-Control', cache);
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type'); res.end(JSON.stringify(obj));
}
const CACHE = (s, swr = s * 10) => `public, max-age=0, s-maxage=${s}, stale-while-revalidate=${swr}`;
function query(req) { if (req.query) return req.query; return Object.fromEntries(new URL(req.url, 'http://x').searchParams); }
async function body(req, max = 64 * 1024) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { if (req.body.length > max) return { tooBig: true }; try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; let n = 0; for await (const c of req) { chunks.push(c); n += c.length; if (n > max) return { tooBig: true }; }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}
function ip(req) { return String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '?').split(',')[0].trim(); }
const hits = new Map();
function limited(key, n, ms) { const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms); a.push(now); hits.set(key, a); if (hits.size > 5000) hits.delete(hits.keys().next().value); return a.length > n; }

async function getJson(url, opt = {}, ms = 9000) {
  if (MOCK) return MOCK.fetch(url, opt);
  const r = await fetch(url, { ...opt, headers: { 'user-agent': UA, accept: 'application/json', ...(opt.headers || {}) }, signal: AbortSignal.timeout(ms) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, json: j, text: t };
}
async function rpcRaw(method, params, ms = 12000) {
  let last;
  for (const u of RPCS) {
    try {
      const r = await getJson(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, ms);
      if (r.json && (r.json.result !== undefined || (r.json.error && (method === 'sendTransaction' || method === 'simulateTransaction')))) return r.json;
      last = new Error((r.json && r.json.error && r.json.error.message) || 'rpc ' + r.status);
    } catch (e) { last = e; }
  }
  throw last || new Error('rpc failed');
}
async function rpc(method, params, ms) { const j = await rpcRaw(method, params, ms); if (j.error) throw new Error(j.error.message || 'rpc error'); return j.result; }
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { await fn(items[k], k); } catch {} } })); }
const memo = new Map();
const forget = key => memo.delete(key);
async function remember(key, ms, fn) {
  const m = memo.get(key); if (m && Date.now() - m.at < ms) return m.v;
  if (m && m.p) return m.p;
  const p = fn().then(v => { memo.set(key, { at: Date.now(), v }); return v; }).catch(e => { if (m) memo.set(key, m); else memo.delete(key); throw e; });
  memo.set(key, { ...(m || { at: 0 }), p }); return p;
}

// ---------- Solana bits without @solana/web3.js: base58 and program-derived addresses ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(buf) {
  let n = 0n; for (const b of buf) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}
function b58dec(str) {
  let n = 0n; for (const c of str) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of str) { if (c === '1') out.unshift(0); else break; }
  return Buffer.from(out);
}
const P25519 = (1n << 255n) - 19n;
const modp = a => ((a % P25519) + P25519) % P25519;
function powp(b, e) { let r = 1n; b = modp(b); while (e > 0n) { if (e & 1n) r = r * b % P25519; b = b * b % P25519; e >>= 1n; } return r; }
const D25519 = modp(-121665n * powp(121666n, P25519 - 2n));
const SQRTM1 = powp(2n, (P25519 - 1n) / 4n);
function onCurve(bytes) {
  const b = Buffer.from(bytes); b[31] &= 0x7f;
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) + BigInt(b[i]);
  if (y >= P25519) return false;
  const y2 = y * y % P25519, u = modp(y2 - 1n), v = modp(D25519 * y2 + 1n);
  const x2 = u * powp(v, P25519 - 2n) % P25519;
  if (x2 === 0n) return true;
  let x = powp(x2, (P25519 + 3n) / 8n);
  if (x * x % P25519 === x2) return true;
  x = x * SQRTM1 % P25519;
  return x * x % P25519 === x2;
}
const L58 = s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
function pda(seeds, programId) {
  const crypto = require('crypto'); const prog = b58dec(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const h = crypto.createHash('sha256');
    for (const sd of seeds) h.update(typeof sd === 'string' ? (L58(sd) ? b58dec(sd) : Buffer.from(sd)) : Buffer.from(sd));
    h.update(Buffer.from([bump])); h.update(prog); h.update(Buffer.from('ProgramDerivedAddress'));
    const k = h.digest(); if (!onCurve(k)) return b58enc(k);
  }
  throw new Error('no pda');
}

// ---------- the split: every coin's creator fees, locked by pump.fun's own fee sharing ----------
// 70% the launcher, 15% split between the coin's first listeners (up to 8 $SOUNDPAD listeners, drawn at launch), 15% the
// house (it pays for every track title the AI writes). No listeners yet: their 15% stays with the launcher.
const SYSTEM = '11111111111111111111111111111111';
const STUDIO = (process.env.STUDIO_WALLET || '').trim();        // the house: its public address only
const LIFE_MINT = (process.env.SOUNDPAD_MINT || process.env.LIFE_MINT || '').trim();         // $SOUNDPAD, once it exists
const YOURS = 7000, GODS = 1500, HOUSE = 1500, MAX_GODS = 8;
function sharesOf(payer, gods) {
  const g = [...new Set((gods || []).filter(w => w && w !== payer && w !== STUDIO))].slice(0, MAX_GODS);
  const me = payer === STUDIO ? YOURS + HOUSE : YOURS;
  const out = [{ address: payer, bps: g.length ? me : me + GODS }];
  if (g.length) { const each = Math.floor(GODS / g.length); g.forEach((w, i) => out.push({ address: w, bps: each + (i === 0 ? GODS - each * g.length : 0) })); }
  if (payer !== STUDIO) out.push({ address: STUDIO, bps: HOUSE });
  return out;
}

// ---------- pump.fun and token addresses (computed here so reading the chain needs no SDK) ----------
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', PUMP_FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const bondingCurveOf = mint => pda([Buffer.from('bonding-curve'), b58dec(mint)], PUMP);
const sharingConfigOf = mint => pda([Buffer.from('sharing-config'), b58dec(mint)], PUMP_FEES);
const vaultOf = mint => pda([Buffer.from('creator-vault'), b58dec(sharingConfigOf(mint))], PUMP);
const ataOf = (owner, mint, prog) => pda([b58dec(owner), b58dec(prog), b58dec(mint)], ATA);
const RENT0 = 890880;
async function accounts(addrs) {
  if (MOCK && MOCK.accounts) return MOCK.accounts(addrs);
  const out = [];
  for (let i = 0; i < addrs.length; i += 100) {
    const r = await rpc('getMultipleAccounts', [addrs.slice(i, i + 100), { encoding: 'base64', commitment: 'confirmed' }]);
    for (const a of r.value) out.push(a ? { data: Buffer.from(a.data[0], 'base64'), lamports: a.lamports, owner: a.owner } : null);
  }
  return out;
}
const RPC_URL = () => RPCS[0];
// $LIFE itself: which token program owns it, and its decimals (read once, then kept)
async function lifeToken() {
  if (!LIFE_MINT) return null;
  if (MOCK && MOCK.lifeToken) return MOCK.lifeToken();
  return remember('lifetoken', 36e5, async () => {
    const [m] = await accounts([LIFE_MINT]);
    if (!m) throw new Error('$LIFE’s mint wasn’t found on Solana.');
    return { mint: LIFE_MINT, program: m.owner, decimals: m.data[44] };
  });
}
const tokenAmount = acct => (acct && acct.data && acct.data.length >= 72 ? acct.data.readBigUInt64LE(64) : 0n);

// ---------- prices ----------
async function solPrice() {
  return remember('solprice', 60000, async () => {
    try { const r = await getJson('https://lite-api.jup.ag/price/v3?ids=' + SOL, {}, 6000); const p = r.json && r.json[SOL] && Number(r.json[SOL].usdPrice); if (p > 0) return p; } catch {}
    return null;
  });
}

// ---------- the database: Postgres (Neon on Vercel; PGlite in local dev) ----------
let pg = null, made = null;
async function q(text, params = []) {
  if (process.env.NI_PGLITE) {
    if (!pg) { const { PGlite } = require('@electric-sql/pglite'); pg = new PGlite(process.env.NI_PGLITE); }
    return (await pg.query(text, params)).rows;
  }
  if (!pg) { const { neon } = require('@neondatabase/serverless'); pg = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL); }
  return pg.query(text, params);
}
const dbReady = () => !!(process.env.NI_PGLITE || process.env.DATABASE_URL || process.env.POSTGRES_URL);
function ready() {
  if (!made) made = (async () => {
    for (const st of [
      `CREATE TABLE IF NOT EXISTS snd_coins (mint text PRIMARY KEY, id text UNIQUE NOT NULL, slot int, name text NOT NULL, symbol text NOT NULL, line text NOT NULL,
        style text NOT NULL DEFAULT 'calm', look text NOT NULL DEFAULT 'trap', seed text NOT NULL, xhandle text, payer text NOT NULL, shares jsonb NOT NULL, gods jsonb NOT NULL DEFAULT '[]', draw jsonb,
        status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), born_at timestamptz, state text NOT NULL DEFAULT 'alive', mcap_sol float8,
        mcap_note float8, complete boolean NOT NULL DEFAULT false, last_trade_at timestamptz, vault_lamports bigint NOT NULL DEFAULT 0, img bytea, notes int NOT NULL DEFAULT 0, note_at timestamptz,
        likes int NOT NULL DEFAULT 0, pushed_at timestamptz, pushes int NOT NULL DEFAULT 0, cap0 text)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS snd_slot ON snd_coins(slot)`,
      `CREATE TABLE IF NOT EXISTS snd_lives (wallet text PRIMARY KEY, born_at timestamptz NOT NULL, burned numeric NOT NULL DEFAULT 0, held numeric NOT NULL DEFAULT 0,
        state text NOT NULL DEFAULT 'alive', died_at timestamptz, cause text, lives int NOT NULL DEFAULT 1, checked_at timestamptz)`,
      `CREATE TABLE IF NOT EXISTS snd_births (sig text PRIMARY KEY, wallet text NOT NULL, amount numeric NOT NULL, at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS snd_notes (id bigserial PRIMARY KEY, mint text, kind text NOT NULL, text text NOT NULL, q text, audio bytea, at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS snd_likes (mint text NOT NULL, who text NOT NULL, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (mint, who))`,
      `CREATE INDEX IF NOT EXISTS snd_notes_mint ON snd_notes(mint, id DESC)`,
      `CREATE TABLE IF NOT EXISTS snd_log (id bigserial PRIMARY KEY, kind text NOT NULL, mint text, text text NOT NULL, at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS snd_state (id int PRIMARY KEY, cycle int NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(), lock_at timestamptz,
        talk_day date, talk int NOT NULL DEFAULT 0, chars_day date, chars int NOT NULL DEFAULT 0)`,
    ]) await q(st);
    await q(`INSERT INTO snd_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  })().catch(e => { made = null; throw e; });
  return made;
}
const DAILY_TALK = Math.max(1, Number(process.env.DAILY_TALK) || 4000);
async function spendTalk(n = 1) {
  const r = await q(`UPDATE snd_state SET talk = CASE WHEN talk_day = (now() AT TIME ZONE 'utc')::date THEN talk + $2 ELSE $2 END, talk_day = (now() AT TIME ZONE 'utc')::date
    WHERE id=1 AND (talk_day IS DISTINCT FROM (now() AT TIME ZONE 'utc')::date OR talk < $1) RETURNING talk`, [DAILY_TALK, n]);
  return r.length > 0;
}
const log = (kind, mint, text) => q('INSERT INTO snd_log (kind, mint, text) VALUES ($1,$2,$3)', [kind, mint || null, String(text).slice(0, 300)]).catch(() => {});

// ---------- ElevenLabs (optional): with the house's key set as ELEVENLABS_API_KEY, notes are spoken with a real voice ----------
const XI = (process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY || '').trim();
const XI_MODEL = (process.env.XI_MODEL || 'eleven_multilingual_v2').trim();
const DAILY_CHARS = Math.max(100, Number(process.env.DAILY_CHARS) || 12000);
async function speak(voiceId, text) {
  if (!XI) return { ok: false, closed: true };
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId) + '?output_format=mp3_44100_128', { method: 'POST',
      headers: { 'xi-api-key': XI, 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify({ text, model_id: XI_MODEL }), signal: AbortSignal.timeout(40000) });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text().catch(() => '')).slice(0, 200) };
    return { ok: true, buf: Buffer.from(await r.arrayBuffer()) };
  } catch (e) { return { ok: false, error: String(e && e.message).slice(0, 200) }; }
}
async function spendChars(n) {
  const r = await q(`UPDATE snd_state SET chars = CASE WHEN chars_day = (now() AT TIME ZONE 'utc')::date THEN chars + $2 ELSE $2 END, chars_day = (now() AT TIME ZONE 'utc')::date
    WHERE id=1 AND (chars_day IS DISTINCT FROM (now() AT TIME ZONE 'utc')::date OR chars + $2 <= $1) RETURNING chars`, [DAILY_CHARS, n]);
  return r.length > 0;
}

// ---------- words: a small OpenAI model through Vercel's AI Gateway (OIDC from the request, or a key if one is set) ----------
const MODEL = (process.env.CAPTION_MODEL || 'openai/gpt-4.1-mini').trim();
let OIDC = null;
const setOidc = req => { const t = req && req.headers && req.headers['x-vercel-oidc-token']; if (t) OIDC = t; };
const gatewayToken = () => process.env.AI_GATEWAY_API_KEY || OIDC || process.env.VERCEL_OIDC_TOKEN || null;
async function ai(messages, maxTokens = 220, ms = 20000) {
  if (MOCK && MOCK.ai) return MOCK.ai(messages);
  const token = gatewayToken();
  if (!token) return { ok: false, error: 'no token' };
  try {
    const r = await getJson('https://ai-gateway.vercel.sh/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature: .95, messages }) }, ms);
    const c = r.json && r.json.choices && r.json.choices[0], text = c && c.message && c.message.content;
    if (!text) return { ok: false, status: r.status, error: String((r.json && r.json.error && (r.json.error.message || r.json.error.type)) || r.text || '').slice(0, 200) };
    return { ok: true, text: String(text) };
  } catch (e) { return { ok: false, error: String(e && e.message).slice(0, 200) }; }
}

// ---------- the house rules every word is screened against ----------
const BANNED = /\b(guarantee[ds]?|100x|1000x|10x|financial advice|not financial advice|nfa|to the moon|mooning|moon soon|pump(ing|s)?|dump|rug|buy now|ape in|price target|will go up|cant lose|can't lose|risk[- ]free)\b/i;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function scrub(t, n) {
  t = clean(t, 600).replace(/https?:\/\/\S+/gi, '').replace(/@(\w)/g, '$1').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
}
function parseJson(text) { const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; } }

const isAddr = s => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const isSig = s => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(s);
const metaId = mint => String(mint).slice(0, 12);
function origin(req) { const h = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'; const proto = req.headers['x-forwarded-proto'] || (/^localhost|^127\./.test(h) ? 'http' : 'https'); return proto + '://' + h; }

// ---------- listeners: how long a $SOUNDPAD listener has been listening, from the day it joined ----------
const DAY = 864e5;
const STAGES = [{ id: 'new', from: 0, mult: 1 }, { id: 'regular', from: 3, mult: 1.5 }, { id: 'superfan', from: 10, mult: 2 }, { id: 'day one', from: 30, mult: 3 }];
function stageOf(bornAt, now = Date.now()) {
  const days = (now - new Date(bornAt)) / DAY; let s = STAGES[0];
  for (const x of STAGES) if (days >= x.from) s = x;
  const next = STAGES[STAGES.indexOf(s) + 1];
  return { stage: s.id, mult: s.mult, days, next: next ? { stage: next.id, in: Math.max(0, next.from - days) } : null };
}
const MIN_BURN = Math.max(1, Number(process.env.MIN_BURN) || 10000);   // whole $SOUNDPAD joining burns at least

module.exports = {
  UA, SOL, send, CACHE, query, body, ip, limited, getJson, rpc, rpcRaw, pool, remember, forget,
  isAddr, isSig, metaId, origin, b58enc, b58dec, pda, SYSTEM, STUDIO, LIFE_MINT, YOURS, GODS, HOUSE, MAX_GODS, sharesOf,
  PUMP, PUMP_FEES, TOKEN, TOKEN22, ATA, bondingCurveOf, sharingConfigOf, vaultOf, ataOf, RENT0, accounts, RPC_URL, lifeToken, tokenAmount,
  solPrice, q, ready, dbReady, log, setOidc, gatewayToken, ai, spendTalk, DAILY_TALK, XI: !!XI, speak, spendChars, DAILY_CHARS, MODEL, MOCK,
  BANNED, clean, scrub, parseJson, DAY, STAGES, stageOf, MIN_BURN,
};
