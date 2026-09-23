import anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, ComputeBudgetProgram } from "@solana/web3.js";
import { readFileSync } from "fs";
import { postFreshPrice } from "./mock-price.mjs";
const { AnchorProvider, Program, Wallet, web3 } = anchor;
const WP=new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const POOL=new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const OVA=new PublicKey("3uyTv2Pi3pb6Gc2emKiYU8gW845M1HeMMyFr2MTrDGh4");
const OVB=new PublicKey("63GvSvGYTsfesX1kmesdtfxHbBQBsFpZT1wVNhNADT5C");
const WSOL=new PublicKey("So11111111111111111111111111111111111111112");
const USDC=new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
const VA=new PublicKey("3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY");
const VB=new PublicKey("HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR");
const TOK=new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA=new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MEMO=new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const LOW=-40176, UP=-38168, TS=8, TAS=88;
const st=t=>Math.floor(t/(TAS*TS))*(TAS*TS);
const ta=t=>PublicKey.findProgramAddressSync([Buffer.from("tick_array"),POOL.toBuffer(),Buffer.from(st(t).toString())],WP)[0];
const kp=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ANCHOR_WALLET.replace("~",process.env.HOME),"utf8"))));
const conn=new web3.Connection(process.env.ANCHOR_PROVIDER_URL,"confirmed");
const provider=new AnchorProvider(conn,new Wallet(kp),{commitment:"confirmed"});
const program=new Program(JSON.parse(readFileSync("target/idl/perma.json","utf8")),provider);
const market=PublicKey.findProgramAddressSync([Buffer.from("market"),POOL.toBuffer()],program.programId)[0];
const auth=PublicKey.findProgramAddressSync([Buffer.from("market_authority"),market.toBuffer()],program.programId)[0];
const ucol=PublicKey.findProgramAddressSync([Buffer.from("collateral"),market.toBuffer(),kp.publicKey.toBuffer()],program.programId)[0];
const nonce=new BN(Date.now()%1e9);
const mint=Keypair.generate();
const orcaPos=PublicKey.findProgramAddressSync([Buffer.from("position"),mint.publicKey.toBuffer()],WP)[0];
const posAta=PublicKey.findProgramAddressSync([auth.toBuffer(),TOK.toBuffer(),mint.publicKey.toBuffer()],ATA)[0];
const permaPos=PublicKey.findProgramAddressSync([Buffer.from("perma_position"),market.toBuffer(),kp.publicKey.toBuffer(),nonce.toArrayLike(Buffer,"le",8)],program.programId)[0];
const premiumIndex=PublicKey.findProgramAddressSync([Buffer.from("premium_index"),market.toBuffer()],program.programId)[0];
const rangeVault=PublicKey.findProgramAddressSync([Buffer.from("range_vault"),market.toBuffer(),
  new BN(LOW).toTwos(32).toArrayLike(Buffer,"le",4), new BN(UP).toTwos(32).toArrayLike(Buffer,"le",4)],program.programId)[0];
const rangeState=PublicKey.findProgramAddressSync([Buffer.from("range"),market.toBuffer(),
  new BN(LOW).toTwos(32).toArrayLike(Buffer,"le",4), new BN(UP).toTwos(32).toArrayLike(Buffer,"le",4)],program.programId)[0];
