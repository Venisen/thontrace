/**
 * Live page: talks to the contract deployed by scripts/deploy-live.js (see web/deployment.js) through the demo
 * wallets in that file. The wallets hold TEST ETH only; their keys are public on purpose so that visitors can act
 * as each organisation without installing a wallet.
 */
(function () {
  const TT = window.TT;
  const fail = (title, text) => {
    document.getElementById("app").innerHTML = `<div class="wrap"><section class="card" style="margin-top:20px"><h2>${title}</h2><p>${text}</p></section></div>`;
  };

  async function pickProvider(D) {
    for (const url of D.rpcUrls) {
      try {
        const p = new ethers.JsonRpcProvider(url, D.chainId, { staticNetwork: true });
        await p.getBlockNumber();
        return p;
      } catch (_) { /* try the next endpoint */ }
    }
    throw new Error("None of the network endpoints answered. Try again in a minute.");
  }

  async function boot() {
    const D = window.THONTRACE_DEPLOYMENT;
    if (!D) return fail("Not deployed yet", "Run <code>npx hardhat run scripts/deploy-live.js --network sepolia</code> first. It writes <code>web/deployment.js</code>. Until then, open <a href=\"demo.html\">demo.html</a> for the offline demo.");
    if (typeof ethers === "undefined") return fail("ethers did not load", "The page loads the ethers library from a CDN (jsDelivr). Check the connection and reload.");
    const provider = await pickProvider(D);
    const contract = new ethers.Contract(D.contract, D.abi, provider);
    const signers = Object.fromEntries(Object.entries(D.demoWallets).map(([role, w]) => [role, new ethers.Wallet(w.privateKey, provider)]));
    const world = TT.makeEthersWorld({ ethers, contract, signers, now: async () => (await provider.getBlock("latest")).timestamp });
    const actors = Object.entries(D.demoWallets).map(([role, w]) => ({ id: role, role: role.toUpperCase(), org: w.org, address: w.address }));
    const adapter = {
      kind: "live",
      world,
      actors,
      packs: (D.demoPacks || []).map((p) => ({ lot: p.lot, secret: p.secret })),
      seed: D.seed,
      networkLabel: `${D.network} (chain ${D.chainId})`,
      explorerLink: D.explorer ? `${D.explorer}/address/${D.contract}` : null,
      block: null,
      afterRefresh: async () => { adapter.block = await provider.getBlockNumber(); },
      statusText: () => (adapter.block ? "block " + adapter.block : ""),
    };
    await window.ThonApp.start(adapter);
  }
  boot().catch((e) => { fail("Could not start", String((e && e.message) || e)); console.error(e); });
})();
