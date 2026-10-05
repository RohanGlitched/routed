// Full-page screenshots for review. Usage: node scripts/shots.cjs <baseUrl> <path>[,<path>...] [widths=1440,390] [outDir=../shots]
const { chromium } = require("I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright");
const path = require("path");
(async () => {
  const [base = "http://localhost:3800", paths = "/", widths = "1440,390", out = path.join(__dirname, "../../shots")] = process.argv.slice(2);
  const b = await chromium.launch();
  for (const w of widths.split(",").map(Number)) {
    const ctx = await b.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, deviceScaleFactor: w < 600 ? 2 : 1 });
    const p = await ctx.newPage();
    const errors = [];
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    p.on("pageerror", (e) => errors.push(String(e)));
    for (const route of paths.split(",")) {
      await p.goto(base + route, { waitUntil: "networkidle", timeout: 180000 });
      await p.waitForTimeout(2500);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      const name = `${route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}-${w}.png`;
      await p.screenshot({ path: path.join(out, name), fullPage: true });
      console.log(name, `scrollWidth=${sw}`, errors.length ? `errors: ${errors.join(" | ").slice(0, 400)}` : "no console errors");
      errors.length = 0;
    }
    await ctx.close();
  }
  await b.close();
})();
