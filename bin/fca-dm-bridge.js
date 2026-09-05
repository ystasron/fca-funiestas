#!/usr/bin/env node
/**
 * fca-dm-bridge — standalone runner for the in-library E2EE DM bridge.
 *
 * Watches the bot's open E2EE 1:1 chat(s), prints incoming DMs in the same
 * format as group messages ([threadID] from senderID: body), and replies to
 * /ping and hi (mirroring the reference bot). For custom reply logic, use
 * createDmBridge() from the library instead.
 *
 * Usage:
 *   npx @dongdev/fca-dm-bridge --self-id 61593939007714 \
 *     --partner "Ronmar Funiestas=100008816886962"
 *   Options: --port 9222 --thread <e2eeKey> --poll-ms 1500
 */

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};

const PORT = Number(arg("port")) || 9222;
const SELF_ID = arg("self-id");
const PARTNER_ARGS = argv.filter((_, i) => argv[i - 1] === "--partner");

function usage() {
  console.log(`Usage: fca-dm-bridge --self-id <botFBid> --partner "Display Name=fbUserId" [--port 9222] [--thread <e2eeKey>]
Add --partner once per DM partner.`);
  process.exit(1);
}

if (!SELF_ID || !PARTNER_ARGS.length) usage();

const partners = PARTNER_ARGS.map((p) => {
  const idx = p.lastIndexOf("=");
  if (idx === -1) usage();
  return { name: p.slice(0, idx), userID: p.slice(idx + 1) };
});

async function main() {
  const tryRequire = (...names) => {
    for (const n of names) {
      try {
        return require(n);
      } catch (e) {
        if (e && e.code === "MODULE_NOT_FOUND" && String(e.message).includes(n)) continue;
        throw e;
      }
    }
    return null;
  };
  const bridgeMod =
    tryRequire("../dist/browser/dm-bridge.js", "../dist/browser/dm-bridge.cjs") ||
    (() => {
      console.error("[fca-dm-bridge] library not built — run `npm run build` in the package first");
      process.exit(1);
    })();
  const { createDmBridge } = bridgeMod;

  const bridge = createDmBridge({
    port: PORT,
    selfID: SELF_ID,
    partners,
    threadKey: arg("thread") || null,
    pollMs: Number(arg("poll-ms")) || 1500
  });

  bridge.onMessage(async ({ threadID, senderID, body }) => {
    console.log(`[${threadID}] from ${senderID}: ${body}`);

    // Mirror the reference bot's replies. For custom logic, embed
    // createDmBridge in your own code instead of this CLI.
    let reply = null;
    if (/^\/?ping$/i.test(body.trim())) reply = "pong";
    else if (/^hi$/i.test(body.trim())) reply = "Hello there!";
    if (reply) {
      await bridge.reply(reply);
    }
  });

  bridge.start();
  console.log(`[fca-dm-bridge] starting on :${PORT} (Ctrl+C to stop)`);
}

main().catch((e) => {
  console.error("[fca-dm-bridge] failed:", (e && (e.error || e.message)) || e);
  process.exit(1);
});
