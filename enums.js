/**
 * Enumerations and display wording shared by the model, the demo page, the live page and the tests.
 * The numeric values are the ones the Solidity contract uses. The words are the status words of Section 6.9
 * of the report; the contract's internal names stay out of sight of the people using the portal.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TT = Object.assign(root.TT || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const State = { None: 0, Registered: 1, Landed: 2, Processed: 3, Stored: 4, InTransit: 5, Received: 6, OnSale: 7, Sold: 8, Closed: 9 };
  const OfferStatus = { None: 0, Open: 1, Accepted: 2, Declined: 3, Withdrawn: 4, Expired: 5 };
  const FlagReason = { Breach: 0, DataGap: 1, Laboratory: 2, Security: 3, Damage: 4, Other: 5 };
  const LotVerdict = { Unknown: 0, Found: 1, Quarantined: 2, Recalled: 3, Expired: 4 };
  const TagVerdict = { NoTag: 0, Match: 1, Mismatch: 2 };

  const nameOf = (table) => (n) => Object.keys(table).find((k) => table[k] === Number(n)) || String(n);

  // Status words of Table 21 in the report. "Quarantined" and "Recalled" are the side states (flag, recall).
  const STATE_WORD = { 1: "Registered", 2: "Landed", 3: "Processed", 4: "Stored", 5: "In transit", 6: "Received", 7: "On sale", 8: "Sold", 9: "Closed" };
  const OFFER_WORD = { 1: "Open", 2: "Accepted", 3: "Declined", 4: "Withdrawn", 5: "Expired" };
  const FLAG_WORD = { 0: "Cold-chain breach", 1: "Missing temperature data", 2: "Laboratory result", 3: "Security concern", 4: "Damage", 5: "Other concern" };
  const VERDICT_WORD = { 0: "Not found", 1: "Lot found", 2: "On hold", 3: "Recalled", 4: "Past its date" };

  /** Roles in the order the portal shows them. */
  const ROLES = ["AUTHORITY", "VESSEL", "PROCESSOR", "CARRIER", "RETAILER", "AUDITOR", "GATEWAY"];
  const ROLE_WORD = {
    AUTHORITY: "Fisheries authority",
    VESSEL: "Fishing vessel",
    PROCESSOR: "Processor",
    CARRIER: "Carrier / cold store",
    RETAILER: "Retailer",
    AUDITOR: "Auditor",
    GATEWAY: "Logger gateway",
  };

  return {
    State, OfferStatus, FlagReason, LotVerdict, TagVerdict,
    stateName: nameOf(State), flagName: nameOf(FlagReason), offerName: nameOf(OfferStatus), verdictName: nameOf(LotVerdict),
    STATE_WORD, OFFER_WORD, FLAG_WORD, VERDICT_WORD, ROLES, ROLE_WORD,
  };
});
