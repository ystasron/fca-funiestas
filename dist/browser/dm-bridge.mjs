import {
  attachTo,
  evaluateOn,
  listPages,
  openPage
} from "./chunk-GMZ4DLVL.mjs";

// src/transport/browser/dm-bridge.ts
var COMPOSER_SELECTOR = '[contenteditable="true"][role="textbox"]';
async function pageState(session) {
  return evaluateOn(session, `(() => {
    const text = (document.body && document.body.innerText) || "";
    return {
      url: location.href,
      composer: !!document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)}),
      pinWall: /Enter your PIN to restore your chats/i.test(text),
      continueWall: /Continue as /i.test(text.slice(0, 1500)),
      loginWall: /\\bLog in\\b/i.test(text.slice(0, 1500)) && !document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)})
    };
  })()`);
}
function parseMessageButton(name) {
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
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ensureThreadOpen(session, config, log) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const st = await pageState(session);
    if (!st) {
      await sleep(2e3);
      continue;
    }
    if (st.composer) {
      const m = String(st.url).match(/\/(?:e2ee\/)?t\/(\d+)/);
      if (m && !config.threadKey) config.setThreadKey(m[1]);
      return true;
    }
    if (st.pinWall) {
      const acted = await evaluateOn(session, `(() => {
        const els = Array.from(document.querySelectorAll('button, div[role="button"], a'));
        const b = els.find((e) => /without (your )?pin|forgot pin|skip/i.test((e.textContent || "").trim()));
        if (b) { b.click(); return "clicked:" + (b.textContent || "").trim().slice(0, 30); }
        return null;
      })()`);
      if (!acted) {
        log("PIN wall shown, no skip option \u2014 enter the PIN once in the browser (or tunnel in). Waiting...");
        await sleep(1e4);
        continue;
      }
      log(`PIN wall: ${acted}`);
      await sleep(2e3);
      await evaluateOn(session, `(() => {
        const els = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const b = els.find((e) => /^(Restore|Continue|Confirm)$/i.test((e.textContent || "").trim()));
        if (b) b.click();
      })()`).catch(() => {
      });
      await sleep(5e3);
      continue;
    }
    if (st.continueWall) {
      await evaluateOn(session, `(() => {
        const els = Array.from(document.querySelectorAll('div[role="button"], button, a'));
        const b = els.find((e) => /Continue as /i.test((e.textContent || "") + " " + (e.getAttribute("aria-label") || "")));
        if (b) b.click();
      })()`).catch(() => {
      });
      log("clicked 'Continue as <account>'");
      await sleep(6e3);
      continue;
    }
    if (st.loginWall) {
      log("NOT LOGGED IN \u2014 run npx @dongdev/fca-dm-login (see its output for the tunnel instructions)");
      await sleep(15e3);
      continue;
    }
    const currentThread = String(st.url).match(/\/e2ee\/t\/(\d+)/)?.[1];
    const requestedThread = config.threadKey || String(st.url).match(/\/e2ee\/t\/(\d+)/)?.[1];
    if (currentThread && requestedThread === currentThread) {
      await sleep(1e3);
      continue;
    }
    const clicked = await evaluateOn(session, `(() => {
      const cands = Array.from(document.querySelectorAll('a, div[role="button"], [role="link"]'));
      const wanted = ${JSON.stringify(config.partners.map((p) => p.name))};
      const el = cands.find((e) => {
        const t = (e.textContent || "").trim();
        return wanted.some((w) => new RegExp("^" + w.split(" ")[0] + "\\\\b", "i").test(t)) && t.length < 80;
      });
      if (el) { el.click(); return el.textContent.trim().slice(0, 40); }
      return null;
    })()`).catch(() => null);
    if (clicked) {
      log(`clicked sidebar conversation: "${clicked}"`);
    } else {
      const fallbackID = config.partners[0] && config.partners[0].userID;
      if (config.threadKey || fallbackID) {
        await session.send("Page.enable").catch(() => {
        });
        await session.send("Page.navigate", {
          url: config.threadKey ? `https://www.messenger.com/e2ee/t/${config.threadKey}/` : `https://www.messenger.com/t/${fallbackID}`
        }).catch(() => {
        });
      }
      log("navigating to the DM thread...");
    }
    await sleep(6e3);
  }
  return false;
}
async function sendText(session, text) {
  const focused = await evaluateOn(
    session,
    `(() => {
      const el = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
      if (!el) return "no-composer";
      el.focus();
      return document.activeElement === el ? "focused" : "focus-failed";
    })()`
  );
  if (focused === "no-composer") return "no-composer";
  if (focused !== "focused") return "clear-failed";
  const cleared = await evaluateOn(
    session,
    `(() => {
      const el = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
      if (!el) return "no-composer";
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      return "ready";
    })()`
  );
  if (cleared === "no-composer") return "no-composer";
  await session.send("Input.insertText", { text });
  await sleep(300);
  await session.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
  await session.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
  await sleep(250);
  return "sent";
}
async function collectMessages(session) {
  const { nodes } = await session.send("Accessibility.getFullAXTree");
  const out = [];
  for (const n of nodes) {
    const role = n.role?.value;
    const name = n.name?.value;
    if ((role === "button" || role === "generic") && typeof name === "string" && name.startsWith("Enter, Message sent")) {
      const id = n.backendDOMNodeId;
      if (id != null) out.push({ id, name });
    }
  }
  return out;
}
function createDmBridge(options) {
  const port = options.port || 9222;
  const selfLabel = options.selfLabel || "You";
  const pollMs = options.pollMs || 1500;
  const log = options.log ? (line) => options.log(`[dm-bridge] ${line}`) : (line) => console.log(`[dm-bridge] ${line}`);
  let threadKey = options.threadKey || null;
  const listeners = [];
  let timer = null;
  const handledIds = /* @__PURE__ */ new Set();
  const handledNames = /* @__PURE__ */ new Set();
  const handledBodies = /* @__PURE__ */ new Map();
  const HANDLED_MAX = 500;
  let baselined = false;
  let activeSession = null;
  let replyQueue = Promise.resolve("not-started");
  let polling = false;
  function die(reason) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    log(`stopped: ${reason}`);
    options.onDead?.();
  }
  function resolveSender(sender) {
    if (sender === selfLabel) return { isSelf: true, userID: options.selfID };
    for (const p of options.partners) {
      const full = p.name.toLowerCase();
      const short = sender.toLowerCase();
      if (full === short || full.startsWith(short) || short.startsWith(full)) {
        return { isSelf: false, userID: p.userID };
      }
    }
    return null;
  }
  async function findMessengerPage() {
    if (options.targetURL) {
      const wanted = options.targetURL.replace(/\/$/, "");
      const existing2 = (await listPages(port)).find(
        (page) => page.url.replace(/\/$/, "") === wanted
      );
      if (existing2) return existing2;
      return await openPage(port, options.targetURL);
    }
    if (options.targetUserID) {
      return await openPage(port, `https://www.messenger.com/t/${options.targetUserID}`);
    }
    const pages = await listPages(port);
    const existing = pages.find((p) => p.url.includes("messenger.com"));
    if (existing) return existing;
    return await openPage(port, "https://www.messenger.com");
  }
  async function poll(session) {
    if (polling) return;
    polling = true;
    try {
      const st = await pageState(session);
      if (!st) return;
      if (!st.composer) {
        const recovered = await ensureThreadOpen(
          session,
          { selfLabel, partners: options.partners, threadKey, setThreadKey: (k) => threadKey = k },
          log
        );
        if (!recovered) {
          die("thread recovery failed");
          return;
        }
      } else {
        const m = String(st.url).match(/\/(?:e2ee\/)?t\/(\d+)/);
        const onRightThread = m && (!threadKey || m[1] === threadKey);
        if (!onRightThread) {
          const fallbackID = options.partners[0] && options.partners[0].userID;
          await session.send("Page.navigate", {
            url: threadKey ? `https://www.messenger.com/e2ee/t/${threadKey}/` : `https://www.messenger.com/t/${fallbackID}`
          }).catch(() => {
          });
          return;
        }
        if (options.requireE2ee && !/\/e2ee\/t\//.test(String(st.url))) {
          die("thread is not E2EE (group or plain chat) \u2014 leaving it to MQTT");
          return;
        }
      }
      const rows = await collectMessages(session);
      if (!rows.length) {
        if (process.env.DM_BRIDGE_DEBUG) log("poll: no message rows currently rendered");
        return;
      }
      if (!baselined) {
        for (const row of rows) {
          handledIds.add(row.id);
          handledNames.add(row.name);
        }
        baselined = true;
        return;
      }
      const newRows = rows.filter(
        (row) => !handledIds.has(row.id) && !handledNames.has(row.name)
      );
      if (!newRows.length) return;
      const newest = newRows[newRows.length - 1];
      for (const row of newRows) {
        handledIds.add(row.id);
        handledNames.add(row.name);
      }
      while (handledIds.size > HANDLED_MAX) {
        const oldest = handledIds.values().next().value;
        if (oldest == null) break;
        handledIds.delete(oldest);
      }
      while (handledNames.size > HANDLED_MAX) {
        const oldest = handledNames.values().next().value;
        if (oldest == null) break;
        handledNames.delete(oldest);
      }
      const parsed = parseMessageButton(newest.name);
      if (!parsed) return;
      const who = resolveSender(parsed.sender);
      if (who?.isSelf || parsed.sender === selfLabel) return;
      const senderID = who?.userID || options.partners[0]?.userID || threadKey || "0";
      const bodyKey = `${senderID}\0${parsed.body}`;
      const previousBody = handledBodies.get(bodyKey);
      if (previousBody && Date.now() - previousBody < 3e3) return;
      handledBodies.set(bodyKey, Date.now());
      for (const [key, timestamp] of handledBodies) {
        if (Date.now() - timestamp >= 3e3) handledBodies.delete(key);
      }
      for (const fn of listeners) {
        fn({ threadID: threadKey || "e2ee", senderID, body: parsed.body });
      }
    } catch (e) {
      const err = e;
      const msg = String(err?.error || err?.message || e);
      if (!/Target closed|Execution context was destroyed|CDP connection closed/.test(msg)) {
        log(`poll error: ${msg}`);
      }
    } finally {
      polling = false;
    }
  }
  async function sendWhenReady(session, text) {
    let result = "not-started";
    for (let attempt = 0; attempt < 20; attempt++) {
      result = await sendText(session, text);
      if (result === "sent") return result;
      if (result !== "no-composer" && result !== "clear-failed") return result;
      await sleep(250);
    }
    return result;
  }
  return {
    onMessage(fn) {
      listeners.push(fn);
    },
    start() {
      if (timer) return;
      void (async () => {
        let lastError = "unknown startup error";
        for (let attempt = 0; attempt < 20 && !timer; attempt++) {
          try {
            const page = await findMessengerPage();
            const session = await attachTo(page);
            activeSession = session;
            await session.send("Page.enable").catch(() => {
            });
            await session.send("Accessibility.enable");
            const ok = await ensureThreadOpen(
              session,
              { selfLabel, partners: options.partners, threadKey, setThreadKey: (k) => threadKey = k },
              log
            );
            if (!ok) {
              lastError = "could not reach the E2EE thread after retries";
              break;
            }
            const st = await pageState(session);
            if (options.requireE2ee && st && !/\/e2ee\/t\//.test(String(st.url))) {
              die("thread is not E2EE (group or plain chat) \u2014 leaving it to MQTT");
              return;
            }
            log(`watching: ${st.url} | thread=${threadKey || "unknown"}`);
            timer = setInterval(() => void poll(session), pollMs);
            void poll(session);
            log("running. Waiting for DMs...");
          } catch (e) {
            const err = e;
            lastError = String(err?.error || err?.message || e);
            if (!/default execution context|Execution context was destroyed/i.test(lastError)) break;
            await sleep(500);
          }
        }
        if (!timer) log(`failed to start: ${lastError}`);
      })();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      log("stopped");
    },
    async reply(text) {
      if (!activeSession || activeSession.closed) return "not-started";
      const session = activeSession;
      replyQueue = replyQueue.catch(() => "not-started").then(() => sendWhenReady(session, text));
      return await replyQueue;
    },
    getThreadKey() {
      return threadKey;
    }
  };
}
async function scanInboxLinks(session) {
  const links = await evaluateOn(
    session,
    `(() => {
      const out = [];
      for (const a of document.querySelectorAll('a[href*="/t/"]')) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\\/(?:e2ee\\/)?t\\/(\\d+)/);
        if (m) out.push("https://www.messenger.com" + (href.startsWith("/") ? href : "/" + href));
      }
      return Array.from(new Set(out));
    })()`
  );
  return Array.isArray(links) ? links : [];
}
function createAutoDmBridge(options) {
  const port = options.port || 9222;
  const maxTabs = options.maxTabs || 15;
  const rescanMs = options.rescanMs ?? 6e4;
  const log = options.log ? (line) => options.log(`[dm-auto] ${line}`) : (line) => console.log(`[dm-auto] ${line}`);
  const listeners = [];
  const watchers = /* @__PURE__ */ new Map();
  let inboxSession = null;
  let rescanTimer = null;
  let scanning = false;
  function threadKeyFromUrl(url) {
    const m = url.match(/\/(?:e2ee\/)?t\/(\d+)/);
    return m ? m[1] : null;
  }
  async function ensureInbox() {
    try {
      const pages = await listPages(port);
      let inbox = pages.find((p) => /messenger\.com\/?(\?.*)?$/.test(p.url));
      if (!inbox) {
        inbox = await openPage(port, "https://www.messenger.com/");
        await sleep(8e3);
      }
      if (!inboxSession || inboxSession.closed) {
        inboxSession = await attachTo(inbox);
        await inboxSession.send("Page.enable").catch(() => {
        });
      }
      return inboxSession;
    } catch (e) {
      const err = e;
      log(`inbox unavailable: ${String(err?.error || err?.message || e)}`);
      return null;
    }
  }
  async function rescan() {
    if (scanning) return;
    scanning = true;
    try {
      const session = await ensureInbox();
      if (!session) return;
      const openE2eeUrls = (await listPages(port)).filter((page) => /messenger\.com\/e2ee\/t\/\d+/.test(page.url)).map((page) => page.url);
      let links = [];
      const attempts = rescanMs > 0 ? 1 : 20;
      for (let attempt = 0; attempt < attempts && !links.length; attempt++) {
        links = await scanInboxLinks(session);
        if (!links.length && attempt + 1 < attempts) await sleep(500);
      }
      links.push(...openE2eeUrls);
      if (!links.length) {
        log("no Messenger conversation links or open E2EE tabs found");
        return;
      }
      const byKey = /* @__PURE__ */ new Map();
      for (const url of links) {
        if (/\/(marketplace|requests|archived)\//.test(url)) continue;
        const key = threadKeyFromUrl(url);
        if (!key) continue;
        const prev = byKey.get(key);
        if (!prev || !/\/e2ee\//.test(prev) && /\/e2ee\//.test(url)) {
          byKey.set(key, url);
        }
      }
      const fresh = [];
      for (const url of byKey.values()) {
        const key = threadKeyFromUrl(url);
        if (!key || watchers.has(key)) continue;
        fresh.push(url);
      }
      log(`discovered ${byKey.size} conversation(s), ${fresh.length} new watcher(s)`);
      if (!fresh.length) return;
      for (const url of fresh) {
        while (watchers.size >= maxTabs) {
          const oldest = watchers.keys().next().value;
          if (oldest == null) break;
          const w = watchers.get(oldest);
          watchers.delete(oldest);
          try {
            w?.bridge.stop();
          } catch {
          }
          log(`evicted watcher ${oldest} (max ${maxTabs} tabs)`);
        }
        const bridge = createDmBridge({
          port,
          selfID: options.selfID,
          partners: [],
          targetURL: url,
          requireE2ee: true,
          pollMs: options.pollMs,
          log: options.log,
          onDead: () => {
            const key2 = threadKeyFromUrl(url);
            if (key2) watchers.delete(key2);
          }
        });
        bridge.onMessage((event) => {
          for (const fn of listeners) {
            fn({ ...event, dmBridge: bridge });
          }
        });
        bridge.start();
        const key = threadKeyFromUrl(url);
        if (key) {
          watchers.set(key, { bridge, url });
          log(`watching conversation ${key}`);
        }
      }
      if (fresh.length) log(`scan: ${watchers.size} conversations watched`);
    } catch (e) {
      const err = e;
      log(`scan error: ${String(err?.error || err?.message || e)}`);
    } finally {
      scanning = false;
    }
  }
  return {
    onMessage(fn) {
      listeners.push(fn);
    },
    start() {
      if (rescanTimer) return;
      void rescan();
      if (rescanMs > 0) {
        rescanTimer = setInterval(() => void rescan(), rescanMs);
        log(`auto mode on \u2014 inbox scan every ${Math.round(rescanMs / 1e3)}s, max ${maxTabs} tabs`);
      } else {
        log(`auto mode on \u2014 one-time inbox scan, max ${maxTabs} tabs`);
      }
    },
    stop() {
      if (rescanTimer) {
        clearInterval(rescanTimer);
        rescanTimer = null;
      }
      for (const { bridge } of watchers.values()) {
        try {
          bridge.stop();
        } catch {
        }
      }
      watchers.clear();
      inboxSession?.close();
      inboxSession = null;
      log("stopped");
    },
    async replyIn(threadKey, text) {
      const w = watchers.get(threadKey);
      if (!w) return "unknown-thread";
      return await w.bridge.reply(text);
    },
    watchedThreads() {
      return Array.from(watchers.keys());
    }
  };
}
export {
  createAutoDmBridge,
  createDmBridge
};