const cu=l=>{for(const x of l??[]){const m=x.match(/consumed (\d+) of \d+ compute units/);if(m&&x.includes(program.programId.toBase58()))return +m[1];}return null;};
async function go(b,signers=[]){
  const tx=await b.transaction(); tx.feePayer=kp.publicKey;
  tx.recentBlockhash=(await conn.getLatestBlockhash()).blockhash; tx.sign(kp,...signers);
  const size=tx.serialize().length, n=tx.compileMessage().accountKeys.length;
  const sig=await conn.sendRawTransaction(tx.serialize()); await conn.confirmTransaction(sig,"confirmed");
  const p=await conn.getTransaction(sig,{commitment:"confirmed",maxSupportedTransactionVersion:0});
  return {size,n,cu:cu(p?.meta?.logMessages)};
}
const acct={owner:kp.publicKey,market,marketAuthority:auth,userCollateral:ucol,permaPosition:permaPos,
 premiumIndex,rangeState,rangeVault,
 whirlpool:POOL,orcaPosition:orcaPos,positionMint:mint.publicKey,positionTokenAccount:posAta,
 tokenMintA:WSOL,tokenMintB:USDC,vaultA:VA,vaultB:VB,orcaVaultA:OVA,orcaVaultB:OVB,
 tickArrayLower:ta(LOW),tickArrayUpper:ta(UP),tokenProgram:TOK,associatedTokenProgram:ATA,
 memoProgram:MEMO,whirlpoolProgram:WP,systemProgram:SystemProgram.programId,rent:SYSVAR_RENT_PUBKEY,
 priceUpdate:await postFreshPrice(conn,kp)};  // ADR-0004 oracle gate (localnet mock)
// Top up free balance so the measured mints are not refused for lack of collateral
// (the suites drain and refill the shared ledger). Capped by what the fixture ATAs hold.
{const USER_A=new PublicKey("J93MdzNbVkKHBh3KwWwS7Y7CjqtqfFHwd1zHgFgw3UZQ"),USER_B=new PublicKey("A728HNbbk6AjiqTsqNt5FbD7cz7xNpeXrx35qetgLcmX");
 const bal=async pk=>{const i=await conn.getAccountInfo(pk);return i?i.data.readBigUInt64LE(64):0n;};
 const u=await program.account.userCollateral.fetchNullable(ucol);
 const fa=u?BigInt(u.balanceA.toString()):0n, fb=u?BigInt(u.balanceB.toString()):0n;
 const min=(x,y)=>x<y?x:y; const ta=fa>=2_000_000_000n?0n:min(2_000_000_000n-fa,await bal(USER_A)); const tb=fb>=300_000_000n?0n:min(300_000_000n-fb,await bal(USER_B));
 if(ta>0n||tb>0n) await go(program.methods.depositCollateral(new BN(ta.toString()),new BN(tb.toString())).accounts({owner:kp.publicKey,market,userCollateral:ucol,userTokenA:USER_A,userTokenB:USER_B,vaultA:VA,vaultB:VB,tokenProgram:TOK,systemProgram:SystemProgram.programId}));}
const m=await go(program.methods.mintPosition(0,LOW,UP,new BN(100000000),new BN(1e9),new BN(1e8),nonce)
  .accounts(acct).preInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:400000})]).signers([mint]),[mint]);
console.log(`mint_position   ${m.size} bytes / 1232   ${m.n} accounts   ${m.cu} CU`);
const {associatedTokenProgram,systemProgram,rent,priceUpdate,...bacct}=acct;
const b=await go(program.methods.burnPosition(new BN(0),new BN(0))
  .accounts(bacct).preInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:600000})]));
console.log(`burn_position   ${b.size} bytes / 1232   ${b.n} accounts   ${b.cu} CU`);

// Component 08. Small by design: settling is a USDC transfer between two
// PERMA-owned token accounts plus bookkeeping - no Orca accounts at all.
const lnonce=new BN(Date.now()%1e9+7);
const lpos=PublicKey.findProgramAddressSync([Buffer.from("perma_position"),market.toBuffer(),
  kp.publicKey.toBuffer(),lnonce.toArrayLike(Buffer,"le",8)],program.programId)[0];
const LONG_NULLS={orcaPosition:null,positionMint:null,positionTokenAccount:null,tokenMintA:null,tokenMintB:null,vaultA:null,vaultB:null,orcaVaultA:null,orcaVaultB:null,tickArrayLower:null,tickArrayUpper:null,associatedTokenProgram:null,memoProgram:null,whirlpoolProgram:null};
const l0=await go(program.methods.mintPosition(1,LOW,UP,new BN(1000000),new BN(0),new BN(0),lnonce)
  .accounts({...acct,permaPosition:lpos,...LONG_NULLS}).remainingAccounts([])
  .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:400000})]));
