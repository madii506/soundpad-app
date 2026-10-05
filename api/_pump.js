// br33d's pump.fun builder: the server writes a child's transactions, the crosser's wallet signs them. No key here.
//   tx 1  create_v2 (the coin, creator = the crosser) + create_fee_sharing_config (the creator vault becomes the
//         coin's own sharing config)
//   tx 2  update_fee_shares_v2: the creator fees split exactly as recorded (the crosser, the parents' crossers, the
//         house). It revokes the admin, so the split can never change again, not even by the crosser.
//   tx 3  optional: the crosser's first buy, after the split is locked.
// The three are signed together in one wallet prompt. Built with pump.fun's own SDK against the live Global account.
const { PUMP_SDK, OnlinePumpSdk, feeSharingConfigPda, newBondingCurve, getBuyTokenAmountFromSolAmount, bondingCurvePda, creatorVaultPda, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID } = require('@pump-fun/pump-sdk');
const { Connection, PublicKey, ComputeBudgetProgram, SystemProgram, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
const { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const BN = require('bn.js');

let cache = null;
async function chainState(rpcUrl, mock) {
  if (mock && mock.pumpState) return mock.pumpState();
  if (cache && Date.now() - cache.at < 60e3) return cache.v;
  const online = new OnlinePumpSdk(new Connection(rpcUrl, 'confirmed'));
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig().catch(() => null)]);
  cache = { at: Date.now(), v: { global, feeConfig } }; return cache.v;
}
const v0 = (payer, ixs, blockhash) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
const cuIx = (units, price) => [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price || 150000 })];

// o: { rpcUrl, mint, user, name, symbol, uri, shares: [{address, bps}], prefund: [{to, lamports}], devBuy, blockhash, mock }
async function buildSpawn(o) {
  const { global, feeConfig } = await chainState(o.rpcUrl, o.mock);
  if (global.createV2Enabled === false) throw new Error('pump.fun has coin creation switched off right now.');
  const M = new PublicKey(o.mint), U = new PublicKey(o.user);
  const tx1 = [...cuIx(300000, o.cuPrice),
    await PUMP_SDK.createV2Instruction({ mint: M, name: o.name, symbol: o.symbol, uri: o.uri, creator: U, user: U, mayhemMode: false }),
    await PUMP_SDK.createFeeSharingConfig({ creator: U, mint: M, pool: null })];
  const tx2 = [...cuIx(250000, o.cuPrice)];
  for (const p of o.prefund || []) if (p.lamports > 0) tx2.push(SystemProgram.transfer({ fromPubkey: U, toPubkey: new PublicKey(p.to), lamports: p.lamports }));
  tx2.push(await PUMP_SDK.updateFeeSharesV2({ authority: U, mint: M, currentShareholders: [U],
    newShareholders: o.shares.map(s => ({ address: new PublicKey(s.address), shareBps: s.bps })), quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID }));
  const txs = [v0(U, tx1, o.blockhash), v0(U, tx2, o.blockhash)];
  let expectOut = null;
  if (o.devBuy && Number(o.devBuy) > 0) {
    const fresh = newBondingCurve(global), sol = new BN(String(o.devBuy));
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: global.tokenTotalSupply, bondingCurve: fresh, amount: sol });
    const bc = { ...fresh, creator: feeSharingConfigPda(M) };      // by the time it buys, the curve's creator is the sharing config
    const ix = await PUMP_SDK.buyV2Instructions({ global, bondingCurveAccountInfo: null, bondingCurve: bc, associatedUserAccountInfo: null, mint: M, user: U, amount, quoteAmount: sol, slippage: 3, tokenProgram: TOKEN_2022_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID });
    txs.push(v0(U, [...cuIx(260000, o.cuPrice), ...ix], o.blockhash));
    expectOut = amount.toString();
  }
  const raw = txs.map(t => t.serialize());
  return { txs: raw.map(b => Buffer.from(b).toString('base64')), sizes: raw.map(b => b.length), expectOut, supply: global.tokenTotalSupply.toString(),
    sharingConfig: feeSharingConfigPda(M).toBase58(), bondingCurve: bondingCurvePda(M).toBase58(), vault: creatorVaultPda(feeSharingConfigPda(M)).toBase58() };
}

// what the chain says about a child: does it exist, are its fees routed and locked, and what is waiting in its
// creator vault. `getAccounts(addresses)` returns raw accounts ({data: Buffer, lamports} or null) in order.
async function routing(mint, getAccounts) {
  const M = new PublicKey(mint), cfg = feeSharingConfigPda(M), bcAddr = bondingCurvePda(M), vault = creatorVaultPda(cfg);
  const [bcInfo, cfgInfo, vInfo] = await getAccounts([bcAddr.toBase58(), cfg.toBase58(), vault.toBase58()]);
  if (!bcInfo) return { exists: false };
  const bc = PUMP_SDK.decodeBondingCurve(bcInfo), sc = cfgInfo ? PUMP_SDK.decodeSharingConfig(cfgInfo) : null;
  const vq = bc.virtualSolReserves || bc.virtualQuoteReserves, vt = bc.virtualTokenReserves;
  return {
    exists: true, complete: !!bc.complete, creator: bc.creator.toBase58(), routed: !!sc && bc.creator.equals(cfg), revoked: !!(sc && sc.adminRevoked),
    shareholders: sc ? sc.shareholders.map(s => ({ address: s.address.toBase58(), bps: Number(s.shareBps) })) : [],
    vault: vault.toBase58(), vaultLamports: vInfo ? Number(vInfo.lamports) : 0,
    mcapSol: vt && !vt.isZero() ? Number(vq.mul(bc.tokenTotalSupply).div(vt).toString()) / 1e9 : null,
  };
}

// the permissionless push: anyone can pay a child's creator vault out to its shareholders (the clicker pays the tx fee)
async function buildFeed({ mint, payer, blockhash, getAccounts }) {
  const M = new PublicKey(mint), P = new PublicKey(payer), cfg = feeSharingConfigPda(M);
  const [info] = await getAccounts([cfg.toBase58()]);
  if (!info) throw new Error('This coin has no fee-sharing config.');
  const sharingConfig = PUMP_SDK.decodeSharingConfig(info);
  const ix = await PUMP_SDK.distributeCreatorFeesV2({ mint: M, sharingConfig, sharingConfigAddress: cfg, quoteMint: NATIVE_MINT, payer: P, shouldInitializeAta: false, quoteTokenProgram: TOKEN_PROGRAM_ID });
  return { tx: Buffer.from(v0(P, [...cuIx(150000, 100000), ix], blockhash).serialize()).toString('base64') };
}

module.exports = { chainState, buildSpawn, routing, buildFeed, PUMP_PROGRAM_ID: PUMP_PROGRAM_ID.toBase58(), PUMP_FEE_PROGRAM_ID: PUMP_FEE_PROGRAM_ID.toBase58() };
