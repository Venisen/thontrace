/**
 * Two stories played through the "world" interface (see test/spec.js), so the same code runs on the JavaScript
 * model (offline demo page, scripts/simulate-model.js), on a local Hardhat chain (scripts/simulate.js) and on a
 * live test network (scripts/deploy-live.js).
 *
 *   seed(w, ctx)   A short, no-waiting story that leaves the system in a good state for a visitor to explore:
 *                  open offer to accept, a catch whose certificate still needs validating, a lot on sale,
 *                  loggers assigned, tags ready to scan.
 *   full(w, ctx)   A longer story that also shows the rules saying no (certificate, mass balance, escrow,
 *                  cold-chain breach, recall) and reconciles the books after each phase. Needs w.advance().
 *
 * All organisation, vessel and lot names are fictional. Works in Node and in the browser.
 */
(function (root, factory) {
  const deps = typeof require === "function" && typeof module === "object" ? { K: require("./keccak"), E: require("./enums") } : { K: root.TT, E: root.TT };
  const api = factory(deps.K, deps.E);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TT = Object.assign(root.TT || {}, { story: api });
})(typeof globalThis !== "undefined" ? globalThis : this, function (K, E) {
  const KG = 1000n;
const DAY = 86400n;
const ZERO32 = "0x" + "00".repeat(32);

const SEED = {
  species: "Yellowfin",
  area: "FAO 51, Western Indian Ocean",
  method: "Purse seine",
  catchA: "CL-MV-0412-A1",
  catchB: "CL-MV-0412-B2",
  lots: { A: "LOT-0412-A", B: "LOT-0412-B", C: "LOT-0412-C" },
  loggers: { A: "LOG-A-001", C: "LOG-C-001" },
};
const ORG = {
  authority: "Mauritius Fisheries Authority (fictional)",
  vessel: "MV Ocean Dawn, purse seiner (fictional)",
  processor: "Port Louis Tuna Processing Ltd (fictional)",
  carrier: "Coral Cold Chain Logistics (fictional)",
  retailer: "Grand Baie Fish Market (fictional)",
  auditor: "Indian Ocean Seafood Audit (fictional)",
  gateway: "Logger gateway, Port Louis cold store (fictional)",
};
/** Pack tag secrets for the three seeded lots. Public on purpose: they let a visitor try the "scan pack" check. */
const demoTag = (code) => {
  const secret = K.keccakText(`${code}|tag-secret`);
  return { secret, commit: K.keccakHex(secret) };
};

const defaultCid = (w) => async (text) => "doc-" + w.hash(text).slice(2, 18);
const out = (code, form, kg, o = {}) => ({ code, form, grams: kg * KG, frozen: false, bestBefore: 0n, tagCommit: ZERO32, docsCid: "", ...o });

async function books(w, root, holders) {
  const r = await w.view("reconcile", w.keyOf(root), holders.map((h) => w.addr[h]));
  return {
    landed: BigInt(r.landed), held: BigInt(r.held), inTransit: BigInt(r.inTransit), sold: BigInt(r.sold), waste: BigInt(r.waste),
    lost: BigInt(r.lost), destroyed: BigInt(r.destroyed), unexplained: BigInt(r.unexplained), balanced: r.balanced,
  };
}
const HOLDERS = ["vessel", "processor", "carrier", "retailer"];

// ----------------------------------------------------------------------------------------------------------
async function seed(w, ctx = {}) {
  const log = ctx.log || (() => {});
  const cid = ctx.cid || defaultCid(w);
  const S = SEED;
  const step = async (label, p) => {
    const r = await p;
    log(label, r);
    return r;
  };
  const now = await w.now();

  await step("Authority gave the vessel a yellowfin allocation: 20,000 kg per 30 days", w.send("authority", "setAllocation", w.addr.vessel, "Yellowfin", 20000n * KG));
  await step("Authority gave the vessel a bigeye allocation: 8,000 kg per 30 days", w.send("authority", "setAllocation", w.addr.vessel, "Bigeye", 8000n * KG));

  await step(`Vessel registered catch ${S.catchA} (yellowfin, 1,000 kg declared)`, w.send("vessel", "registerCatch", {
    code: S.catchA, species: "Yellowfin", method: S.method, area: S.area, declaredGrams: 1000n * KG, frozen: false, certCid: await cid(`catch certificate ${S.catchA}`),
  }));
  await step("Authority validated the catch certificate", w.send("authority", "validateCertificate", S.catchA));
  await step("Processor landed the catch: scale reading 982 kg", w.send("processor", "recordLanding", S.catchA, 982n * KG));

  const tags = Object.fromEntries(Object.entries(S.lots).map(([k, code]) => [k, demoTag(code)]));
  await step("Processor cut the catch into three lots plus 130 kg of waste (22 kg unexplained, 2.2 %)", w.send("processor", "recordTransformation", S.catchA, [
    out(S.lots.A, "Loins", 430n, { bestBefore: now + 12n * DAY, tagCommit: tags.A.commit, docsCid: await cid(`lab report ${S.lots.A}`) }),
    out(S.lots.B, "Steaks", 280n, { bestBefore: now + 12n * DAY, tagCommit: tags.B.commit, docsCid: await cid(`lab report ${S.lots.B}`) }),
    out(S.lots.C, "Belly, frozen", 120n, { frozen: true, bestBefore: now + 180n * DAY, tagCommit: tags.C.commit, docsCid: await cid(`lab report ${S.lots.C}`) }),
  ], 130n * KG));

  await step("Processor shelved the loins in cold room CR-2", w.send("processor", "storeLot", S.lots.A, "CR-2"));
  await step("Processor shelved the steaks in cold room CR-2", w.send("processor", "storeLot", S.lots.B, "CR-2"));
  await step("Processor shelved the frozen belly in freezer FZ-1", w.send("processor", "storeLot", S.lots.C, "FZ-1"));
  await step("Processor attached a temperature logger to the loins", w.send("processor", "assignLogger", S.loggers.A, S.lots.A));
  await step("Processor attached a temperature logger to the frozen belly", w.send("processor", "assignLogger", S.loggers.C, S.lots.C));
  await step("Gateway sent a normal reading for the loins (1.2 C at the warmest)", w.send("gateway", "submitSummary", S.loggers.A, 120n, 0n, 0n, w.hash("seed-summary-A")));
  await step("Gateway sent a normal reading for the frozen belly (-19 C at the warmest)", w.send("gateway", "submitSummary", S.loggers.C, -1900n, 0n, 0n, w.hash("seed-summary-C")));

  const o1 = await step("Processor offered the steaks to the retailer for 7 days", w.send("processor", "proposeTransfer", S.lots.B, w.addr.retailer, 7n * DAY, w.hash(`delivery note ${S.lots.B}`)));
  await step("Retailer accepted the steaks", w.send("retailer", "acceptTransfer", o1.events.find((e) => e.name === "OfferCreated").args.offerId));
  await step("Retailer put the steaks on sale", w.send("retailer", "setOnSale", S.lots.B));
  await step("Retailer sold 60 kg", w.send("retailer", "recordSale", S.lots.B, 60n * KG));

  await step("Processor offered the loins to the carrier for 7 days (left open for a visitor to accept)", w.send("processor", "proposeTransfer", S.lots.A, w.addr.carrier, 7n * DAY, w.hash(`delivery note ${S.lots.A}`)));
  await step(`Vessel registered catch ${S.catchB} (bigeye, 600 kg); its certificate is left for the authority to validate`, w.send("vessel", "registerCatch", {
    code: S.catchB, species: "Bigeye", method: S.method, area: S.area, declaredGrams: 600n * KG, frozen: false, certCid: await cid(`catch certificate ${S.catchB}`),
  }));

  return {
    tags: Object.fromEntries(Object.entries(S.lots).map(([k, code]) => [code, { secret: tags[k].secret }])),
    books: await books(w, S.catchA, HOLDERS),
  };
}

// ----------------------------------------------------------------------------------------------------------
async function full(w, ctx = {}) {
  const log = ctx.log || (() => {});
  const cid = ctx.cid || defaultCid(w);
  const report = { phases: [], blocked: {}, verdicts: {} };
  const blocked = async (key, label, promise, name) => {
    await w.reverts(promise, name);
    report.blocked[key] = name;
    log(`   blocked: ${label} -> ${name}`);
  };
  const phase = async (label) => {
    const b = await books(w, SEED.catchA, HOLDERS);
    report.phases.push({ phase: label, ...Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === "bigint" ? Number(v / KG) : v])) });
    log(`   books [${label}]: landed ${b.landed / KG} kg = held ${b.held / KG} + transit ${b.inTransit / KG} + sold ${b.sold / KG} + waste ${b.waste / KG} + lost ${b.lost / KG} + destroyed ${b.destroyed / KG} + unexplained ${b.unexplained / KG} -> ${b.balanced ? "BALANCED" : "MISMATCH"}`);
    if (!b.balanced) throw new Error("books do not balance");
  };
  const S = SEED;
  const L = S.lots;
  const now = await w.now();

  log("1. The authority gives the vessel an allocation; the vessel registers a catch");
  await w.send("authority", "setAllocation", w.addr.vessel, "Yellowfin", 20000n * KG);
  await blocked("noAllocation", "bigeye catch without a bigeye allocation", w.send("vessel", "registerCatch", { code: "X1", species: "Bigeye", method: S.method, area: S.area, declaredGrams: 500n * KG, frozen: false, certCid: "doc" }), "NoAllocation");
  await w.send("vessel", "registerCatch", { code: S.catchA, species: "Yellowfin", method: S.method, area: S.area, declaredGrams: 1000n * KG, frozen: false, certCid: await cid("catch certificate A1") });

  log("2. Landing needs a validated certificate");
  await blocked("certificate", "landing before the authority validated the certificate", w.send("processor", "recordLanding", S.catchA, 1000n * KG), "CertificateNotValidated");
  await w.send("authority", "validateCertificate", S.catchA);
  const landing = await w.send("processor", "recordLanding", S.catchA, 982n * KG);
  report.landingWarning = landing.events.some((e) => e.name === "LandingWeightWarning");
  await phase("after landing");

  log("3. Processing keeps the mass balance within 5 %");
  await blocked("massBalance", "outputs that add up to 80 % of the input", w.send("processor", "recordTransformation", S.catchA, [out(L.A, "Loins", 700n)], 86n * KG), "MassBalanceOutOfTolerance");
  await w.send("processor", "recordTransformation", S.catchA, [
    out(L.A, "Loins", 430n, { bestBefore: now + 12n * DAY, tagCommit: demoTag(L.A).commit, docsCid: await cid("lab A") }),
    out(L.B, "Steaks", 280n, { bestBefore: now + 12n * DAY, tagCommit: demoTag(L.B).commit, docsCid: await cid("lab B") }),
    out(L.C, "Belly, frozen", 120n, { frozen: true, bestBefore: now + 180n * DAY, tagCommit: demoTag(L.C).commit, docsCid: await cid("lab C") }),
  ], 130n * KG);
  await phase("after processing");

  log("4. Handovers: escrow, accept, decline, timeout");
  for (const code of [L.A, L.B, L.C]) await w.send("processor", "storeLot", code, code === L.C ? "FZ-1" : "CR-2");
  const offerA = (await w.send("processor", "proposeTransfer", L.A, w.addr.carrier, 2n * DAY, w.hash("note A"))).events.find((e) => e.name === "OfferCreated").args.offerId;
  await blocked("notRecipient", "someone else accepting the carrier's offer", w.send("retailer", "acceptTransfer", offerA), "NotOfferRecipient");
  await phase("loins in escrow");
  await w.send("carrier", "declineTransfer", offerA, "Pack damaged on arrival");
  await phase("after the carrier declined");
  const offerA2 = (await w.send("processor", "proposeTransfer", L.A, w.addr.carrier, 2n * DAY, w.hash("note A2"))).events.find((e) => e.name === "OfferCreated").args.offerId;
  await w.send("carrier", "acceptTransfer", offerA2);
  const offerB = (await w.send("processor", "proposeTransfer", L.B, w.addr.retailer, 1n * DAY, w.hash("note B"))).events.find((e) => e.name === "OfferCreated").args.offerId;
  await w.advance(2n * DAY);
  await blocked("offerExpired", "accepting an offer after its timeout", w.send("retailer", "acceptTransfer", offerB), "OfferHasExpired");
  await w.send("processor", "expireTransfer", offerB);
  await phase("after the timeout released the steaks");

  log("5. Cold chain: a breach flags the lot, and only an independent clearance releases it");
  await w.send("carrier", "storeLot", L.A, "Truck RT-4471");
  await w.send("carrier", "assignLogger", S.loggers.A, L.A);
  await w.send("gateway", "submitSummary", S.loggers.A, 150n, 20n, 0n, w.hash("ok"));
  const bad = await w.send("gateway", "submitSummary", S.loggers.A, 650n, 45n, 0n, w.hash("breach"));
  report.breachRaised = bad.events.some((e) => e.name === "ColdChainBreach");
  const flagId = bad.events.find((e) => e.name === "FlagRaised").args.flagId;
  await blocked("breachBlocksTransfer", "handing over a lot with an open breach", w.send("carrier", "proposeTransfer", L.A, w.addr.retailer, DAY, ZERO32), "LotBlocked");
  report.verdicts.afterBreach = E.verdictName((await w.view("verifyLot", L.A)).verdict);
  await blocked("holderCannotClear", "the holder clearing its own breach", w.send("carrier", "clearFlag", flagId, ZERO32), "NotAuthorised");
  await w.send("carrier", "requestClearance", flagId, w.hash("laboratory histamine result 8 ppm"));
  await w.send("auditor", "clearFlag", flagId, w.hash("auditor release"));
  report.verdicts.afterClearance = E.verdictName((await w.view("verifyLot", L.A)).verdict);

  log("6. Retail and loss");
  const offerA3 = (await w.send("carrier", "proposeTransfer", L.A, w.addr.retailer, 2n * DAY, w.hash("note A3"))).events.find((e) => e.name === "OfferCreated").args.offerId;
  await w.send("retailer", "acceptTransfer", offerA3);
  await w.send("retailer", "setOnSale", L.A);
  await w.send("retailer", "recordSale", L.A, 200n * KG);
  await w.send("retailer", "reportLoss", L.A, 10n * KG, false, await cid("spoilage note"));
  await phase("after sales and a loss");

  log("7. Recall: the authority marks the catch and everything made from it");
  report.recallImpact = Object.fromEntries(Object.entries(await w.view("recallImpact", S.catchA)).map(([k, v]) => [k, Number(BigInt(v) / (k === "lotsReached" ? 1n : KG))]));
  const recall = await w.send("authority", "issueRecall", S.catchA, "Histamine above the limit in a retained sample");
  report.recallLotsMarked = Number(recall.events.find((e) => e.name === "RecallIssued").args.lotsMarked);
  await blocked("recallBlocksSale", "selling a recalled lot", w.send("retailer", "recordSale", L.A, 1n * KG), "LotRecalled");
  await w.send("retailer", "reportLoss", L.A, 220n * KG, true, await cid("destruction witness"));
  await phase("after recall and destruction");

  report.verdicts.publicCheck = Object.fromEntries(await Promise.all(Object.values(L).map(async (c) => [c, E.verdictName((await w.view("verifyLot", c)).verdict)])));
  return report;
}

return { seed, full, SEED, ORG, demoTag, KG, DAY };
});
