/**
 * Wraps the JavaScript reference model in the small "world" interface used by test/spec.js, the stories and the
 * web pages (the same interface web/lib/world-ethers.js gives the Solidity contract).
 *
 *   makeModelWorld({ roles: { actorName: "ROLE" }, actors: ["admin", ...] })
 *
 * Works in Node and in the browser.
 */
(function (root, factory) {
  const deps = typeof require === "function" && typeof module === "object" ? { K: require("./keccak"), M: require("./model") } : { K: root.TT, M: root.TT };
  const api = factory(deps.K, deps.M);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TT = Object.assign(root.TT || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (K, M) {
  const { ThonTraceModel, Revert } = M;
  const fakeAddress = (name) => "0x" + K.keccakText("thontrace-actor:" + name).slice(26);

  function makeModelWorld({ roles, actors }) {
    const addr = Object.fromEntries(actors.map((n) => [n, fakeAddress(n)]));
    const m = new ThonTraceModel(addr.admin);
    for (const [actor, role] of Object.entries(roles)) m.send(addr.admin, "grantRole", role, addr[actor]);
    return {
      kind: "model",
      model: m,
      addr,
      errorName: (err) => (err instanceof Revert ? err.errorName : null),
      async send(actor, fn, ...args) {
        const r = m.send(addr[actor], fn, ...args);
        return { events: r.events, value: r.value };
      },
      async view(fn, ...args) {
        return m.view(fn, ...args);
      },
      async reverts(promise, name) {
        try {
          await promise;
        } catch (err) {
          if (!(err instanceof Revert)) throw err;
          if (err.errorName !== name) throw new Error(`expected revert ${name}, got ${err.errorName}`);
          return;
        }
        throw new Error(`expected revert ${name}, but the call succeeded`);
      },
      async advance(s) {
        m.advance(s);
      },
      async now() {
        return m.now();
      },
      keyOf: (code) => K.keccakText(code),
      hash: (text) => K.keccakText(text),
      keccakHex: (hex) => K.keccakHex(hex),
    };
  }

  return { makeModelWorld, fakeAddress };
});
