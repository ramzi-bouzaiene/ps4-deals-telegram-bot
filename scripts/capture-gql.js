const { chromium } = require("playwright");

const TARGETS = [
  { name: "getExperience (home)", url: "https://store.playstation.com/fr-fr" },
  { name: "getExperience (deals)", url: "https://store.playstation.com/fr-fr/pages/deals" },
  {
    name: "categoryGridRetrieve (promotions)",
    url: "https://store.playstation.com/fr-fr/category/3f772501-f6f8-49b7-abac-874a88ca4897/1",
  },
];

(async () => {
  console.log("Capturing PS Store GraphQL request URLs (hashes)...\n");
  console.log("If a hash in src/promos.ts / src/deals.ts stopped working,");
  console.log("paste the matching URL below back into those files.\n");
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  const seen = new Set();

  for (const t of TARGETS) {
    const found = [];
    const onReq = (r) => {
      if (r.url().includes("/api/graphql")) {
        const op = (r.url().match(/operationName=([^&]+)/) || [])[1] || "?";
        const key = op + "|" + r.url();
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ op, url: r.url() });
        }
      }
    };
    page.on("request", onReq);
    await page.goto(t.url, { waitUntil: "load", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(7000);
    await page.evaluate(async () => {
      for (let y = 0; y < 4; y++) {
        window.scrollBy(0, 900);
        await new Promise((r) => setTimeout(r, 700));
      }
    });
    await page.waitForTimeout(2000);
    page.off("request", onReq);
    console.log(`=== ${t.name}`);
    for (const f of found) {
      const hash = (f.url.match(/sha256Hash%22%3A%22([a-f0-9]+)|sha256Hash":"([a-f0-9]+)/) || [])
        .slice(1)
        .find(Boolean);
      console.log(`  ${f.op}${hash ? "  hash=" + hash : ""}`);
      console.log(`  ${f.url}\n`);
    }
    if (!found.length) console.log("  (none captured)\n");
  }

  await browser.close();
})();
