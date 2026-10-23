/**
 * ThonTrace reference model.
 *
 * A line-by-line JavaScript transcription of contracts/ThonTrace.sol: the same checks in the same order, the same
 * error names, the same events with the same argument names, whole-number (BigInt) arithmetic, and all-or-nothing
 * transactions (a failed call leaves no trace, as on a blockchain).
 *
 * It serves two purposes:
 *   1. It lets the whole prototype (tests, simulation, offline demo page) run without a compiler or a node.
 *   2. It is the executable specification: test/spec.js is run against this model and against the deployed
 *      Solidity contract, and both must pass the same tests.
 *
 * It is NOT the contract. If you change a rule in ThonTrace.sol, change it here too; the shared tests will tell you
 * if the two have drifted apart.
 */
(function (root, factory) {
  const deps = typeof require === "function" && typeof module === "object" ? { k: require("./keccak"), e: require("./enums") } : { k: root.TT, e: root.TT };
  const api = factory(deps.k, deps.e);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TT = Object.assign(root.TT || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (K, E) {
  const big = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, BigInt(v)]));
  const S = big(E.State);
  const OS = big(E.OfferStatus);
  const FR = big(E.FlagReason);
  const LV = big(E.LotVerdict);
  const TV = big(E.TagVerdict);

  const ZERO32 = "0x" + "00".repeat(32);
  const ZERO_ADDR = "0x" + "00".repeat(20);
  const DAY = 86400n;
  const ALLOCATION_PERIOD = 30n * DAY;
  const MAX_OFFER_TTL = 7n * DAY;
  const TOLERANCE_BP = 500n;
  const MAX_OUTPUTS = 8;
  const MAX_FAMILY = 64;
  const START_TIME = 1792713600n; // 2026-10-23 00:00 UTC

  const ROLE_NAMES = ["AUTHORITY", "VESSEL", "PROCESSOR", "CARRIER", "RETAILER", "AUDITOR", "GATEWAY"];

  class Revert extends Error {
    constructor(errorName) {
      super(errorName);
      this.name = "Revert";
      this.errorName = errorName;
    }
  }
  const revert = (name) => {
    throw new Revert(name);
  };

  const lc = (a) => String(a).toLowerCase();
  const sub = (a, b) => (a < b ? revert("Panic") : a - b);

  const keyOf = (code) => K.keccakText(code);
  const bool = (x) => !!x;
  const sget = (v) => (typeof v === "bigint" ? v : BigInt(v));

  function newLot() {
    return {
      code: "", species: "", form: "", method: "", area: "", docsCid: "", coldRoom: "",
      root: ZERO32, parent: ZERO32, custodian: ZERO_ADDR,
      state: S.None, frozen: false, recalled: false, certValidated: false, breachOpen: false,
      openFlags: 0n, incidents: 0n, resolved: 0n,
      createdAt: 0n, landedAt: 0n, bestBefore: 0n,
      declared: 0n, weight: 0n, exposureMin: 0n, tagCommit: ZERO32,
    };
  }
  const newFamily = () => ({ landed: 0n, inTransit: 0n, sold: 0n, waste: 0n, lost: 0n, destroyed: 0n, unexplained: 0n });

  class ThonTraceModel {
    constructor(admin) {
      this.time = START_TIME;
      this.sender = ZERO_ADDR;
      this.events = [];
      this.s = {
        roles: { DEFAULT_ADMIN: [lc(admin)] },
        lots: {}, lotKeys: [], kids: {}, families: {}, held: {},
        offers: {}, offerCount: 0n, flags: {}, flagCount: 0n,
        suspended: {}, alloc: {}, usage: {}, loggerLot: {},
      };
    }

    // ---- environment -------------------------------------------------
    advance(seconds) {
      this.time += BigInt(seconds);
    }
    now() {
      return this.time;
    }

    /** Runs one transaction from `from`; on any revert the state and the events are rolled back. */
    send(from, fn, ...args) {
      if (typeof this[fn] !== "function" || fn.startsWith("_") || !ThonTraceModel.WRITES.includes(fn)) throw new Error(`not a transaction: ${fn}`);
      const snapshot = structuredClone(this.s);
      this.sender = lc(from);
      this.events = [];
      try {
        const value = this[fn](...args);
        const events = this.events;
        this.events = [];
        this.time += 1n; // each transaction lands in its own second, as on a chain with a block per transaction
        return { value, events };
      } catch (err) {
        this.s = snapshot;
        this.events = [];
        throw err;
      } finally {
        this.sender = ZERO_ADDR;
      }
    }

    /** Read-only call. */
    view(fn, ...args) {
      if (typeof this[fn] !== "function" || fn.startsWith("_") || !ThonTraceModel.READS.includes(fn)) throw new Error(`not a view: ${fn}`);
      return this[fn](...args);
    }

    _emit(name, args) {
      this.events.push({ name, args });
    }

    // ---- access control ----------------------------------------------
    hasRole(role, account) {
      const set = this.s.roles[role] || [];
      return set.includes(lc(account));
    }
    grantRole(role, account) {
      if (!this.hasRole("DEFAULT_ADMIN", this.sender)) revert("AccessControlUnauthorizedAccount");
      const set = (this.s.roles[role] = this.s.roles[role] || []);
      if (!set.includes(lc(account))) set.push(lc(account));
    }
    revokeRole(role, account) {
      if (!this.hasRole("DEFAULT_ADMIN", this.sender)) revert("AccessControlUnauthorizedAccount");
      this.s.roles[role] = (this.s.roles[role] || []).filter((a) => a !== lc(account));
    }
    _onlyRole(role) {
      if (!this.hasRole(role, this.sender)) revert("AccessControlUnauthorizedAccount");
    }
    _live() {
      if (this.s.suspended[this.sender]) revert("Suspended");
    }

    // ---- helpers -----------------------------------------------------
    keyOf(code) {
      return keyOf(code);
    }
    _lot(key) {
      const l = this.s.lots[key];
      if (!l || l.state === S.None) revert("UnknownLot");
      return l;
    }
    _notBlocked(l) {
      if (l.recalled) revert("LotRecalled");
      if (l.openFlags > 0n) revert("LotBlocked");
    }
    _fresh(l) {
      if (l.bestBefore !== 0n && this.time >= l.bestBefore) revert("LotExpired");
    }
    _isMember(who) {
      return ["AUTHORITY", "VESSEL", "PROCESSOR", "CARRIER", "RETAILER", "AUDITOR"].some((r) => this.hasRole(r, who));
    }
    _validNext(from, to) {
      if (lc(from) === lc(to)) return false;
      if (this.hasRole("PROCESSOR", from)) return this.hasRole("CARRIER", to) || this.hasRole("RETAILER", to) || this.hasRole("PROCESSOR", to);
      if (this.hasRole("CARRIER", from)) return this.hasRole("CARRIER", to) || this.hasRole("RETAILER", to);
      return false;
    }
    _outsideTolerance(expected, actual) {
      const diff = expected > actual ? expected - actual : actual - expected;
      return diff * 10000n > expected * TOLERANCE_BP;
    }
    _heldKey(root, who) {
      return `${root}|${lc(who)}`;
    }
    _held(root, who) {
      return this.s.held[this._heldKey(root, who)] || 0n;
    }
    _setHeld(root, who, v) {
      this.s.held[this._heldKey(root, who)] = v;
    }
    _family(root) {
      return (this.s.families[root] = this.s.families[root] || newFamily());
    }

    // ---- authority ---------------------------------------------------
    setAllocation(vessel, species, perPeriod) {
      this._onlyRole("AUTHORITY");
      if (!this.hasRole("VESSEL", vessel) || species.length === 0) revert("InvalidInput");
      const sid = keyOf(species);
      this.s.alloc[`${sid}|${lc(vessel)}`] = BigInt(perPeriod);
      this._emit("AllocationSet", { vessel: lc(vessel), speciesId: sid, perPeriod: BigInt(perPeriod) });
    }
    suspendMember(member, reason) {
      this._onlyRole("AUTHORITY");
      this.s.suspended[lc(member)] = true;
      this._emit("MemberSuspended", { member: lc(member), by: this.sender, reason });
    }
    reinstateMember(member) {
      this._onlyRole("AUTHORITY");
      this.s.suspended[lc(member)] = false;
      this._emit("MemberReinstated", { member: lc(member), by: this.sender });
    }
    validateCertificate(code) {
      if (!this.hasRole("AUTHORITY", this.sender) && !this.hasRole("AUDITOR", this.sender)) revert("NotAuthorised");
      const key = keyOf(code);
      const l = this._lot(key);
      if (l.parent !== ZERO32) revert("WrongState");
      l.certValidated = true;
      this._emit("CertificateValidated", { key, by: this.sender });
    }
    issueRecall(code, reason) {
      this._onlyRole("AUTHORITY");
      const key = keyOf(code);
      this._lot(key);
      const fam = this._descendants(key);
      for (const k of fam) this.s.lots[k].recalled = true;
      this._emit("RecallIssued", { key, by: this.sender, reason, lotsMarked: BigInt(fam.length) });
    }
    _descendants(start) {
      const queue = [start];
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++];
        for (const child of this.s.kids[cur] || []) {
          if (queue.length >= MAX_FAMILY) revert("FamilyTooLarge");
          queue.push(child);
        }
      }
      return queue;
    }

    // ---- vessel ------------------------------------------------------
    registerCatch(input) {
      this._onlyRole("VESSEL");
      this._live();
      if (!input.code || !input.species || BigInt(input.declaredGrams) === 0n || !input.certCid) revert("InvalidInput");
      const key = keyOf(input.code);
      if (this.s.lots[key] && this.s.lots[key].state !== S.None) revert("LotExists");
      this._consumeAllocation(keyOf(input.species), this.sender, BigInt(input.declaredGrams));

      const l = (this.s.lots[key] = newLot());
      l.code = input.code;
      l.species = input.species;
      l.method = input.method || "";
      l.area = input.area || "";
      l.docsCid = input.certCid;
      l.root = key;
      l.custodian = this.sender;
      l.state = S.Registered;
      l.frozen = bool(input.frozen);
      l.createdAt = this.time;
      l.declared = BigInt(input.declaredGrams);
      this.s.lotKeys.push(key);
      this._emit("LotRegistered", { key, vessel: this.sender, code: input.code, species: input.species, declaredGrams: l.declared, certCid: input.certCid });
      return key;
    }
    _consumeAllocation(sid, vessel, grams) {
      const allocation = this.s.alloc[`${sid}|${lc(vessel)}`] || 0n;
      if (allocation === 0n) revert("NoAllocation");
      const u = (this.s.usage[`${sid}|${lc(vessel)}`] = this.s.usage[`${sid}|${lc(vessel)}`] || { windowStart: 0n, registered: 0n });
      if (this.time >= u.windowStart + ALLOCATION_PERIOD) {
        u.windowStart = this.time;
        u.registered = 0n;
      }
      if (u.registered + grams > allocation) revert("AllocationExceeded");
      u.registered += grams;
    }

    // ---- processor ---------------------------------------------------
    recordLanding(code, scaleGrams) {
      this._onlyRole("PROCESSOR");
      this._live();
      scaleGrams = BigInt(scaleGrams);
      const key = keyOf(code);
      const l = this._lot(key);
      if (l.state !== S.Registered) revert("WrongState");
      this._notBlocked(l);
      if (!l.certValidated) revert("CertificateNotValidated");
      if (scaleGrams === 0n) revert("InvalidInput");
      if (this._outsideTolerance(l.declared, scaleGrams)) this._emit("LandingWeightWarning", { key, declaredGrams: l.declared, scaleGrams });
      l.state = S.Landed;
      l.custodian = this.sender;
      l.weight = scaleGrams;
      l.landedAt = this.time;
      this._family(key).landed = scaleGrams;
      this._setHeld(key, this.sender, scaleGrams);
      this._emit("LotLanded", { key, processor: this.sender, scaleGrams });
    }

    recordTransformation(inputCode, outputs, wasteGrams) {
      this._onlyRole("PROCESSOR");
      this._live();
      wasteGrams = BigInt(wasteGrams);
      const ik = keyOf(inputCode);
      const inp = this._lot(ik);
      if (inp.state !== S.Landed) revert("WrongState");
      if (inp.custodian !== this.sender) revert("NotCustodian");
      this._notBlocked(inp);
      if (outputs.length === 0 || outputs.length > MAX_OUTPUTS) revert("InvalidInput");

      let outSum = 0n;
      for (const o of outputs) outSum += BigInt(o.grams);
      const total = outSum + wasteGrams;
      if (this._outsideTolerance(inp.weight, total)) revert("MassBalanceOutOfTolerance");

      const keys = outputs.map((o) => this._createOutput(inp, ik, o));
      const f = this._family(inp.root);
      f.waste += wasteGrams;
      f.unexplained += inp.weight - total;
      this._setHeld(inp.root, this.sender, sub(this._held(inp.root, this.sender), inp.weight) + outSum);
      const unexplained = inp.weight - total;
      inp.weight = 0n;
      inp.state = S.Processed;
      this._emit("Transformed", { input: ik, processor: this.sender, outputs: BigInt(outputs.length), wasteGrams, unexplainedGrams: unexplained });
      return keys;
    }
    _createOutput(inp, parentKey, o) {
      if (!o.code || !o.form || BigInt(o.grams) === 0n) revert("InvalidInput");
      const bestBefore = BigInt(o.bestBefore || 0);
      if (bestBefore !== 0n && bestBefore <= this.time) revert("InvalidInput");
      const key = keyOf(o.code);
      if (this.s.lots[key] && this.s.lots[key].state !== S.None) revert("LotExists");
      const l = (this.s.lots[key] = newLot());
      l.code = o.code;
      l.species = inp.species;
      l.form = o.form;
      l.method = inp.method;
      l.area = inp.area;
      l.docsCid = o.docsCid || "";
      l.root = inp.root;
      l.parent = parentKey;
      l.custodian = this.sender;
      l.state = S.Processed;
      l.frozen = bool(o.frozen);
      l.createdAt = this.time;
      l.bestBefore = bestBefore;
      l.declared = BigInt(o.grams);
      l.weight = BigInt(o.grams);
      l.tagCommit = o.tagCommit || ZERO32;
      this.s.lotKeys.push(key);
      (this.s.kids[parentKey] = this.s.kids[parentKey] || []).push(key);
      this._emit("OutputCreated", { key, parent: parentKey, code: o.code, grams: l.declared });
      return key;
    }

    // ---- custodian ---------------------------------------------------
    storeLot(code, coldRoom) {
      this._live();
      const key = keyOf(code);
      const l = this._lot(key);
      if (l.custodian !== this.sender) revert("NotCustodian");
      if ((l.state !== S.Processed && l.state !== S.Received) || l.weight === 0n) revert("WrongState");
      this._notBlocked(l);
      this._fresh(l);
      if (!coldRoom) revert("InvalidInput");
      l.state = S.Stored;
      l.coldRoom = coldRoom;
      this._emit("LotStored", { key, by: this.sender, coldRoom });
    }

    // ---- handovers ---------------------------------------------------
    proposeTransfer(code, to, ttl, docHash) {
      this._live();
      ttl = BigInt(ttl);
      const key = keyOf(code);
      const l = this._lot(key);
      if (l.custodian !== this.sender) revert("NotCustodian");
      if (l.state !== S.Stored) revert("WrongState");
      this._notBlocked(l);
      this._fresh(l);
      if (ttl === 0n || ttl > MAX_OFFER_TTL) revert("InvalidInput");
      if (this.s.suspended[lc(to)]) revert("Suspended");
      if (!this._validNext(this.sender, to)) revert("InvalidRecipient");

      l.state = S.InTransit;
      this._setHeld(l.root, this.sender, sub(this._held(l.root, this.sender), l.weight));
      this._family(l.root).inTransit += l.weight;
      const id = ++this.s.offerCount;
      const expiresAt = this.time + ttl;
      this.s.offers[id] = { lot: key, from: this.sender, to: lc(to), grams: l.weight, createdAt: this.time, expiresAt, docHash: docHash || ZERO32, status: OS.Open };
      this._emit("OfferCreated", { offerId: id, lot: key, from: this.sender, to: lc(to), grams: l.weight, expiresAt, docHash: docHash || ZERO32 });
      return id;
    }
    _openOffer(id) {
      const o = this.s.offers[BigInt(id)];
      if (!o || o.status === OS.None) revert("UnknownOffer");
      if (o.status !== OS.Open) revert("OfferNotOpen");
      return o;
    }
    acceptTransfer(id) {
      this._live();
      const o = this._openOffer(id);
      if (this.sender !== o.to) revert("NotOfferRecipient");
      if (this.time > o.expiresAt) revert("OfferHasExpired");
      const l = this.s.lots[o.lot];
      this._notBlocked(l);
      this._fresh(l);
      if (this.s.suspended[o.from]) revert("Suspended");
      o.status = OS.Accepted;
      l.custodian = this.sender;
      l.state = S.Received;
      const f = this._family(l.root);
      f.inTransit = sub(f.inTransit, o.grams);
      this._setHeld(l.root, this.sender, this._held(l.root, this.sender) + o.grams);
      this._emit("OfferAccepted", { offerId: BigInt(id), lot: o.lot, to: this.sender, grams: o.grams });
    }
    _returnToSender(o) {
      const l = this.s.lots[o.lot];
      l.state = S.Stored;
      const f = this._family(l.root);
      f.inTransit = sub(f.inTransit, o.grams);
      this._setHeld(l.root, o.from, this._held(l.root, o.from) + o.grams);
    }
    declineTransfer(id, reason) {
      const o = this._openOffer(id);
      if (this.sender !== o.to) revert("NotOfferRecipient");
      o.status = OS.Declined;
      this._returnToSender(o);
      this._emit("OfferDeclined", { offerId: BigInt(id), lot: o.lot, by: this.sender, reason });
    }
    withdrawTransfer(id) {
      const o = this._openOffer(id);
      if (this.sender !== o.from) revert("NotOfferSender");
      o.status = OS.Withdrawn;
      this._returnToSender(o);
      this._emit("OfferWithdrawn", { offerId: BigInt(id), lot: o.lot, by: this.sender });
    }
    expireTransfer(id) {
      const o = this._openOffer(id);
      if (this.time <= o.expiresAt && !this.s.suspended[o.to]) revert("OfferNotExpired");
      o.status = OS.Expired;
      this._returnToSender(o);
      this._emit("OfferExpired", { offerId: BigInt(id), lot: o.lot });
    }

    // ---- retailer ----------------------------------------------------
    setOnSale(code) {
      this._onlyRole("RETAILER");
      this._live();
      const key = keyOf(code);
      const l = this._lot(key);
      if (l.custodian !== this.sender) revert("NotCustodian");
      if ((l.state !== S.Received && l.state !== S.Stored) || l.weight === 0n) revert("WrongState");
      this._notBlocked(l);
      this._fresh(l);
      l.state = S.OnSale;
      this._emit("LotPutOnSale", { key, retailer: this.sender });
    }
    recordSale(code, grams) {
      this._onlyRole("RETAILER");
      this._live();
      grams = BigInt(grams);
      const key = keyOf(code);
      const l = this._lot(key);
      if (l.custodian !== this.sender) revert("NotCustodian");
      if (l.state !== S.OnSale) revert("WrongState");
      this._notBlocked(l);
      this._fresh(l);
      if (grams === 0n || grams > l.weight) revert("InsufficientWeight");
      l.weight -= grams;
      this._setHeld(l.root, this.sender, sub(this._held(l.root, this.sender), grams));
      this._family(l.root).sold += grams;
      if (l.weight === 0n) l.state = S.Sold;
      this._emit("LotSold", { key, retailer: this.sender, grams, remaining: l.weight });
    }

    // ---- loss --------------------------------------------------------
    reportLoss(code, grams, destroyed, reasonCid) {
      this._live();
      grams = BigInt(grams);
      const key = keyOf(code);
      const l = this._lot(key);
      if (l.custodian !== this.sender) revert("NotCustodian");
      if (l.state === S.InTransit) revert("WrongState");
      if (grams === 0n || !reasonCid) revert("InvalidInput");
      if (grams > l.weight) revert("InsufficientWeight");
      l.weight -= grams;
      this._setHeld(l.root, this.sender, sub(this._held(l.root, this.sender), grams));
      if (destroyed) this._family(l.root).destroyed += grams;
      else this._family(l.root).lost += grams;
      if (l.weight === 0n) l.state = S.Closed;
      this._emit("LossReported", { key, holder: this.sender, grams, destroyed: bool(destroyed), reasonCid });
    }

    // ---- cold chain --------------------------------------------------
    assignLogger(loggerId, code) {
      this._live();
      const key = keyOf(code);
      const l = this._lot(key);
      if (l.custodian !== this.sender) revert("NotCustodian");
      if (l.state === S.InTransit || l.weight === 0n) revert("WrongState");
      if (!loggerId) revert("InvalidInput");
      const lk = keyOf(loggerId);
      this.s.loggerLot[lk] = key;
      l.exposureMin = 0n;
      this._emit("LoggerAssigned", { loggerKey: lk, lot: key, loggerId });
    }
    submitSummary(loggerId, maxCentiC, minutesAboveAlert, gapMinutes, digest) {
      this._onlyRole("GATEWAY");
      this._live();
      maxCentiC = BigInt(maxCentiC);
      const lk = keyOf(loggerId);
      const key = this.s.loggerLot[lk];
      if (!key || key === ZERO32) revert("UnknownLogger");
      const l = this.s.lots[key];
      let hardLimit = 400n;
      let maxExposure = 60n;
      let maxGap = 30n;
      if (l.frozen) {
        hardLimit = -1500n;
        maxExposure = 120n;
        maxGap = 60n;
      }
      let exposure = l.exposureMin + BigInt(minutesAboveAlert);
      if (BigInt(gapMinutes) > maxGap) {
        exposure += BigInt(gapMinutes);
        this._emit("DataGap", { lot: key, gapMinutes: BigInt(gapMinutes) });
      }
      l.exposureMin = exposure;
      this._emit("SummaryRecorded", { lot: key, loggerKey: lk, maxCentiC, minutesAboveAlert: BigInt(minutesAboveAlert), exposureMinutes: exposure, digest });
      if ((maxCentiC > hardLimit || exposure > maxExposure) && !l.breachOpen) {
        this._openFlag(key, FR.Breach, digest);
        this._emit("ColdChainBreach", { lot: key, maxCentiC, exposureMinutes: exposure });
      }
    }
    _openFlag(key, reason, evidence) {
      const l = this.s.lots[key];
      const id = ++this.s.flagCount;
      this.s.flags[id] = {
        lot: key, raisedBy: this.sender, reason: BigInt(reason), evidence, raisedAt: this.time,
        open: true, clearanceRequested: false, clearanceEvidence: ZERO32, clearedBy: ZERO_ADDR,
      };
      l.openFlags += 1n;
      l.incidents += 1n;
      if (BigInt(reason) === FR.Breach) l.breachOpen = true;
      this._emit("FlagRaised", { flagId: id, lot: key, by: this.sender, reason: BigInt(reason), evidence });
      return id;
    }
    raiseFlag(code, reason, evidence) {
      this._live();
      if (!this._isMember(this.sender)) revert("NotAuthorised");
      const key = keyOf(code);
      this._lot(key);
      return this._openFlag(key, reason, evidence || ZERO32);
    }
    requestClearance(flagId, evidence) {
      this._live();
      const f = this.s.flags[BigInt(flagId)];
      if (!f || f.raisedAt === 0n) revert("UnknownFlag");
      if (!f.open) revert("FlagNotOpen");
      if (this.s.lots[f.lot].custodian !== this.sender) revert("NotCustodian");
      f.clearanceRequested = true;
      f.clearanceEvidence = evidence || ZERO32;
      this._emit("ClearanceRequested", { flagId: BigInt(flagId), by: this.sender, evidence: evidence || ZERO32 });
    }
    clearFlag(flagId, evidence) {
      this._live();
      if (!this.hasRole("AUTHORITY", this.sender) && !this.hasRole("AUDITOR", this.sender)) revert("NotAuthorised");
      const f = this.s.flags[BigInt(flagId)];
      if (!f || f.raisedAt === 0n) revert("UnknownFlag");
      if (!f.open) revert("FlagNotOpen");
      if (!f.clearanceRequested) revert("ClearanceNotRequested");
      const l = this.s.lots[f.lot];
      f.open = false;
      f.clearedBy = this.sender;
      l.openFlags -= 1n;
      l.resolved += 1n;
      if (f.reason === FR.Breach) {
        l.breachOpen = false;
        l.exposureMin = 0n;
      }
      this._emit("FlagCleared", { flagId: BigInt(flagId), lot: f.lot, by: this.sender, evidence: evidence || ZERO32 });
    }

    // ---- views -------------------------------------------------------
    offerCount() {
      return this.s.offerCount;
    }
    flagCount() {
      return this.s.flagCount;
    }
    suspended(a) {
      return !!this.s.suspended[lc(a)];
    }
    held(root, holder) {
      return this._held(root, holder);
    }
    allocationPerPeriod(sid, vessel) {
      return this.s.alloc[`${sid}|${lc(vessel)}`] || 0n;
    }
    usage(sid, vessel) {
      const u = this.s.usage[`${sid}|${lc(vessel)}`] || { windowStart: 0n, registered: 0n };
      return { windowStart: u.windowStart, registered: u.registered };
    }
    loggerLot(lk) {
      return this.s.loggerLot[lk] || ZERO32;
    }
    lotCount() {
      return BigInt(this.s.lotKeys.length);
    }
    lotKeyAt(i) {
      const k = this.s.lotKeys[Number(i)];
      if (k === undefined) revert("Panic");
      return k;
    }
    getLot(key) {
      return { ...this._lot(key) };
    }
    getOffer(id) {
      const o = this.s.offers[BigInt(id)];
      if (!o || o.status === OS.None) revert("UnknownOffer");
      return { ...o };
    }
    getFlag(id) {
      const f = this.s.flags[BigInt(id)];
      if (!f || f.raisedAt === 0n) revert("UnknownFlag");
      return { ...f };
    }
    childrenOf(key) {
      return [...(this.s.kids[key] || [])];
    }
    getFamily(root) {
      this._lot(root);
      return { ...this._family(root) };
    }
    verifyLot(code) {
      const l = this.s.lots[keyOf(code)];
      const v = {
        verdict: LV.Unknown, state: S.None, species: "", form: "", method: "", area: "", catchCode: "",
        caughtAt: 0n, landedAt: 0n, processedAt: 0n, bestBefore: 0n, incidents: 0n, resolved: 0n, openFlags: 0n, tagged: false,
      };
      if (!l || l.state === S.None) return v;
      const root = this.s.lots[l.root];
      v.state = l.state;
      v.species = l.species;
      v.form = l.form;
      v.method = l.method;
      v.area = l.area;
      v.catchCode = root.code;
      v.caughtAt = root.createdAt;
      v.landedAt = root.landedAt;
      v.processedAt = l.parent === ZERO32 ? 0n : l.createdAt;
      v.bestBefore = l.bestBefore;
      v.incidents = l.incidents;
      v.resolved = l.resolved;
      v.openFlags = l.openFlags;
      v.tagged = l.tagCommit !== ZERO32;
      if (l.recalled) v.verdict = LV.Recalled;
      else if (l.openFlags > 0n) v.verdict = LV.Quarantined;
      else if (l.bestBefore !== 0n && this.time >= l.bestBefore) v.verdict = LV.Expired;
      else v.verdict = LV.Found;
      return v;
    }
    verifyPack(code, secret) {
      const l = this.s.lots[keyOf(code)];
      if (!l || l.state === S.None || l.tagCommit === ZERO32) return TV.NoTag;
      return K.keccakHex(secret) === l.tagCommit ? TV.Match : TV.Mismatch;
    }
    reconcile(root, holders) {
      this._lot(root);
      const f = this._family(root);
      let total = 0n;
      for (const h of holders) total += this._held(root, h);
      const balanced = total + f.inTransit + f.sold + f.waste + f.lost + f.destroyed + f.unexplained === f.landed;
      return { landed: f.landed, held: total, inTransit: f.inTransit, sold: f.sold, waste: f.waste, lost: f.lost, destroyed: f.destroyed, unexplained: f.unexplained, balanced };
    }
    recallImpact(code) {
      const key = keyOf(code);
      if (!this.s.lots[key] || this.s.lots[key].state === S.None) revert("UnknownLot");
      const fam = this._descendants(key);
      let gramsOnHand = 0n;
      let gramsInTransit = 0n;
      for (const k of fam) {
        const l = this.s.lots[k];
        if (l.state === S.InTransit) gramsInTransit += l.weight;
        else gramsOnHand += l.weight;
      }
      return { lotsReached: BigInt(fam.length), gramsOnHand, gramsInTransit };
    }
  }

  ThonTraceModel.WRITES = [
    "grantRole", "revokeRole", "setAllocation", "suspendMember", "reinstateMember", "validateCertificate", "issueRecall",
    "registerCatch", "recordLanding", "recordTransformation", "storeLot", "proposeTransfer", "acceptTransfer", "declineTransfer",
    "withdrawTransfer", "expireTransfer", "setOnSale", "recordSale", "reportLoss", "assignLogger", "submitSummary",
    "raiseFlag", "requestClearance", "clearFlag",
  ];
  ThonTraceModel.READS = [
    "hasRole", "keyOf", "suspended", "held", "allocationPerPeriod", "usage", "loggerLot", "lotCount", "lotKeyAt", "getLot", "getOffer",
    "getFlag", "childrenOf", "getFamily", "verifyLot", "verifyPack", "reconcile", "recallImpact", "offerCount", "flagCount",
  ];

  return { ThonTraceModel, Revert, ZERO32, ZERO_ADDR, DAY, MODEL_START_TIME: START_TIME, MODEL_ROLE_NAMES: ROLE_NAMES, keyOf };
});