console.log(`mint LONG (0 existing) ${l0.size} bytes / 1232   ${l0.n} accounts   ${l0.cu} CU`);
const from=await conn.getSlot("confirmed");
while((await conn.getSlot("confirmed"))<from+3) await new Promise(r=>setTimeout(r,400));
const s=await go(program.methods.settlePremium().accounts({cranker:kp.publicKey,owner:kp.publicKey,
  market,marketAuthority:auth,userCollateral:ucol,permaPosition:lpos,premiumIndex,rangeState,rangeVault,
  vaultB:VB,tokenProgram:TOK}));
console.log(`settle_premium  ${s.size} bytes / 1232   ${s.n} accounts   ${s.cu} CU`);

// Component 09: withdraw and long mint carry the open-long set as remaining accounts.
const USER_A=new PublicKey("J93MdzNbVkKHBh3KwWwS7Y7CjqtqfFHwd1zHgFgw3UZQ"), USER_B=new PublicKey("A728HNbbk6AjiqTsqNt5FbD7cz7xNpeXrx35qetgLcmX");
const openLongs=async()=>{const all=await program.account.permaPosition.all([{memcmp:{offset:8,bytes:market.toBase58()}},{memcmp:{offset:40,bytes:kp.publicKey.toBase58()}}]);
  return all.filter(x=>x.account.legType===1&&x.account.status===0).map(x=>({pubkey:x.publicKey,isSigner:false,isWritable:false}));};
const wacct={owner:kp.publicKey,market,marketAuthority:auth,userCollateral:ucol,userTokenA:USER_A,userTokenB:USER_B,vaultA:VA,vaultB:VB,tokenProgram:TOK,premiumIndex};
const w1=await go(program.methods.withdrawCollateral(new BN(0),new BN(1)).accounts(wacct).remainingAccounts(await openLongs()));
console.log(`withdraw (1 long)   ${w1.size} bytes / 1232   ${w1.n} accounts   ${w1.cu} CU`);
// open longs up to MAX_OPEN_LONGS-1 more, measuring the LAST long mint (worst case: 7 existing longs)
let lastMint=null;
for(let i=0;i<7;i++){const nn=new BN(Date.now()%1e9+100+i);const lp=PublicKey.findProgramAddressSync([Buffer.from("perma_position"),market.toBuffer(),kp.publicKey.toBuffer(),nn.toArrayLike(Buffer,"le",8)],program.programId)[0];
  lastMint=await go(program.methods.mintPosition(1,LOW,UP,new BN(1000000),new BN(0),new BN(0),nn)
    .accounts({...acct,permaPosition:lp,...LONG_NULLS})
    .remainingAccounts(await openLongs())
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:400000})]));}
console.log(`mint LONG (7 existing) ${lastMint.size} bytes / 1232   ${lastMint.n} accounts   ${lastMint.cu} CU`);
const w8=await go(program.methods.withdrawCollateral(new BN(0),new BN(1)).accounts(wacct).remainingAccounts(await openLongs()));
console.log(`withdraw (8 longs)  ${w8.size} bytes / 1232   ${w8.n} accounts   ${w8.cu} CU`);
// clean up: burn all longs so the ledger stays usable
for(const {pubkey} of await openLongs()){await go(program.methods.burnPosition(new BN(0),new BN(0)).accounts({owner:kp.publicKey,market,marketAuthority:auth,userCollateral:ucol,permaPosition:pubkey,premiumIndex,rangeState,rangeVault,
  whirlpool:null,orcaPosition:null,positionMint:null,positionTokenAccount:null,tokenMintA:null,tokenMintB:null,vaultA:null,vaultB:VB,orcaVaultA:null,orcaVaultB:null,tickArrayLower:null,tickArrayUpper:null,tokenProgram:TOK,memoProgram:null,whirlpoolProgram:null}));}
