const { createMessengerBot } = require("./dist/cjs.cjs");

// Facebook does not deliver 1:1 DMs from non-friends over MQTT until the
// thread leaves the "Message Requests" (other) folder. Accept them
// automatically so DMs start arriving like group messages.
const REQUEST_POLL_MS = 30000;

async function acceptMessageRequests(bot) {
  try {
    const threads = await bot.api.getThreadList(50, null, ["other"]);
    for (const t of threads || []) {
      if (!t.threadID) continue;
      await bot.api.handleMessageRequest(t.threadID, true);
      console.log(`[bot] Accepted message request: ${t.threadID} (${t.name || "unknown"})`);
    }
  } catch (e) {
    // Transient GraphQL errors are common; try again next poll.
  }
}

async function main() {
  const bot = await createMessengerBot(
    { appState: require("./appstate.json") },
    {
      listenEvents: true,
      listenTyping: false,
      selfListen: false,
      autoMarkRead: true,
      online: true,
      emitReady: true,
      autoReconnect: true,
      stopOnSignals: true,
      commandPrefix: "/",
      // 1:1 DMs live on Facebook's E2EE backend, which the API can't write to.
      // When the API send fails on a DM, fall back to sending through the
      // logged-in Messenger browser tab (login auto-starts it on port 9222
      // with the bot profile — see dmhelper/).
      browserSend: { port: 9222 },
      // Watch EVERY incoming E2EE 1:1 DM — the bridge scans the inbox and
      // opens one watcher tab per conversation automatically. No partner
      // list needed. (Restrict it with `partners: [...]` if you ever want
      // selected conversations only.)
      dmBridge: {
        // Watch every E2EE conversation found in the one-time startup scan.
        // Message delivery then uses the dedicated watcher for each thread.
        pollMs: 250,
        rescanMs: 0
      }
    }
  );

  bot.on("error", (err) => {
    // The library routes the MQTT `ready` signal through the error slot
    if (err && err.type === "ready") {
      console.log("[bot] Connected to Messenger. Listening...");
      return;
    }
    console.error("[bot] Error:", err);
  });

  bot.on("message", (event) => {
    const { threadID, senderID, body } = event;
    if (!body) return;
    console.log(`[${threadID}] from ${senderID}: ${body}`);
  });

  // "/ping" (command prefix) AND bare "ping" — DM users don't type prefixes.
  bot.hears(/^\/?ping$/i, async (ctx) => {
    console.log(`[dm-reply] ping received from ${ctx.senderID}`);
    await ctx.replyAsync("pong");
  });

  bot.hears(/^hi$/i, async (ctx) => {
    console.log(`[dm-reply] hi received from ${ctx.senderID}`);
    await ctx.replyAsync("Hello there!");
  });

  // Auto-accept message requests so DMs from non-friends work too
  acceptMessageRequests(bot);
  setInterval(() => acceptMessageRequests(bot), REQUEST_POLL_MS);
}

main().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
