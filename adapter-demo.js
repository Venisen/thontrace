/**
 * Offline demo: runs the JavaScript reference model inside the page and plays the seed story so there is something to
 * explore. No chain, no wallet, no network. Reloading the page resets everything.
 */
(function () {
  const TT = window.TT;
  const ROLES = { authority: "AUTHORITY", vessel: "VESSEL", processor: "PROCESSOR", carrier: "CARRIER", retailer: "RETAILER", auditor: "AUDITOR", gateway: "GATEWAY" };

  async function boot() {
    const world = TT.makeModelWorld({ roles: ROLES, actors: ["admin", ...Object.keys(ROLES)] });
    const story = await TT.story.seed(world, {});
    const actors = Object.keys(ROLES).map((id) => ({ id, role: ROLES[id], org: TT.story.ORG[id], address: world.addr[id] }));
    await window.ThonApp.start({
      kind: "demo",
      world,
      actors,
      packs: Object.entries(story.tags).map(([lot, t]) => ({ lot, secret: t.secret })),
      seed: TT.story.SEED,
      networkLabel: "Offline model",
      advance: async (s) => world.advance(s),
      statusText: () => "clock " + new Date(Number(world.model.now()) * 1000).toISOString().slice(0, 10),
    });
  }
  boot().catch((e) => {
    document.getElementById("app").innerHTML = `<div class="wrap"><section class="card" style="margin-top:20px"><h2>The demo could not start</h2><p>${String(e && e.message || e)}</p></section></div>`;
    console.error(e);
  });
})();
