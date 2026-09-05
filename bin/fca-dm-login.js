#!/usr/bin/env node
/**
 * fca-dm-login — one-time browser login helper for DM support.
 *
 * The bot profile (dmhelper/bot-profile by default) must be created by ONE
 * human login: Facebook shows an Arkose captcha + 2FA that no script passes
 * reliably. This command:
 *
 *   1. launches Chromium with the bot profile (visible window when possible,
 *      so you can log in; --headless flag forces headless for tunneled use),
 *   2. waits until a logged-in session is detected (up to 10 minutes),
 *   3. exits 0 and the profile is permanent — bots run headless from then on.
 *
 * Usage:
 *   npx @dongdev/fca-dm-login                 # headed window, wait for login
 *   npx @dongdev/fca-dm-login --port 9223     # custom CDP port
 *   npx @dongdev/fca-dm-login --headless      # for ssh -L tunneled VPS use
 *
 * Headless VPS flow:
 *   ssh -L 9222:localhost:9222 user@vps   # keep open
 *   npx @dongdev/fca-dm-login --headless  # on the VPS
 *   # then open http://localhost:9222 in YOUR browser, click the tab, log in
 */

const fs = require("node:fs");

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};
const PORT = Number(arg("port")) || 9222;
const HEADLESS = argv.includes("--headless");

const PROFILE_DIR =
  (arg("profile") && require("node:path").resolve(arg("profile"))) ||
  require("node:path").join(process.cwd(), "dmhelper", "bot-profile");

async function main() {
  // dist outputs may be .js or .cjs depending on tsup version — resolve either.
  const tryRequire = (...names) => {
    for (const n of names) {
      try {
        return { mod: require(n) };
      } catch (e) {
        if (e && e.code === "MODULE_NOT_FOUND" && String(e.message).includes(n)) continue;
        throw e;
      }
    }
    return null;
  };

  const launcher = tryRequire("../dist/browser/launcher.js", "../dist/browser/launcher.cjs");
  const cdp = tryRequire("../dist/browser/cdp-session.js", "../dist/browser/cdp-session.cjs");
  if (!launcher || !cdp) {
    console.error("[fca-dm-login] library not built — run `npm run build` in the package first");
    process.exit(1);
  }
  const { ensureChromium } = launcher.mod;
  const { listPages, openPage, attachTo, evaluateOn } = cdp.mod;

  // Chromium must run HEADED for a human login (captcha/2FA) — unless the
  // operator is tunneling into a headless one.
  await ensureChromium({
    port: PORT,
    profileDir: PROFILE_DIR,
    headless: HEADLESS,
    log: (line) => console.log(`[fca-dm-login] ${line}`)
  });

  // Open the login page.
  let page;
  const pages = await listPages(PORT);
  page = pages.find((p) => p.url.includes("facebook.com") || p.url.includes("messenger.com"));
  if (!page) {
    page = await openPage(PORT, "https://www.facebook.com/login");
  }
  const session = await attachTo(page);
  await session.send("Page.enable").catch(() => {});

  const isLoggedIn = async () => {
    const state = await evaluateOn(
      session,
      `(() => {
        const text = (document.body && document.body.innerText) || "";
        return !/\\b(Log in|Log In to Continue)\\b/.test(text.slice(0, 3000)) &&
               !!document.querySelector('[aria-label*="account"], [aria-label*="Account"]');
      })()`
    ).catch(() => false);
    return !!state;
  };

  if (await isLoggedIn()) {
    console.log("[fca-dm-login] already logged in — nothing to do");
    process.exit(0);
  }

  console.log(`
[fca-dm-login] Chromium is running with the bot profile:
  ${PROFILE_DIR}
[fca-dm-login] Waiting for you to log in (Facebook login page is open).
  - Solve the captcha / 2FA as a human, tick "Keep me signed in".
  - Headed mode: use the Chromium window on this machine.
  - Headless/tunneled: open http://localhost:${PORT} in your own browser
    (via ssh -L ${PORT}:localhost:${PORT} user@vps) and log in in that tab.
  Timeout: 10 minutes.
`);

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    if (await isLoggedIn()) {
      console.log("[fca-dm-login] session detected — profile is now permanent.");
      console.log("[fca-dm-login] Next: open Messenger, send the bot a DM once (creates the thread);");
      console.log("[fca-dm-login] the bridge will click into it automatically from now on.");
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("[fca-dm-login] timed out — run again when ready to log in.");
  process.exit(1);
}

main().catch((e) => {
  console.error("[fca-dm-login] failed:", (e && (e.error || e.message)) || e);
  process.exit(1);
});
