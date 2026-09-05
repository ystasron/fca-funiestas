/**
 * dm-bridge.js — makes 1:1 DMs work for the bot by bridging E2EE conversations.
 *
 * WHY THIS EXISTS
 * --------------
 * Facebook now routes 1:1 personal messages through "Armadillo", its E2EE
 * (end-to-end encrypted) backend. The classic FCA/MQTT path the rest of the
 * bot uses cannot see or write to E2EE threads (Facebook returns "Thread
 * Disabled" / occam_thread:null because those threads only exist in the
 * encrypted backend). No public FCA fork speaks Armadillo.
 *
 * The pragmatic solution: drive a real Messenger tab that IS logged in as the
 * bot account. The page's own Armadillo worker does all key exchange + crypto.
 * This bridge:
 *   - watches an open E2EE 1:1 chat for incoming messages (read from the
 *     browser's accessibility tree, which the page populates with decrypted
 *     text), and
 *   - logs them to bot.log in the SAME format as group messages:
 *       [<threadID>] from <senderID>: <body>
 *   - replies to commands by typing into the composer (the page encrypts).
 *
 * USAGE
 * -----
 * Easiest: run start-bot.sh (or start-bot.bat) — it launches Chrome with the
 * bot profile, starts the group bot, and starts this bridge. Requires Chrome
 * running with --remote-debugging-port=<port>, logged in as the bot account.
 *
 * Manual:
 *   node dm-bridge.js [--port 9222] [--thread <e2eeThreadKey>]
 *
 * One bridge instance watches ONE E2EE thread. For more DM partners add a
 * second bridge (own port/thread) or extend CONFIG below.
 *
 * Set DM_BRIDGE_DEBUG=1 for per-poll diagnostics.
 */

const fs = require("fs");
const puppeteer = require("puppeteer-core");

// ---------------------------------------------------------------- CONFIG ---
const CONFIG = {
  debugPort: Number(process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 9222) || 9222,

  // The bot's own Facebook user ID and how the UI labels the bot's messages.
  selfID: "61593939007714",
  selfLabel: "You", // Messenger's AX tree marks own messages as "by You:"

  // E2EE 1:1 thread key (the number in /e2ee/t/<key>/ URLs — NOT a user ID).
  // Auto-detected from the open tab when possible.
  threadKey: process.argv.includes("--thread") ? process.argv[process.argv.indexOf("--thread") + 1] : null,

  // People this bot DMs with: name as shown in the chat header -> FB user ID.
  partners: [
    { name: "Ronmar Funiestas", userID: "100008816886962" },
  ],

  logFile: "bot.log", // where group messages already go (bot is run with > bot.log)
  pollMs: 1500, // how often to scan the chat for new messages
};

// ------------------------------------------------------------- utilities ---
const logLine = (line) => {
  const text = `[${new Date().toISOString()}] ${line}\n`;
  console.log(line);
  try { fs.appendFileSync(CONFIG.logFile, text); } catch (_) {}
};

function parseMessageButton(name) {
  // AX names look like: "Enter, Message sent 3:15 PM by Ronmar: Hello there!"
  // or "Enter, Message sent 10:02 PM by You: reply text".
  // Times never contain " by ", so the FIRST " by " after the prefix marks
  // the sender. Sender = text up to the next ": "; the body is everything
  // after (it may itself contain colons and " by ").
  const prefix = name.indexOf(" by ", name.indexOf("Message sent") + 12);
  if (prefix === -1) return null;
  const senderStart = prefix + 4;
  const colon = name.indexOf(": ", senderStart);
  if (colon === -1) return null;
  const sender = name.slice(senderStart, colon).trim();
  const body = name.slice(colon + 2).trim();
  if (!sender || !body) return null;
  return { sender, body };
}

// Resolve the chat display name (often just a first name) to a config partner.
function resolveSender(sender) {
  if (sender === CONFIG.selfLabel) return { isSelf: true, userID: CONFIG.selfID };
  for (const p of CONFIG.partners) {
    const full = p.name.toLowerCase();
    const short = sender.toLowerCase();
    if (full === short || full.startsWith(short) || short.startsWith(full)) {
      return { isSelf: false, userID: p.userID };
    }
  }
  return null;
}

// Send a text message through the open composer using TRUSTED CDP input
// (synthetic DOM events are ignored by Messenger's editor). The page's own
// Armadillo worker encrypts and delivers the message.
async function sendText(cdp, page, text) {
  const empty = await page.evaluate(() => {
    const el = document.querySelector('[contenteditable="true"][role="textbox"]');
    if (!el) return "no-composer";
    el.focus();
    // Clear any stale content with real edit commands so React stays in sync.
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    return el.textContent.length === 0 ? "empty" : "dirty";
  });
  if (empty === "no-composer") return "no-composer";
  if (empty === "dirty") return "clear-failed";

  await cdp.send("Input.insertText", { text });
  await new Promise((r) => setTimeout(r, 300));
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await new Promise((r) => setTimeout(r, 1200));

  // Message left the composer == it went out.
  const stillThere = await page.evaluate(() => {
    const el = document.querySelector('[contenteditable="true"][role="textbox"]');
    return el ? el.textContent : null;
  });
  return stillThere === "" ? "sent" : "composer-not-empty";
}

