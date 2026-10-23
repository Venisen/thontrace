/**
 * Wraps an ethers v6 contract in the same small "world" interface that test/spec.js, the stories and the web
 * pages use for the JavaScript model, so one set of tests, one story and one UI run against both.
 *
 *   makeEthersWorld({ ethers, contract, signers: { name: signer }, advance?, now? })
 *
 * Works in Node (Hardhat) and in the browser (ethers v6 UMD build).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TT = Object.assign(root.TT || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function plain(x, Result) {
  if (Array.isArray(x) && typeof x.toObject === "function") {
    let named = null;
    try {
      const o = x.toObject();
      if (Object.keys(o).length === x.length && x.length > 0) named = o;
    } catch (_) {
      named = null;
    }
    if (named) return Object.fromEntries(Object.entries(named).map(([k, v]) => [k, plain(v, Result)]));
    return Array.from(x, (v) => plain(v, Result));
  }
  return x;
}

function makeEthersWorld({ ethers, contract, signers, advance, now }) {
  const iface = contract.interface;
  const gas = {};
  const addr = Object.fromEntries(Object.entries(signers).map(([n, s]) => [n, s.address]));

  const errorName = (e) => {
    if (e && e.revert && e.revert.name) return e.revert.name;
    const data = (e && (e.data || (e.error && e.error.data) || (e.info && e.info.error && e.info.error.data))) || null;
    const hex = typeof data === "string" ? data : data && typeof data.data === "string" ? data.data : null;
    if (hex && hex.startsWith("0x") && hex.length >= 10) {
      try {
        const p = iface.parseError(hex);
        if (p) return p.name;
      } catch (_) {}
    }
    const msg = (e && (e.shortMessage || e.message)) || "";
    const m = /custom error '([A-Za-z0-9_]+)\(/.exec(msg) || /reverted with custom error '([A-Za-z0-9_]+)/.exec(msg);
    if (m) return m[1];
    if (/panic code/i.test(msg)) return "Panic";
    return null;
  };

  return {
    kind: "ethers",
    errorName,
    contract,
    addr,
    gas,
    async send(actor, fn, ...args) {
      const signer = signers[actor];
      if (!signer) throw new Error(`unknown actor ${actor}`);
      const tx = await contract.connect(signer)[fn](...args);
      const rc = await tx.wait();
      (gas[fn] = gas[fn] || []).push(Number(rc.gasUsed));
      const events = [];
      for (const log of rc.logs) {
        let parsed = null;
        try {
          parsed = iface.parseLog(log);
        } catch (_) {}
        if (parsed) events.push({ name: parsed.name, args: plain(parsed.args) });
      }
      return { events, gasUsed: Number(rc.gasUsed), hash: tx.hash };
    },
    async view(fn, ...args) {
      return plain(await contract[fn](...args));
    },
    async reverts(promise, name) {
      try {
        await promise;
      } catch (e) {
        const got = errorName(e);
        if (got !== name) throw new Error(`expected revert ${name}, got ${got || (e.shortMessage || e.message)}`);
        return;
      }
      throw new Error(`expected revert ${name}, but the call succeeded`);
    },
    async blockedWith(fn, actor, ...args) {
      // Dry-run a call and return the custom error name (or null if it would succeed). Spends no gas.
      try {
        await contract.connect(signers[actor])[fn].staticCall(...args);
        return null;
      } catch (e) {
        return errorName(e);
      }
    },
    async advance(seconds) {
      if (!advance) throw new Error("this network cannot skip time");
      await advance(Number(seconds));
    },
    async now() {
      if (now) return BigInt(await now());
      const b = await ethers.provider.getBlock("latest");
      return BigInt(b.timestamp);
    },
    keyOf: (code) => ethers.id(code),
    hash: (text) => ethers.id(text),
    keccakHex: (hex) => ethers.keccak256(hex),
  };
}

  return { makeEthersWorld, plain };
});
