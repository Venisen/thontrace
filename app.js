/**
 * ThonTrace portal (Section 6 of the report): role switcher, action panels, handovers, lot cards with weight bars,
 * activity toast, oversight console and the public lot check.
 *
 * The page contains no business rule of its own. Every button calls one contract function through an "adapter"
 * (web/adapter-demo.js runs the JavaScript model in the browser; web/adapter-live.js talks to a deployed
 * contract), and shows the answer in plain words. The only check repeated here is the mass-balance meter, so the
 * processor sees the outcome before submitting.
 */
(function () {
  "use strict";
  const TT = window.TT;
  const E = TT;
  const ZERO32 = "0x" + "00".repeat(32);
  const DAY = 86400n;
  const KGn = 1000n;

  // ---------------------------------------------------------------- plain-language messages (Table 22)
  const MESSAGES = {
    AccessControlUnauthorizedAccount: "This organisation does not have the role needed for this action.",
    NotAuthorised: "This organisation does not have the role needed for this action.",
    LotExists: "This lot code is already in use. Open the existing record instead.",
    LotBlocked: "This lot has an open flag. The holder asks for clearance, then the authority or the auditor clears it.",
    LotRecalled: "This lot has been recalled. It cannot be moved, received or sold.",
    LotExpired: "This lot is past its best-before date and cannot be used.",
    NotCustodian: "Only the organisation that holds this lot can do that.",
    NotOfferRecipient: "Only the organisation the offer is addressed to can accept or decline it.",
    NotOfferSender: "Only the organisation that made the offer can withdraw it.",
    OfferNotOpen: "This offer is no longer open.",
    OfferHasExpired: "This offer has timed out. Release it and the lot goes back to the sender.",
    OfferNotExpired: "This offer has not timed out yet.",
    NoAllocation: "The vessel has no allocation for this species. Ask the authority.",
    AllocationExceeded: "This haul would take the vessel over its allocation for this species and period.",
    Suspended: "This organisation is suspended by the authority. You can read your records but not change them.",
    MassBalanceOutOfTolerance: "Outputs plus waste are more than 5 % away from the input weight. Re-weigh, add a waste record, or call QA.",
    CertificateNotValidated: "The authority has not validated the catch certificate yet.",
    WrongState: "This lot is not in the right state for that step.",
    InvalidRecipient: "This organisation cannot receive the lot at this step.",
    InvalidInput: "Some of the details are missing or not valid.",
    InsufficientWeight: "There is not enough weight left in this lot.",
    UnknownLot: "No lot with that code is on the ledger.",
    UnknownOffer: "No such offer.",
    UnknownFlag: "No such flag.",
    UnknownLogger: "That logger is not attached to any lot yet.",
    ClearanceNotRequested: "The holder has not asked for clearance yet.",
    FlagNotOpen: "This flag is already closed.",
    FamilyTooLarge: "This catch has too many descendant lots to process in one step.",
  };

  // ---------------------------------------------------------------- tiny helpers
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lc = (a) => String(a || "").toLowerCase();
  const num = (x) => Number(x);
  const kg = (g) => `${(Number(g) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
  const date = (ts) => (ts && Number(ts) ? new Date(Number(ts) * 1000).toISOString().slice(0, 10) : "-");
  const dateTime = (ts) => (ts && Number(ts) ? new Date(Number(ts) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "-");
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
  const grams = (kgText) => BigInt(Math.round(Number(kgText) * 1000));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("thontrace:" + k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("thontrace:" + k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
  };
  async function fingerprint(textOrBytes) {
    const bytes = typeof textOrBytes === "string" ? new TextEncoder().encode(textOrBytes) : textOrBytes;
    if (window.crypto && crypto.subtle) {
      const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      return "sha256-" + Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    return "kec-" + TT.keccakText(typeof textOrBytes === "string" ? textOrBytes : "file").slice(2);
  }
  function randomSecret() {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    return "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  // ---------------------------------------------------------------- state
  let A = null; // adapter
  const S = {
    view: "portal", actor: "processor", data: null, toast: null, feed: [], busy: false,
    check: { code: "", secret: "", result: null }, confirmRecall: null, recallPreview: null, tags: store.get("tags", {}), loggers: store.get("loggers", {}),
  };
  const ROLE_OF = {}; // actor id -> role
  const byAddr = {};
  const orgOf = (addr) => (byAddr[lc(addr)] ? byAddr[lc(addr)].org : short(addr));
  const idOf = (addr) => (byAddr[lc(addr)] ? byAddr[lc(addr)].id : null);

  // ---------------------------------------------------------------- data
  async function snapshot() {
    const w = A.world;
    const d = {};
    d.now = await w.now();
    const nLots = Number(await w.view("lotCount"));
    const keys = await Promise.all([...Array(nLots)].map((_, i) => w.view("lotKeyAt", BigInt(i))));
    d.lots = await Promise.all(keys.map(async (k) => ({ key: k, ...(await w.view("getLot", k)) })));
    const nOff = Number(await w.view("offerCount"));
    d.offers = await Promise.all([...Array(nOff)].map(async (_, i) => ({ id: BigInt(i + 1), ...(await w.view("getOffer", BigInt(i + 1))) })));
    const nFl = Number(await w.view("flagCount"));
    d.flags = await Promise.all([...Array(nFl)].map(async (_, i) => ({ id: BigInt(i + 1), ...(await w.view("getFlag", BigInt(i + 1))) })));
    d.byKey = Object.fromEntries(d.lots.map((l) => [l.key, l]));
    d.roots = d.lots.filter((l) => l.parent === ZERO32);
    const holders = A.actors.filter((a) => ["VESSEL", "PROCESSOR", "CARRIER", "RETAILER"].includes(a.role));
    d.books = {};
    d.heldBy = {};
    await Promise.all(d.roots.filter((r) => num(r.state) !== E.State.Registered).map(async (r) => {
      d.books[r.key] = await w.view("reconcile", r.key, holders.map((h) => h.address));
      d.heldBy[r.key] = (await Promise.all(holders.map(async (h) => ({ actor: h, grams: BigInt(await w.view("held", r.key, h.address)) })))).filter((x) => x.grams > 0n);
    }));
    d.suspended = {};
    await Promise.all(A.actors.map(async (a) => { d.suspended[a.id] = await w.view("suspended", a.address); }));
    d.alloc = [];
    const species = [...new Set([...d.lots.filter((l) => l.parent === ZERO32).map((l) => l.species), "Yellowfin", "Bigeye", "Skipjack", "Albacore"])];
    for (const v of A.actors.filter((a) => a.role === "VESSEL")) {
      for (const sp of species) {
        const sid = w.keyOf(sp);
        const al = BigInt(await w.view("allocationPerPeriod", sid, v.address));
        if (al === 0n) continue;
        const u = await w.view("usage", sid, v.address);
        const live = d.now < BigInt(u.windowStart) + 30n * DAY;
        d.alloc.push({ vessel: v, species: sp, allocation: al, used: live ? BigInt(u.registered) : 0n, windowEnd: live ? BigInt(u.windowStart) + 30n * DAY : 0n });
      }
    }
    return d;
  }
  async function refresh() {
    S.data = await snapshot();
    if (A.afterRefresh) await A.afterRefresh();
    // learn logger ids that this browser has seen (the ledger stores only their hashes)
    const known = new Set(Object.keys(S.loggers));
    for (const id of [...Object.values((A.seed && A.seed.loggers) || {}), ...known]) {
      const lot = await A.world.view("loggerLot", A.world.keyOf(id));
      if (lot && lot !== ZERO32) S.loggers[id] = lot;
    }
    store.set("loggers", S.loggers);
  }

  // ---------------------------------------------------------------- doing things
  const lotLabel = (code) => esc(code);
  function describe(events) {
    const lines = [];
    for (const ev of events) {
      const a = ev.args;
      if (ev.name === "ColdChainBreach") lines.push({ kind: "bad", text: "Cold-chain breach: the lot is quarantined until the authority or the auditor clears it." });
      if (ev.name === "DataGap") lines.push({ kind: "warn", text: `Warning: ${a.gapMinutes} minutes without logger data, counted as exposure.` });
      if (ev.name === "LandingWeightWarning") lines.push({ kind: "warn", text: `Warning: scale weight ${kg(a.scaleGrams)} differs from the declared ${kg(a.declaredGrams)} by more than 5 %. The authority has been told.` });
      if (ev.name === "RecallIssued") lines.push({ kind: "bad", text: `Recall issued. ${a.lotsMarked} lot(s) marked, including everything made from the catch.` });
    }
    return lines;
  }
  function pushFeed(text, kind) {
    S.feed.unshift({ t: new Date(), text, kind: kind || "" });
    S.feed = S.feed.slice(0, 60);
  }
  let toastTimer = null;
  function toast(text, kind, detail) {
    S.toast = { text, kind: kind || "", detail: detail || "" };
    renderToast();
    clearTimeout(toastTimer);
    if (kind !== "wait") toastTimer = setTimeout(() => { S.toast = null; renderToast(); }, kind === "err" ? 9000 : 6000);
  }
  function errText(e) {
    const name = A.world.errorName ? A.world.errorName(e) : null;
    if (name && MESSAGES[name]) return MESSAGES[name];
    const msg = (e && (e.shortMessage || e.message)) || String(e);
    if (/insufficient funds/i.test(msg)) return "This demo wallet has run out of test ETH. Run scripts/topup-live.js and reload.";
    if (/user rejected|denied/i.test(msg)) return "The request was cancelled.";
    return name ? `The ledger refused that action (${name}).` : `Something went wrong: ${msg.slice(0, 160)}`;
  }
  async function act(label, fn, okText) {
    if (S.busy) return false;
    S.busy = true;
    toast(A.kind === "live" ? "Sent. Waiting for the network to confirm (about 15 seconds)…" : "Working…", "wait", label);
    try {
      const res = await fn();
      const extra = describe((res && res.events) || []);
      pushFeed(okText || label, "good");
      for (const x of extra) pushFeed(x.text, x.kind);
      await refresh();
      S.busy = false;
      toast(okText || label, "ok", extra.map((x) => x.text).join(" "));
      render();
      return res;
    } catch (e) {
      S.busy = false;
      const msg = errText(e);
      pushFeed(`${label}: ${msg}`, "bad");
      toast(msg, "err", label);
      renderToast();
      return false;
    }
  }
  const send = (fn, ...args) => A.world.send(S.actor, fn, ...args);

  // ---------------------------------------------------------------- view helpers
  const stateTag = (l) => {
    if (l.recalled) return `<span class="tag red">Recalled</span>`;
    if (num(l.openFlags) > 0) return `<span class="tag amber">Quarantined</span>`;
    const w = E.STATE_WORD[num(l.state)] || "?";
    const colour = { 4: "blue", 5: "amber", 6: "blue", 7: "green", 8: "green" }[num(l.state)] || "";
    return `<span class="tag ${colour}">${w}</span>`;
  };
  const offerTag = (o) => `<span class="tag ${{ 1: "blue", 2: "green", 3: "red", 4: "", 5: "amber" }[num(o.status)] || ""}">${E.OFFER_WORD[num(o.status)]}</span>`;
  const mine = (l) => lc(l.custodian) === lc(A.me().address);
  const lotsIn = (pred) => S.data.lots.filter(pred);
  const rootOf = (l) => S.data.byKey[l.root];
  const fam = (root) => S.data.lots.filter((l) => l.root === root.key && l.key !== root.key);
  function inputRow(label, name, type, attrs) {
    return `<label class="f">${label}<input name="${name}" type="${type || "text"}" ${attrs || ""}></label>`;
  }
  function select(label, name, options, selected) {
    return `<label class="f">${label}<select name="${name}">${options.map((o) => `<option value="${esc(o.value)}" ${o.value === selected ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`;
  }
  const lotOptions = (lots) => lots.map((l) => ({ value: l.code, label: `${l.code}${l.form ? " · " + l.form : ""} · ${kg(l.weight && num(l.weight) ? l.weight : l.declared)}` }));

  // ---------------------------------------------------------------- panels per role
  function certSection() {
    const waiting = lotsIn((l) => l.parent === ZERO32 && l.state === BigInt(E.State.Registered) && !l.certValidated);
    return `<section class="card"><header><h2>Certificates to validate</h2><span class="hint">Landing is blocked until a certificate is validated</span></header>
      ${waiting.length ? `<div class="list">${waiting.map((l) => `<div class="item"><div class="head"><b>${lotLabel(l.code)}</b><span class="sub">${esc(l.species)} · ${kg(l.declared)} declared · ${esc(orgOf(l.custodian))}</span></div>
        <div class="sub">${esc(l.method)} · ${esc(l.area)} · certificate <code>${esc(String(l.docsCid).slice(0, 22))}…</code></div>
        <div class="btns"><button class="btn small" data-act="validate" data-lot="${esc(l.code)}">Validate certificate</button></div></div>`).join("")}</div>` : `<div class="empty">No certificates waiting.</div>`}</section>`;
  }

  function flagSectionHtml() {
    const open = S.data.flags.filter((f) => f.open);
    const closed = S.data.flags.length - open.length;
    const role = ROLE_OF[S.actor];
    const canClear = role === "AUTHORITY" || role === "AUDITOR";
    return `<section class="card"><header><h2>Flags</h2><span class="hint">${open.length} open · ${closed} cleared</span></header>
      ${open.length ? `<div class="list">${open.map((f) => {
        const l = S.data.byKey[f.lot];
        const isHolder = mine(l);
        const clearBox = canClear && f.clearanceRequested ? `<form data-act="clear" data-flag="${f.id}" class="row">${inputRow("Note for the record", "note", "text", 'placeholder="e.g. lab result 8 ppm, re-chilled"')}<div class="btns" style="align-items:end"><button class="btn ok small">Clear flag</button></div></form>` : "";
        const reqBox = isHolder && !f.clearanceRequested ? `<form data-act="requestClearance" data-flag="${f.id}" class="row">${inputRow("Corrective evidence (note)", "note", "text", 'placeholder="e.g. laboratory result, inspection"')}<div class="btns" style="align-items:end"><button class="btn small">Request clearance</button></div></form>` : "";
        return `<div class="item"><div class="head"><b>${lotLabel(l.code)}</b><span class="tag amber">${E.FLAG_WORD[num(f.reason)]}</span></div>
          <div class="sub">Raised ${dateTime(f.raisedAt)} by ${esc(orgOf(f.raisedBy))} · held by ${esc(orgOf(l.custodian))}</div>
          <div class="note ${f.clearanceRequested ? "good" : "warn"}">${f.clearanceRequested ? "The holder has asked for clearance. The authority or the auditor can clear it." : "Waiting for the holder to request clearance."}</div>
          ${reqBox}${clearBox}</div>`;
      }).join("")}</div>` : `<div class="empty">No open flags.</div>`}</section>`;
  }

  function allocationTable() {
    const rows = S.data.alloc;
    if (!rows.length) return `<div class="empty">No allocations set yet.</div>`;
    return `<table class="t"><thead><tr><th>Vessel</th><th>Species</th><th>Used this period</th><th></th></tr></thead><tbody>${rows.map((r) => {
      const pct = Math.min(100, Number((r.used * 100n) / r.allocation));
      return `<tr><td>${esc(r.vessel.org)}</td><td>${esc(r.species)}</td><td>${kg(r.used)} of ${kg(r.allocation)}<div class="bar" style="margin-top:4px"><i class="c-held" style="width:${pct}%;background:var(--accent)"></i></div></td><td class="note">${r.windowEnd ? "until " + date(r.windowEnd) : ""}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  function authorityPanel() {
    const vessels = A.actors.filter((a) => a.role === "VESSEL");
    const all = S.data.lots.filter((l) => l.parent === ZERO32).concat(S.data.lots.filter((l) => l.parent !== ZERO32));
    const reasons = ["Laboratory result above the limit", "Cold-chain failure", "Fraud or mislabelling", "Illegal, unreported or unregulated catch", "Other"];
    const prev = S.recallPreview;
    return `${certSection()}
      <section class="card"><header><h2>Catch allocation</h2><span class="hint">Per vessel and species, for each 30-day period</span></header>
        <form class="form" data-act="allocate"><div class="row">${select("Vessel", "vessel", vessels.map((v) => ({ value: v.id, label: v.org })))}
          ${inputRow("Species", "species", "text", 'list="species" value="Skipjack" required')}${inputRow("Allocation (kg per 30 days)", "kg", "number", 'min="1" step="1" value="15000" required')}</div>
          <div class="btns"><button class="btn">Set allocation</button></div></form>
        <div style="margin-top:12px">${allocationTable()}</div></section>
      <section class="card"><header><h2>Recall</h2><span class="hint">Reaches the lot and everything made from it</span></header>
        <form class="form" data-act="recall"><div class="row">${select("Lot", "lot", lotOptions(all.map((l) => ({ ...l, weight: l.weight }))), S.recallLot)}
          ${select("Reason", "reason", reasons.map((r) => ({ value: r, label: r })))}</div>
          ${inputRow("Note (optional)", "note", "text", 'placeholder="e.g. retained sample ref. 2291"')}
          <div id="recallImpact" class="note">${prev ? prev : "Choose a lot to see what a recall would reach."}</div>
          <div class="btns"><button class="btn danger" ${S.confirmRecall ? "" : ""}>${S.confirmRecall ? `Confirm: recall ${esc(S.confirmRecall)}` : "Issue recall"}</button>${S.confirmRecall ? `<button type="button" class="btn ghost" data-act="cancelRecall">Cancel</button>` : ""}</div></form></section>
      <section class="card"><header><h2>Members</h2><span class="hint">A suspended member can read but not write</span></header>
        <form class="form" data-act="suspend"><div class="row">${select("Organisation", "who", A.actors.filter((a) => a.id !== "authority").map((a) => ({ value: a.id, label: `${a.org}${S.data.suspended[a.id] ? " (suspended)" : ""}` })))}
          ${inputRow("Reason", "reason", "text", 'value="Licence under review"')}</div>
          <div class="btns"><button class="btn ghost" name="mode" value="suspend">Suspend</button><button class="btn ghost" name="mode" value="reinstate">Reinstate</button></div></form></section>`;
  }

  function auditorPanel() {
    return `${certSection()}<section class="card"><header><h2>Oversight</h2></header><div class="note">As auditor you can validate certificates and clear flags (with the authority). Open the Console for the whole network.</div></section>`;
  }

  function vesselPanel() {
    const al = S.data.alloc.filter((r) => lc(r.vessel.address) === lc(A.me().address));
    const species = ["Yellowfin", "Bigeye", "Skipjack", "Albacore"];
    const myList = S.data.roots.filter((l) => l.parent === ZERO32);
    return `<section class="card"><header><h2>Log a haul</h2><span class="hint">Registers a catch lot against your allocation</span></header>
      <form class="form" data-act="registerCatch">
        <div class="row">${inputRow("Catch lot code", "code", "text", `value="CL-MV-${String(num(S.data.roots.length) + 413).padStart(4, "0")}-${"ABCDEFGH"[S.data.roots.length % 8]}1" required`)}
          ${select("Species", "species", species.map((s) => ({ value: s, label: s })))}
          ${inputRow("Estimated weight (kg)", "kg", "number", 'min="1" step="1" value="800" required')}</div>
        <div class="row">${select("Gear", "method", ["Purse seine", "Longline", "Pole and line", "Handline"].map((s) => ({ value: s, label: s })))}
          ${inputRow("Area", "area", "text", 'value="FAO 51, Western Indian Ocean"')}
          <label class="f">Catch certificate (file, optional)<input name="file" type="file"></label></div>
        <label class="check"><input type="checkbox" name="frozen"> Frozen at sea (uses the frozen cold-chain limits)</label>
        <div class="btns"><button class="btn">Sign and send</button></div>
        <div class="note">The certificate itself stays with you. Only its fingerprint goes on the ledger, so any later change to the file shows up.</div>
      </form></section>
      <section class="card"><header><h2>Your allocation</h2></header>${al.length ? `<table class="t"><tbody>${al.map((r) => `<tr><td>${esc(r.species)}</td><td>${kg(r.used)} of ${kg(r.allocation)} used</td><td class="note">${r.windowEnd ? "until " + date(r.windowEnd) : "new period"}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No allocation yet. Ask the authority.</div>`}</section>
      <section class="card"><header><h2>Catch lots</h2></header>${myList.length ? `<div class="list">${myList.map((l) => `<div class="item"><div class="head"><b>${lotLabel(l.code)}</b>${stateTag(l)}</div><div class="sub">${esc(l.species)} · ${kg(l.declared)} declared${l.certValidated ? " · certificate validated" : " · waiting for the authority to validate the certificate"}</div></div>`).join("")}</div>` : `<div class="empty">No catches yet.</div>`}</section>`;
  }

  function landingSection() {
    const regs = lotsIn((l) => l.parent === ZERO32 && l.state === BigInt(E.State.Registered));
    return `<section class="card"><header><h2>Landings</h2><span class="hint">Weigh the catch on arrival</span></header>
      ${regs.length ? `<div class="list">${regs.map((l) => l.certValidated
        ? `<form class="item" data-act="land" data-lot="${esc(l.code)}" data-declared="${l.declared}"><div class="head"><b>${lotLabel(l.code)}</b><span class="sub">${esc(l.species)} · declared ${kg(l.declared)}</span></div>
            <div class="row">${inputRow("Scale reading (kg)", "kg", "number", `min="1" step="0.1" value="${Number(l.declared) / 1000}" required`)}<div class="btns" style="align-items:end"><button class="btn small">Record landing</button></div></div>
            <div class="note" data-live="landing" data-declared="${l.declared}"></div></form>`
        : `<div class="item"><div class="head"><b>${lotLabel(l.code)}</b><span class="tag amber">Waiting</span></div><div class="sub">The authority has not validated the catch certificate yet.</div></div>`).join("")}</div>` : `<div class="empty">No catches waiting to land.</div>`}</section>`;
  }

  function processSection() {
    const landed = lotsIn((l) => l.state === BigInt(E.State.Landed) && mine(l));
    if (!landed.length) return `<section class="card"><header><h2>Process a lot</h2></header><div class="empty">No landed lots in your custody. Record a landing first.</div></section>`;
    const first = landed[0];
    const rowHtml = (i) => `<div class="row" style="grid-template-columns: minmax(150px,1.6fr) minmax(110px,1.1fr) minmax(70px,.7fr) minmax(70px,.7fr) auto auto; align-items:end">
      ${inputRow(i === 0 ? "Output lot code" : "", `code${i}`, "text", `value="${esc(first.code.replace(/^CL-/, "LOT-"))}-${"ABCD"[i]}" ${i === 0 ? "required" : ""}`)}
      ${select(i === 0 ? "Product" : "", `form${i}`, ["Loins", "Steaks", "Fillets", "Saku blocks", "Belly, frozen", "Trim"].map((s, k) => ({ value: s, label: s })), ["Loins", "Steaks", "Fillets", "Saku blocks"][i])}
      ${inputRow(i === 0 ? "Weight (kg)" : "", `kg${i}`, "number", `min="0" step="0.1" ${i < 2 ? `value="${i === 0 ? 400 : 250}"` : ""}`)}
      ${inputRow(i === 0 ? "Shelf life (days)" : "", `days${i}`, "number", 'min="1" step="1" value="10"')}
      <label class="check" title="Frozen product uses the frozen limits"><input type="checkbox" name="frozen${i}"> Frozen</label>
      <label class="check" title="Issue a tag for the pack"><input type="checkbox" name="tag${i}" checked> Tag</label></div>`;
    return `<section class="card"><header><h2>Process a lot</h2><span class="hint">Outputs plus waste must be within 5 % of the input</span></header>
      <form class="form" data-act="transform" id="fTransform">
        ${select("Input lot", "lot", landed.map((l) => ({ value: l.code, label: `${l.code} · ${kg(l.weight)} landed` })), first.code).replace("<select", `<select data-weights='${JSON.stringify(Object.fromEntries(landed.map((l) => [l.code, Number(l.weight)])))}'`)}
        ${[0, 1, 2, 3].map(rowHtml).join("")}
        ${inputRow("Waste (kg)", "waste", "number", 'min="0" step="0.1" value="120"')}
        <div class="mass" data-live="mass"><div class="meter"><i></i><u style="left:86.4%"></u><u style="left:95.5%"></u></div><div class="note" data-role="massText"></div></div>
        <div class="btns"><button class="btn" data-role="massSubmit">Submit</button></div>
      </form></section>`;
  }

  function myLotsSection(title) {
    const role = ROLE_OF[S.actor];
    const lots = lotsIn((l) => mine(l) && num(l.weight) > 0 && l.parent !== undefined && l.state !== BigInt(E.State.Landed) && l.state !== BigInt(E.State.Registered) && l.state !== BigInt(E.State.InTransit));
    const recipients = A.actors.filter((a) => {
      if (role === "PROCESSOR") return ["CARRIER", "RETAILER", "PROCESSOR"].includes(a.role) && a.id !== S.actor;
      if (role === "CARRIER") return ["CARRIER", "RETAILER"].includes(a.role) && a.id !== S.actor;
      return false;
    });
    const html = lots.map((l) => {
      const st = num(l.state);
      const blocked = l.recalled || num(l.openFlags) > 0;
      const parts = [];
      if ((st === E.State.Processed || st === E.State.Received) && !blocked) {
        parts.push(`<form class="row" data-act="shelve" data-lot="${esc(l.code)}">${inputRow("Cold room", "room", "text", `value="${role === "CARRIER" ? "Truck RT-4471" : role === "RETAILER" ? "Counter chiller" : "CR-2"}" required`)}<div class="btns" style="align-items:end"><button class="btn small">Shelve</button></div></form>`);
      }
      if (st === E.State.Stored && !blocked && recipients.length) {
        parts.push(`<form class="row" data-act="offer" data-lot="${esc(l.code)}">${select("Hand over to", "to", recipients.map((r) => ({ value: r.id, label: r.org })))}${inputRow("Offer open for (days)", "days", "number", 'min="1" max="7" step="1" value="3"')}<div class="btns" style="align-items:end"><button class="btn small">Offer lot</button></div></form>`);
      }
      if ((st === E.State.Received || st === E.State.Stored) && role === "RETAILER" && !blocked) {
        parts.push(`<div class="btns"><button class="btn small ok" data-act="onSale" data-lot="${esc(l.code)}">Put on sale</button></div>`);
      }
      if (st === E.State.OnSale && !blocked) {
        parts.push(`<form class="row" data-act="sale" data-lot="${esc(l.code)}">${inputRow("Sold (kg)", "kg", "number", `min="0.1" max="${Number(l.weight) / 1000}" step="0.1" value="5" required`)}<div class="btns" style="align-items:end"><button class="btn small ok">Record sale</button></div></form>`);
      }
      if ((st === E.State.Stored || st === E.State.Processed || st === E.State.Received) && ["PROCESSOR", "CARRIER"].includes(role)) {
        parts.push(`<form class="row" data-act="logger" data-lot="${esc(l.code)}">${inputRow("Attach logger (id)", "id", "text", `placeholder="e.g. LOG-${l.code.slice(-5)}" required`)}<div class="btns" style="align-items:end"><button class="btn small ghost">Attach</button></div></form>`);
      }
      parts.push(`<details><summary class="note" style="cursor:pointer">Report a problem or a loss</summary>
        <form class="form" data-act="loss" data-lot="${esc(l.code)}" style="margin-top:8px"><div class="row">${inputRow("Weight (kg)", "kg", "number", `min="0.1" max="${Number(l.weight) / 1000}" step="0.1" required`)}${inputRow("Reason", "reason", "text", 'value="Spoiled in transit" required')}</div>
        <label class="check"><input type="checkbox" name="destroyed"> Destroyed under witness (otherwise recorded as lost)</label>
        <div class="btns"><button class="btn small danger">Record loss</button></div></form>
        <form class="row" data-act="raise" data-lot="${esc(l.code)}" style="margin-top:8px">${select("Raise a flag", "reason", [[2, "Laboratory result"], [3, "Security concern"], [4, "Damage"], [5, "Other concern"], [0, "Cold-chain breach"]].map(([v, t]) => ({ value: String(v), label: t })))}<div class="btns" style="align-items:end"><button class="btn small ghost">Raise flag</button></div></form></details>`);
      return `<div class="item"><div class="head"><b>${lotLabel(l.code)}</b>${stateTag(l)}</div>
        <div class="sub">${esc(l.species)}${l.form ? " · " + esc(l.form) : ""} · ${kg(l.weight)}${l.coldRoom ? " · " + esc(l.coldRoom) : ""}${l.bestBefore && num(l.bestBefore) ? " · best before " + date(l.bestBefore) : ""}</div>
        ${blocked ? `<div class="banner-in ${l.recalled ? "" : "amber"}">${l.recalled ? "Recalled. This lot cannot be moved, received or sold." : "Quarantined: open flag. Request clearance in the Flags panel."}</div>` : ""}
        ${parts.join("")}</div>`;
    });
    return `<section class="card"><header><h2>${title}</h2><span class="hint">Lots in your custody</span></header>${html.length ? `<div class="list">${html.join("")}</div>` : `<div class="empty">Nothing in your custody yet. Accept an offer in the Handovers panel.</div>`}</section>`;
  }

  function gatewayPanel() {
    const loggers = Object.entries(S.loggers).filter(([id, lot]) => S.data.byKey[lot]);
    return `<section class="card"><header><h2>Logger readings</h2><span class="hint">Each logger summarises a window of readings</span></header>
      ${loggers.length ? `<form class="form" data-act="reading"><div class="row">${select("Logger", "id", loggers.map(([id, lot]) => ({ value: id, label: `${id} → ${S.data.byKey[lot].code}` })))}
        ${inputRow("Warmest reading (°C)", "c", "number", 'step="0.1" value="1.5" required')}${inputRow("Minutes above the alert threshold", "m", "number", 'min="0" step="1" value="0"')}${inputRow("Minutes with no data", "g", "number", 'min="0" step="1" value="0"')}</div>
        <div class="btns"><button class="btn">Send reading</button><button type="button" class="btn ghost" data-act="preset" data-c="6.5" data-m="45" data-g="0">Fill: warm spell</button><button type="button" class="btn ghost" data-act="preset" data-c="1.5" data-m="10" data-g="50">Fill: signal gap</button></div>
        <div class="note">Chilled limits: alert 2 °C, hard limit 4 °C, 60 minutes above alert in total, gaps over 30 minutes count as exposure. Frozen: hard limit −15 °C, 120 minutes, gaps over 60 minutes.</div></form>`
      : `<div class="empty">No loggers are attached yet. The processor or carrier attaches one to a lot.</div>`}</section>`;
  }

  function actionPanel() {
    const role = ROLE_OF[S.actor];
    switch (role) {
      case "AUTHORITY": return authorityPanel();
      case "AUDITOR": return auditorPanel();
      case "VESSEL": return vesselPanel();
      case "PROCESSOR": return landingSection() + processSection() + myLotsSection("Cold room and handover");
      case "CARRIER": return myLotsSection("Cold store and handover");
      case "RETAILER": return myLotsSection("Shelf and till");
      case "GATEWAY": return gatewayPanel();
      default: return "";
    }
  }

  // ---------------------------------------------------------------- shared panels
  function handoversPanel() {
    const me = lc(A.me().address);
    const offers = [...S.data.offers].reverse();
    const rows = offers.map((o) => {
      const l = S.data.byKey[o.lot];
      const open = num(o.status) === E.OfferStatus.Open;
      const expired = open && (S.data.now > BigInt(o.expiresAt) || S.data.suspended[idOf(o.to)]);
      const btns = [];
      if (open && lc(o.to) === me && !expired) {
        btns.push(`<button class="btn small ok" data-act="accept" data-offer="${o.id}">Accept</button>`);
        btns.push(`<form data-act="decline" data-offer="${o.id}" class="btns" style="align-items:center">${`<select name="reason" aria-label="Reason for declining"><option>Pack damaged on arrival</option><option>Not what was ordered</option><option>Temperature too high</option><option>Documents do not match</option></select>`}<button class="btn small danger">Decline</button></form>`);
      }
      if (open && lc(o.from) === me) btns.push(`<button class="btn small ghost" data-act="withdraw" data-offer="${o.id}">Withdraw</button>`);
      if (expired) btns.push(`<button class="btn small ghost" data-act="release" data-offer="${o.id}">Release back to sender</button>`);
      return `<div class="item"><div class="head"><b>${lotLabel(l.code)} <span class="sub">${l.form ? esc(l.form) + " · " : ""}${kg(o.grams)}</span></b>${expired ? `<span class="tag amber">Timed out</span>` : offerTag(o)}</div>
        <div class="sub">${esc(orgOf(o.from))} → ${esc(orgOf(o.to))} · ${open ? "open until " + dateTime(o.expiresAt) : "closed"}</div>${btns.length ? `<div class="btns">${btns.join("")}</div>` : ""}</div>`;
    });
    return `<section class="card"><header><h2>Handovers</h2><span class="hint">${offers.filter((o) => num(o.status) === 1).length} open</span></header>${rows.length ? `<div class="list">${rows.join("")}</div>` : `<div class="empty">No handovers yet.</div>`}</section>`;
  }

  function weightBar(root) {
    const b = S.data.books[root.key];
    if (!b) return `<div class="note">Not landed yet. Declared ${kg(root.declared)}.</div>`;
    const landed = Number(b.landed) || 1;
    const segs = [];
    const classes = ["c-held", "c-held2", "c-held3", "c-held"];
    (S.data.heldBy[root.key] || []).forEach((h, i) => segs.push({ cls: classes[i % 4], label: `Held by ${h.actor.org.split(" (")[0]}`, g: Number(h.grams) }));
    segs.push({ cls: "c-transit", label: "In transit", g: Number(b.inTransit) }, { cls: "c-sold", label: "Sold", g: Number(b.sold) }, { cls: "c-waste", label: "Waste", g: Number(b.waste) },
      { cls: "c-lost", label: "Lost or destroyed", g: Number(b.lost) + Number(b.destroyed) }, { cls: "c-unexp", label: "Unexplained", g: Number(b.unexplained) });
    const shown = segs.filter((s) => s.g !== 0);
    return `<div class="bar" role="img" aria-label="Weight accounting">${shown.map((s) => `<i class="${s.cls}" style="width:${Math.max(0, (s.g / landed) * 100)}%;background:var(--c)" title="${esc(s.label)} ${kg(s.g)}"></i>`).join("")}</div>
      <div class="legend">${shown.map((s) => `<span class="${s.cls}">${esc(s.label)} ${kg(s.g)}</span>`).join("")}</div>
      <div class="balance ${b.balanced ? "" : "bad"}">${b.balanced ? `<b>Weight accounted for.</b> Landed ${kg(b.landed)} equals the parts above.` : `<b style="color:var(--red)">Warning: the parts do not add up to the landed weight.</b>`}</div>`;
  }

  function lotCards(opts) {
    const roots = [...S.data.roots].reverse();
    if (!roots.length) return `<section class="card"><header><h2>Lots</h2></header><div class="empty">No lots yet.</div></section>`;
    return roots.map((r) => {
      const kids = fam(r);
      return `<section class="card lotcard"><header><h2>${lotLabel(r.code)}</h2>${stateTag(r)}</header>
        <div class="sub">${esc(r.species)} · ${esc(r.method)} · ${esc(r.area)}</div>
        <div style="margin-top:8px">${weightBar(r)}</div>
        ${r.recalled ? `<div class="banner-in">Recalled. Blocked everywhere in the chain; the weight bars show where the product sits.</div>` : ""}
        <div class="kids">${kids.map((k) => `<div class="kid"><div><code>${esc(k.code)}</code> · ${esc(k.form)} · ${kg(k.weight)}${num(k.declared) !== num(k.weight) ? ` <span class="note">of ${kg(k.declared)}</span>` : ""}</div><div>${stateTag(k)}</div>
          <div class="meta">${esc(orgOf(k.custodian))}${k.coldRoom ? " · " + esc(k.coldRoom) : ""}${k.frozen ? " · frozen" : ""}${k.tagCommit !== ZERO32 ? " · tagged" : ""}${k.bestBefore && num(k.bestBefore) ? " · best before " + date(k.bestBefore) : ""}</div></div>`).join("")}</div></section>`;
    }).join("");
  }

  function feedPanel() {
    return `<section class="card"><header><h2>Activity</h2><span class="hint">This session</span></header>${S.feed.length ? `<div class="feed">${S.feed.map((f) => `<div class="${f.kind}"><time>${f.t.toTimeString().slice(0, 8)}</time>${esc(f.text)}</div>`).join("")}</div>` : `<div class="empty">Nothing yet. Actions you take appear here.</div>`}</section>`;
  }

  // ---------------------------------------------------------------- console
  function consoleView() {
    const d = S.data;
    const openFlags = d.flags.filter((f) => f.open).length;
    const openOffers = d.offers.filter((o) => num(o.status) === 1);
    const late = openOffers.filter((o) => d.now > BigInt(o.expiresAt)).length;
    const recalled = d.lots.filter((l) => l.recalled).length;
    const unbalanced = Object.values(d.books).filter((b) => !b.balanced).length;
    const suspended = Object.values(d.suspended).filter(Boolean).length;
    const waiting = d.lots.filter((l) => l.parent === ZERO32 && !l.certValidated).length;
    const stat = (n, label, cls) => `<div class="stat ${n && cls ? cls : ""}"><b>${n}</b><span>${label}</span></div>`;
    return `<div class="stack">
      <section class="card"><header><h2>Needs action now</h2></header><div class="stats">${stat(openFlags, "Open flags", "bad")}${stat(late, "Offers timed out", "warn")}${stat(waiting, "Certificates waiting", "warn")}${stat(unbalanced, "Catches where the books do not balance", "bad")}${stat(recalled, "Recalled lots", "bad")}${stat(suspended, "Suspended members", "warn")}</div></section>
      <div class="cols"><div class="stack">${flagSectionHtml()}${handoversPanel()}</div><div class="stack">${lotCards()}${feedPanel()}</div></div>
      <section class="card"><header><h2>All lots</h2><span class="hint">${d.lots.length} on the ledger</span></header>
        <div style="overflow:auto"><table class="t"><thead><tr><th>Code</th><th>Product</th><th>Status</th><th>Weight</th><th>Holder</th><th>Catch</th></tr></thead><tbody>${d.lots.map((l) => `<tr><td><code>${esc(l.code)}</code></td><td>${esc(l.form || l.species)}</td><td>${stateTag(l)}</td><td>${kg(l.weight)}</td><td>${esc(orgOf(l.custodian))}</td><td><code>${esc(d.byKey[l.root].code)}</code></td></tr>`).join("")}</tbody></table></div></section>
      <section class="card"><header><h2>Members</h2></header><div style="overflow:auto"><table class="t"><thead><tr><th>Organisation</th><th>Role</th><th>Address</th><th>Status</th></tr></thead><tbody>${A.actors.map((a) => `<tr><td>${esc(a.org)}</td><td>${esc(E.ROLE_WORD[a.role])}</td><td><code>${short(a.address)}</code></td><td>${d.suspended[a.id] ? `<span class="tag red">Suspended</span>` : `<span class="tag green">Active</span>`}</td></tr>`).join("")}</tbody></table></div></section></div>`;
  }

  // ---------------------------------------------------------------- public lot check
  async function runCheck() {
    const code = S.check.code.trim();
    if (!code) { S.check.result = null; return render(); }
    const w = A.world;
    const v = await w.view("verifyLot", code);
    let tag = null;
    if (S.check.secret.trim()) {
      try { tag = num(await w.view("verifyPack", code, S.check.secret.trim())); } catch (_) { tag = E.TagVerdict.Mismatch; } // not even a valid tag code
    }
    S.check.result = { code, v, tag };
    render();
  }
  function verdictCard(r) {
    const { v, tag } = r;
    const verdict = num(v.verdict);
    let cls = "blue", head = "Lot found", icon = "◎", lines = [];
    if (verdict === E.LotVerdict.Unknown) {
      cls = "grey"; head = "Not found"; icon = "?";
      lines = ["No lot with this code is on the ledger.", "Check the code printed on the pack. If it is right, return the pack to the shop and tell the authority."];
    } else if (tag === E.TagVerdict.Mismatch) {
      cls = "red"; head = "Not authentic"; icon = "✕";
      lines = ["The tag on this pack does not match the lot it claims to be.", "Do not eat it. Return the pack to the shop and tell the fisheries authority."];
    } else if (verdict === E.LotVerdict.Recalled) {
      cls = "red"; head = "Recalled"; icon = "✕";
      lines = ["This lot has been recalled by the fisheries authority.", "Do not eat it. Return the pack to the shop."];
    } else if (verdict === E.LotVerdict.Quarantined) {
      cls = "amber"; head = "On hold"; icon = "!";
      lines = ["This lot is on hold while a cold-chain or quality concern is checked.", "Ask the shop before you buy or eat it."];
    } else if (verdict === E.LotVerdict.Expired) {
      cls = "amber"; head = "Past its date"; icon = "!";
      lines = ["This lot is past its best-before date.", "Ask the shop; do not rely on this pack."];
    } else if (tag === E.TagVerdict.Match) {
      cls = "green"; head = "Verified authentic"; icon = "✓";
      lines = ["The tag on this pack matches the lot recorded on the ledger.", "This confirms the pack's origin and records. It is not a statement that the fish is safe to eat."];
    } else {
      cls = "blue"; head = "Lot found"; icon = "◎";
      lines = v.tagged ? ["This lot is on the ledger. Tap the pack's tag, or enter its tag code, to confirm that this pack is genuine."] : ["This lot is on the ledger. This pack has no tag, so only the code was checked."];
    }
    const found = verdict !== E.LotVerdict.Unknown;
    const coldLine = !found ? "" : num(v.openFlags) > 0 ? `${num(v.openFlags)} open cold-chain or quality concern(s)` : num(v.incidents) === 0 ? "No incidents recorded" : `${num(v.incidents)} incident(s) recorded, all resolved`;
    return `<section class="verdict ${cls}" aria-live="polite"><div class="headline"><span aria-hidden="true">${icon}</span>${head}</div>${lines.map((l) => `<div>${esc(l)}</div>`).join("")}
      ${found ? `<dl class="facts"><div><dt>Species</dt><dd>${esc(v.species)}</dd></div><div><dt>Product</dt><dd>${esc(v.form || "Whole catch")}</dd></div><div><dt>Method</dt><dd>${esc(v.method)}</dd></div><div><dt>Catch area</dt><dd>${esc(v.area)}</dd></div><div><dt>Cold chain</dt><dd>${esc(coldLine)}</dd></div><div><dt>Status</dt><dd>${E.STATE_WORD[num(v.state)] || ""}</dd></div></dl>` : ""}</section>
      ${found ? `<section class="card"><header><h2>Journey</h2><span class="hint">From the ledger</span></header><ol class="journey">
        <li>Caught<small>Catch lot ${esc(v.catchCode)} · registered ${dateTime(v.caughtAt)}</small></li>
        <li>Landed and weighed<small>${num(v.landedAt) ? dateTime(v.landedAt) : "Not recorded yet"}</small></li>
        <li>Processed<small>${num(v.processedAt) ? dateTime(v.processedAt) : "This is the catch lot itself"}</small></li>
        <li>Best before<small>${num(v.bestBefore) ? date(v.bestBefore) : "Not set"}</small></li></ol>
        <div class="note">Independent proof (a daily fingerprint of the ledger on a public network) is part of the report's design and is not built in this prototype.</div></section>` : ""}`;
  }
  function checkView() {
    const packs = A.packs || [];
    const first = packs[0];
    const chips = [];
    packs.forEach((p) => chips.push(`<button class="chip" data-act="sample" data-code="${esc(p.lot)}" data-secret="${esc(p.secret)}">Pack ${esc(p.lot)} (tag tapped)</button>`));
    if (first) {
      chips.push(`<button class="chip" data-act="sample" data-code="${esc(first.lot)}" data-secret="">${esc(first.lot)} (QR code only)</button>`);
      chips.push(`<button class="chip" data-act="sample" data-code="${esc(first.lot)}" data-secret="${A.world.hash("a copied tag")}">${esc(first.lot)} (copied tag)</button>`);
    }
    chips.push(`<button class="chip" data-act="sample" data-code="LOT-0000-X" data-secret="">A made-up code</button>`);
    return `<div class="check"><section class="card"><header><h2>Check a lot</h2><span class="hint">No account needed</span></header>
      <form class="form" data-act="check"><div class="big"><input name="code" value="${esc(S.check.code)}" placeholder="Lot code printed on the pack" aria-label="Lot code" autocomplete="off"><button class="btn">Check</button></div>
      <label class="f">Tag code (read from the pack's NFC tag, optional)<input name="secret" value="${esc(S.check.secret)}" placeholder="0x…" autocomplete="off"></label>
      <div class="chips"><span class="note">Test samples:</span>${chips.join("")}</div></form></section>
      ${S.check.result ? verdictCard(S.check.result) : `<div class="empty" style="text-align:center">Enter the code from a pack, or pick a test sample.</div>`}</div>`;
  }

  // ---------------------------------------------------------------- shell and render
  function shell() {
    const live = A.kind === "live";
    const d = S.data;
    return `<header class="top"><div class="wrap"><div class="brand"><b>ThonTrace</b><span>Tuna cold-chain ledger</span></div><span class="spacer"></span>
        <span class="pill"><span class="dot ${A.online === false ? "off" : ""}"></span>${esc(A.networkLabel)} · ${A.actors.length} members · ${esc(A.statusText ? A.statusText() : "")}</span>
        <div class="toggle" role="group" aria-label="View">${[["portal", "Portal"], ["console", "Console"], ["check", "Public lot check"]].map(([v, t]) => `<button data-act="view" data-view="${v}" aria-pressed="${S.view === v}">${t}</button>`).join("")}</div></div></header>
      <div class="banner"><div class="wrap">${live ? `Live test network. The demo wallets hold test ETH only.${A.explorerLink ? ` <a href="${esc(A.explorerLink)}" target="_blank" rel="noopener">View the contract</a>` : ""}` : `Offline demo. The ledger rules run as a JavaScript model inside this page: nothing is on a blockchain, and reloading resets it. ${A.advance ? `<button class="btn small ghost" data-act="skip">Skip one day</button>` : ""}`}</div></div>
      <main class="wrap" id="main">${S.view === "check" ? checkView() : mainBody()}</main>
      <div id="toast" aria-live="polite"></div>
      <div class="wrap"><footer class="foot">University of Mauritius module project prototype. All organisations, vessels and lots are fictional. Rules mirror contracts/ThonTrace.sol; see README.md for what is and is not built.</footer></div>`;
  }
  function mainBody() {
    if (!d()) return `<div class="empty">Loading…</div>`;
    if (S.view === "console") return consoleView();
    const me = A.me();
    return `<div class="actas" role="group" aria-label="Acting as"><span class="label">Acting as</span>${A.actors.map((a) => `<button class="role" data-act="role" data-id="${a.id}" aria-pressed="${a.id === S.actor}">${esc(E.ROLE_WORD[a.role])}</button>`).join("")}</div>
      <div class="ident">${esc(me.org)} · ${esc(E.ROLE_WORD[me.role])} · <code>${short(me.address)}</code>${S.data.suspended[me.id] ? ` <span class="tag red">Suspended</span>` : ""}</div>
      <div class="cols"><div class="stack">${actionPanel()}</div><div class="stack">${handoversPanel()}${flagSectionHtml()}${lotCards()}${feedPanel()}</div></div>`;
  }
  const d = () => S.data;
  function renderToast() {
    const el = $("#toast");
    if (!el) return;
    el.innerHTML = S.toast ? `<div class="toast ${S.toast.kind}" role="status">${esc(S.toast.text)}${S.toast.detail ? `<small>${esc(S.toast.detail)}</small>` : ""}</div>` : "";
  }
  function render() {
    const scroll = window.scrollY;
    document.getElementById("app").innerHTML = shell();
    renderToast();
    wireLive();
    window.scrollTo(0, scroll);
  }

  // ---------------------------------------------------------------- live widgets inside forms
  function wireLive() {
    const f = $("#fTransform");
    if (f) {
      const calc = () => {
        const sel = f.elements.lot;
        const weights = JSON.parse(sel.dataset.weights || "{}");
        const input = weights[sel.value] || 0;
        let out = 0;
        for (let i = 0; i < 4; i++) out += Number(f.elements["kg" + i].value || 0) * 1000;
        const waste = Number(f.elements.waste.value || 0) * 1000;
        const total = out + waste;
        const pct = input ? (total / input) * 100 : 0;
        const ok = input && Math.abs(total - input) * 10000 <= input * 500;
        const meter = $(".meter i", f);
        meter.style.width = Math.min(100, (pct / 110) * 100) + "%";
        meter.className = ok ? "" : "bad";
        const diff = input - total;
        $('[data-role="massText"]', f).innerHTML = `Outputs ${kg(out)} + waste ${kg(waste)} = ${kg(total)} of ${kg(input)} (${pct.toFixed(1)} %). ` +
          (ok ? `<span class="good">Inside the 5 % tolerance${diff ? `; ${kg(Math.abs(diff))} ${diff > 0 ? "unexplained" : "over"} is recorded` : ""}.</span>` : `<span class="bad">Outside the 5 % tolerance by ${kg(Math.abs(diff) - input * 0.05)}. Re-weigh, add a waste record, or call QA.</span>`);
        $('[data-role="massSubmit"]', f).disabled = !ok || out === 0;
      };
      f.addEventListener("input", calc);
      calc();
    }
    document.querySelectorAll('[data-live="landing"]').forEach((el) => {
      const form = el.closest("form");
      const calc = () => {
        const declared = Number(el.dataset.declared);
        const scale = Number(form.elements.kg.value || 0) * 1000;
        const off = declared ? ((scale - declared) / declared) * 100 : 0;
        const big = Math.abs(scale - declared) * 10000 > declared * 500;
        el.className = "note " + (big ? "warn" : "good");
        el.textContent = big ? `${off > 0 ? "+" : ""}${off.toFixed(1)} % against the declaration. Landing will go ahead but the authority is warned.` : `${off > 0 ? "+" : ""}${off.toFixed(1)} % against the declaration. Within 5 %.`;
      };
      form.addEventListener("input", calc);
      calc();
    });
    const rf = document.querySelector('form[data-act="recall"] select[name="lot"]');
    if (rf) {
      const upd = async (changed) => {
        if (changed === true) S.confirmRecall = null; // choosing another lot cancels a pending confirmation
        S.recallLot = rf.value;
        try {
          const imp = await A.world.view("recallImpact", rf.value);
          S.recallPreview = `Reaches ${num(imp.lotsReached)} lot(s): ${kg(imp.gramsOnHand)} on hand and ${kg(imp.gramsInTransit)} in transit.`;
        } catch (_) { S.recallPreview = ""; }
        const el = $("#recallImpact");
        if (el) el.textContent = S.recallPreview;
        const btn = document.querySelector('form[data-act="recall"] .btn.danger');
        if (btn) btn.textContent = S.confirmRecall ? `Confirm: recall ${S.confirmRecall}` : "Issue recall";
      };
      rf.addEventListener("change", () => upd(true));
      upd(false);
    }
  }

  // ---------------------------------------------------------------- event handling
  const handlers = {
    view: (el) => { S.view = el.dataset.view; render(); },
    role: (el) => { S.actor = el.dataset.id; render(); },
    skip: async () => { await A.advance(86400); await refresh(); toast("Skipped one day.", "ok"); render(); },
    sample: async (el) => { S.check.code = el.dataset.code; S.check.secret = el.dataset.secret || ""; await runCheck(); },
    preset: (el) => { const f = el.closest("form"); f.elements.c.value = el.dataset.c; f.elements.m.value = el.dataset.m; f.elements.g.value = el.dataset.g; },
    cancelRecall: () => { S.confirmRecall = null; render(); },
    validate: (el) => act(`Validate ${el.dataset.lot}`, () => send("validateCertificate", el.dataset.lot), `Certificate validated for ${el.dataset.lot}.`),
    accept: (el) => act("Accept handover", () => send("acceptTransfer", BigInt(el.dataset.offer)), "Handover accepted. The lot is now in your custody."),
    withdraw: (el) => act("Withdraw offer", () => send("withdrawTransfer", BigInt(el.dataset.offer)), "Offer withdrawn. The lot is back on your shelf."),
    release: (el) => act("Release offer", () => send("expireTransfer", BigInt(el.dataset.offer)), "Offer released. The lot is back with the sender."),
    onSale: (el) => act("Put on sale", () => send("setOnSale", el.dataset.lot), `${el.dataset.lot} is on sale.`),
  };
  const forms = {
    allocate: (f) => act("Set allocation", () => send("setAllocation", A.world.addr[f.vessel.value], f.species.value.trim(), grams(f.kg.value)), `Allocation set: ${f.species.value} ${f.kg.value} kg per 30 days.`),
    suspend: (f, ev) => {
      const mode = ev.submitter && ev.submitter.value;
      const who = A.world.addr[f.who.value];
      return mode === "reinstate" ? act("Reinstate", () => send("reinstateMember", who), "Member reinstated.") : act("Suspend", () => send("suspendMember", who, f.reason.value), "Member suspended.");
    },
    recall: async (f) => {
      const code = f.lot.value;
      if (S.confirmRecall !== code) { S.confirmRecall = code; render(); return; }
      S.confirmRecall = null;
      return act(`Recall ${code}`, () => send("issueRecall", code, f.reason.value + (f.note.value ? ": " + f.note.value : "")), `Recall issued for ${code}.`);
    },
    registerCatch: async (f) => {
      const file = f.file.files && f.file.files[0];
      const cert = file ? await fingerprint(new Uint8Array(await file.arrayBuffer())) : await fingerprint(`catch certificate|${f.code.value}|${f.species.value}|${f.kg.value}`);
      return act(`Register ${f.code.value}`, () => send("registerCatch", { code: f.code.value.trim(), species: f.species.value, method: f.elements.method.value, area: f.area.value, declaredGrams: grams(f.kg.value), frozen: f.frozen.checked, certCid: cert }), `Catch ${f.code.value} registered. Waiting for the authority to validate the certificate.`);
    },
    land: (f) => act(`Land ${f.dataset.lot}`, () => send("recordLanding", f.dataset.lot, grams(f.kg.value)), `${f.dataset.lot} landed at ${f.kg.value} kg.`),
    transform: async (f) => {
      const outputs = [];
      for (let i = 0; i < 4; i++) {
        const k = Number(f.elements["kg" + i].value || 0);
        if (!k) continue;
        const code = f.elements["code" + i].value.trim();
        let commit = ZERO32;
        if (f.elements["tag" + i].checked) {
          const secret = randomSecret();
          commit = A.world.keccakHex(secret);
          S.tags[code] = secret;
        }
        outputs.push({ code, form: f.elements["form" + i].value, grams: grams(k), frozen: f.elements["frozen" + i].checked, bestBefore: (await A.world.now()) + BigInt(Math.round(Number(f.elements["days" + i].value || 10))) * DAY, tagCommit: commit, docsCid: await fingerprint(`lab report|${code}`) });
      }
      store.set("tags", S.tags);
      const res = await act(`Process ${f.elements.lot.value}`, () => send("recordTransformation", f.elements.lot.value, outputs, grams(f.elements.waste.value || 0)), `${outputs.length} output lot(s) created from ${f.elements.lot.value}.`);
      if (res) { A.packs = [...(A.packs || []).filter((p) => !S.tags[p.lot]), ...Object.entries(S.tags).map(([lot, secret]) => ({ lot, secret }))]; }
    },
    shelve: (f) => act(`Shelve ${f.dataset.lot}`, () => send("storeLot", f.dataset.lot, f.room.value.trim()), `${f.dataset.lot} is in ${f.room.value}.`),
    offer: (f) => act(`Offer ${f.dataset.lot}`, () => send("proposeTransfer", f.dataset.lot, A.world.addr[f.to.value], BigInt(Math.round(Number(f.days.value))) * DAY, A.world.hash(`delivery note|${f.dataset.lot}|${Date.now()}`)), `Offer sent. ${f.dataset.lot} is now in transit and held in escrow.`),
    decline: (f) => act("Decline handover", () => send("declineTransfer", BigInt(f.dataset.offer), f.reason.value), "Handover declined. The lot is back with the sender."),
    sale: (f) => act(`Sell ${f.dataset.lot}`, () => send("recordSale", f.dataset.lot, grams(f.kg.value)), `Sale recorded: ${f.kg.value} kg.`),
    loss: (f) => act(`Loss on ${f.dataset.lot}`, async () => send("reportLoss", f.dataset.lot, grams(f.kg.value), f.destroyed.checked, await fingerprint(`loss|${f.dataset.lot}|${f.reason.value}`)), `${f.destroyed.checked ? "Destruction" : "Loss"} recorded: ${f.kg.value} kg.`),
    raise: (f) => act(`Flag ${f.dataset.lot}`, () => send("raiseFlag", f.dataset.lot, Number(f.reason.value), A.world.hash(`flag|${f.dataset.lot}|${Date.now()}`)), `Flag raised on ${f.dataset.lot}. The lot is quarantined.`),
    requestClearance: (f) => act("Request clearance", () => send("requestClearance", BigInt(f.dataset.flag), A.world.hash(f.note.value || "evidence")), "Clearance requested. The authority or the auditor can now clear the flag."),
    clear: (f) => act("Clear flag", () => send("clearFlag", BigInt(f.dataset.flag), A.world.hash(f.note.value || "cleared")), "Flag cleared. The lot is released."),
    logger: (f) => act(`Logger on ${f.dataset.lot}`, async () => { const r = await send("assignLogger", f.id.value.trim(), f.dataset.lot); S.loggers[f.id.value.trim()] = A.world.keyOf(f.dataset.lot); store.set("loggers", S.loggers); return r; }, `Logger ${f.id.value} attached to ${f.dataset.lot}.`),
    reading: (f) => act("Send reading", () => send("submitSummary", f.id.value, BigInt(Math.round(Number(f.c.value) * 100)), BigInt(Math.round(Number(f.m.value || 0))), BigInt(Math.round(Number(f.g.value || 0))), A.world.hash(`reading|${f.id.value}|${Date.now()}`)), "Reading recorded."),
    check: async (f) => { S.check.code = f.code.value; S.check.secret = f.secret.value; await runCheck(); },
  };

  function onClick(ev) {
    const el = ev.target.closest("[data-act]");
    if (!el || el.tagName === "FORM") return;
    const fn = handlers[el.dataset.act];
    if (fn) { ev.preventDefault(); fn(el, ev); }
  }
  function onSubmit(ev) {
    const f = ev.target.closest("form[data-act]");
    if (!f) return;
    ev.preventDefault();
    const fn = forms[f.dataset.act];
    if (fn) fn(f, ev);
  }

  // ---------------------------------------------------------------- start
  async function start(adapter) {
    A = adapter;
    A.actors.forEach((a) => { ROLE_OF[a.id] = a.role; byAddr[lc(a.address)] = a; });
    A.me = () => A.actors.find((a) => a.id === S.actor);
    A.packs = [...(A.packs || [])];
    for (const [lot, secret] of Object.entries(S.tags)) if (!A.packs.find((p) => p.lot === lot)) A.packs.push({ lot, secret });
    const root = document.getElementById("app");
    root.addEventListener("click", onClick);
    root.addEventListener("submit", onSubmit);
    root.innerHTML = `<div class="wrap"><p class="empty">Loading the ledger…</p></div>`;
    const q = new URLSearchParams(location.search);
    try {
      await refresh();
    } catch (e) {
      root.innerHTML = `<div class="wrap"><section class="card" style="margin-top:20px"><h2>Could not read the ledger</h2><p>${esc(errText(e))}</p><p class="note">${esc(e.message || e)}</p></section></div>`;
      return;
    }
    if (q.get("lot")) { S.view = "check"; S.check.code = q.get("lot"); S.check.secret = q.get("tag") || ""; }
    render();
    if (q.get("lot")) runCheck();
  }
  window.ThonApp = { start, _state: S };
})();