// Collect message rows currently rendered in the conversation.
// Uses the full AX tree and filters role=button nodes whose names start with
// "Enter, Message sent" (that prefix is unique to message rows). Each row's
// backendDOMNodeId is a STABLE identity for that DOM element — required to
// tell repeated identical messages apart (e.g. two pings both read
// "by Ronmar: ping").
async function collectMessages(cdp) {
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const out = [];
  for (const n of nodes) {
    if (n.role && n.role.value === "button" && n.name && n.name.value && n.name.value.startsWith("Enter, Message sent")) {
      const id = n.backendDOMNodeId;
      if (id != null) out.push({ id, name: n.name.value });
    }
  }
  return out;
}

// Returns true when a reply was sent, false otherwise.
async function handleMessage(cdp, page, parsed) {
  const { sender, body } = parsed;
  if (!body) return false;
  const who = resolveSender(sender);
  if (!who) {
    logLine(`[dm-bridge] message from unknown sender "${sender}" ignored`);
    return false;
  }
  if (who.isSelf) return false; // never react to our own messages

  const threadID = CONFIG.threadKey || "e2ee";
  logLine(`[${threadID}] from ${who.userID}: ${body}`);

  // --- reply to commands (mirror run.js behavior) ---
  let reply = null;
  if (/^\/?ping$/i.test(body.trim())) reply = "pong";
  else if (/^hi$/i.test(body.trim())) reply = "Hello there!";
  if (reply) {
    const res = await sendText(cdp, page, reply);
    logLine(`[dm-bridge] replied "${reply}" (${res})`);
    return res === "sent";
  }
  return false;
}

// ----------------------------------------------------------------- main ---
async function main() {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CONFIG.debugPort}`, defaultViewport: null });
  let page = (await browser.pages()).find((p) => p.url().includes("messenger.com"));

  if (!page) {
    // open a messenger tab so the user can log in / land on the chat
    page = await browser.newPage();
    await page.goto("https://www.messenger.com", { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  const cdp = await page.createCDPSession();
  await cdp.send("Accessibility.enable");

  // If no thread key configured, try to read it from the open tab's URL.
  if (!CONFIG.threadKey) {
    const m = page.url().match(/\/e2ee\/t\/(\d+)/) || page.url().match(/\/t\/(\d+)/);
    if (m) CONFIG.threadKey = m[1];
  }
  logLine(`[dm-bridge] watching: ${page.url()} | thread=${CONFIG.threadKey || "unknown"}`);

  // backendDOMNodeIds already handled (bounded; older entries drop off).
  const handledIds = new Set();
  const HANDLED_MAX = 500;
  let baselined = false; // first poll snapshots current history, logs nothing

  const poll = async () => {
    try {
      const url = page.url();
      const inThread = url.match(/\/(?:e2ee\/)?t\/(\d+)/);
      const onRightThread = inThread && (!CONFIG.threadKey || inThread[1] === CONFIG.threadKey);
      if (!onRightThread) {
        // Not on the E2EE chat we bridge (wrong thread or navigated away) —
        // go back so replies never land in the wrong conversation.
        if (CONFIG.threadKey) {
          await page.goto(`https://www.messenger.com/e2ee/t/${CONFIG.threadKey}/`, { timeout: 30000 }).catch(() => {});
        }
        return;
      }

      const rows = await collectMessages(cdp);
      if (!rows.length) return;

      let processed = 0;
      let replyCount = 0;

      // First scan: treat everything currently mounted as history (no replies
      // or logging for messages that arrived before the bridge started).
      if (!baselined) {
        for (const row of rows) handledIds.add(row.id);
        baselined = true;
        return;
      }

      for (const row of rows) {
        if (handledIds.has(row.id)) continue;
        handledIds.add(row.id);
        if (handledIds.size > HANDLED_MAX) {
          // drop oldest-handled ids (Set iteration order = insertion order)
          for (const old of handledIds) {
            handledIds.delete(old);
            if (handledIds.size <= HANDLED_MAX) break;
          }
        }
        const parsed = parseMessageButton(row.name);
        if (!parsed) continue;
        const res = await handleMessage(cdp, page, parsed);
        processed++;
        if (res) replyCount++;
      }
      if (process.env.DM_BRIDGE_DEBUG) {
        console.log(`[poll] rows=${rows.length} handled=${handledIds.size} new=${processed} replies=${replyCount}`);
      }
    } catch (e) {
      if (!/Target closed|Execution context was destroyed/.test(e.message)) {
        console.error("[dm-bridge] poll error:", e.message);
      }
    }
  };

  setInterval(poll, CONFIG.pollMs);
  console.log("[dm-bridge] running. Waiting for DMs...");
}

main().catch((e) => { console.error("[dm-bridge] failed to start:", e.message); process.exit(1); });
