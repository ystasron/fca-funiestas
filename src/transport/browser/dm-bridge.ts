/**
 * In-library E2EE DM bridge (ported from dmhelper/dm-bridge.js).
 *
 * Watches the open E2EE 1:1 chat in the bot's browser tab, emits DM events
 * in the same shape as API messages, and answers commands through the
 * composer (the page's Armadillo worker encrypts). Self-heals through the
 * walls a Messenger session can show: login, "Continue as", PIN restore,
 * wrong/missing thread.
 *
 * Usage (login already ran ensureBrowserForDms):
 *   const bridge = createDmBridge({ port: 9222, selfID, partners, targetUserID });
 *   bridge.on("message", ({ threadID, senderID, body }) => …);
 *   bridge.start();
 */

import type { CdpSession } from "./cdp-session";
import {
  evaluateOn,
  listPages,
  openPage,
  attachTo,
  type PageTarget
} from "./cdp-session";

export interface DmBridgePartner {
  /** Display name as shown in the chat header/sidebar. */
  name: string;
  /** FB user ID. */
  userID: string;
}

export interface DmBridgeOptions {
  /** CDP port of the bot's Chromium (default 9222). */
  port?: number;
  /** Bot's own FB user ID. */
  selfID: string;
  /** How Messenger labels the bot's own messages ("You"). */
  selfLabel?: string;
  /** DM partners to bridge: display name -> user ID. */
  partners: DmBridgePartner[];
  /** E2EE thread key (auto-detected from the open tab when omitted). */
  threadKey?: string | null;
  /** Open a dedicated tab for this partner instead of reusing an existing tab. */
  targetUserID?: string;
  /** Open this exact URL instead of deriving it from targetUserID (auto mode). */
  targetURL?: string;
  /**
   * When true (auto mode), a bridge whose thread turns out NOT to be an
   * E2EE 1:1 chat (e.g. a group) stops itself — groups arrive via MQTT and
   * would be double-handled.
   */
  requireE2ee?: boolean;
  /** Called when the bridge gives up (recovery exhausted / tab closed). */
  onDead?: () => void;
  /** Poll interval ms (default 1500). */
  pollMs?: number;
  /** Optional logger (library logger signature). */
  log?: (text: string, type?: string) => void;
}

export interface DmBridgeMessageEvent {
  threadID: string;
  senderID: string;
  body: string;
}

type Listener<T> = (payload: T) => void;

type SendResult = "sent" | "no-composer" | "clear-failed" | "composer-not-empty" | "not-started";

interface DmBridgeImpl {
  onMessage(fn: Listener<DmBridgeMessageEvent>): void;
  start(): void;
  stop(): void;
  /** Type `text` into the open composer and press Enter. */
  reply(text: string): Promise<SendResult>;
  /** Resolve config (e.g. detected thread key) — mainly for diagnostics. */
  getThreadKey(): string | null;
}

const COMPOSER_SELECTOR = '[contenteditable="true"][role="textbox"]';

/** Snapshot the page: url, composer, PIN wall, Continue wall, login wall. */
async function pageState(session: CdpSession): Promise<Loose | null> {
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

function parseMessageButton(name: string): { sender: string; body: string } | null {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Drive the page from anywhere to the E2EE thread, handling known walls. */
async function ensureThreadOpen(
  session: CdpSession,
  config: { selfLabel: string; partners: DmBridgePartner[]; threadKey: string | null; setThreadKey(k: string): void },
  log: (line: string) => void
): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const st = await pageState(session);
    if (!st) {
      await sleep(2000);
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
        log("PIN wall shown, no skip option — enter the PIN once in the browser (or tunnel in). Waiting...");
        await sleep(10000);
        continue;
      }
      log(`PIN wall: ${acted}`);
      await sleep(2000);
      await evaluateOn(session, `(() => {
        const els = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const b = els.find((e) => /^(Restore|Continue|Confirm)$/i.test((e.textContent || "").trim()));
        if (b) b.click();
      })()`).catch(() => {});
      await sleep(5000);
      continue;
    }

    if (st.continueWall) {
      await evaluateOn(session, `(() => {
        const els = Array.from(document.querySelectorAll('div[role="button"], button, a'));
        const b = els.find((e) => /Continue as /i.test((e.textContent || "") + " " + (e.getAttribute("aria-label") || "")));
        if (b) b.click();
      })()`).catch(() => {});
      log("clicked 'Continue as <account>'");
      await sleep(6000);
      continue;
    }

    if (st.loginWall) {
      log("NOT LOGGED IN — run npx @dongdev/fca-dm-login (see its output for the tunnel instructions)");
      await sleep(15000);
      continue;
    }

    // An E2EE page can have the correct URL before Armadillo mounts the
    // composer. Do not navigate it again: that interrupts initialization and
    // leaves the watcher stuck in this loop.
    const currentThread = String(st.url).match(/\/e2ee\/t\/(\d+)/)?.[1];
    const requestedThread = config.threadKey || String(st.url).match(/\/e2ee\/t\/(\d+)/)?.[1];
    if (currentThread && requestedThread === currentThread) {
      await sleep(1000);
      continue;
    }

    // Logged in, no composer: open the thread via the sidebar (direct /t/ URLs stall).
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
        await session.send("Page.enable").catch(() => {});
        await session.send("Page.navigate", {
          url: config.threadKey
            ? `https://www.messenger.com/e2ee/t/${config.threadKey}/`
            : `https://www.messenger.com/t/${fallbackID}`
        }).catch(() => {});
      }
      log("navigating to the DM thread...");
    }
    await sleep(6000);
  }
  return false;
}

/** Send text through the composer with trusted CDP input. */
async function sendText(session: CdpSession, text: string): Promise<SendResult> {
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

  // Messenger's editor accepts this DOM command and keeps its React state in
  // sync; raw CDP Control+A/Backspace events are not reliable here.
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
    type: "keyDown", key: "Enter", code: "Enter",
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
  });
  await session.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Enter", code: "Enter",
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
  });
  // The draft can remain mounted briefly after Messenger accepts the send.
  await sleep(250);
  return "sent";
}

/** Collect message rows from the accessibility tree. */
async function collectMessages(session: CdpSession): Promise<{ id: number; name: string }[]> {
  const { nodes } = await session.send("Accessibility.getFullAXTree");
  const out: { id: number; name: string }[] = [];
  for (const n of nodes as Loose[]) {
    const role = (n as { role?: { value?: string } }).role?.value;
    const name = (n as { name?: { value?: string } }).name?.value;
    if (
      (role === "button" || role === "generic") &&
      typeof name === "string" &&
      name.startsWith("Enter, Message sent")
    ) {
      const id = (n as { backendDOMNodeId?: number }).backendDOMNodeId;
      if (id != null) out.push({ id, name });
    }
  }
  return out;
}

/** Create a DM bridge bound to the bot's browser. */
export function createDmBridge(options: DmBridgeOptions): DmBridgeImpl {
  const port = options.port || 9222;
  const selfLabel = options.selfLabel || "You";
  const pollMs = options.pollMs || 1500;
  const log = options.log
    ? (line: string) => options.log!(`[dm-bridge] ${line}`)
    : (line: string) => console.log(`[dm-bridge] ${line}`);

  let threadKey = options.threadKey || null;
  const listeners: Listener<DmBridgeMessageEvent>[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  const handledIds = new Set<number>();
  const handledNames = new Set<string>();
  const handledBodies = new Map<string, number>();
  const HANDLED_MAX = 500;
  let baselined = false;
  let activeSession: CdpSession | null = null;
  let replyQueue: Promise<SendResult> = Promise.resolve("not-started");
  let polling = false;

  function die(reason: string): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    log(`stopped: ${reason}`);
    options.onDead?.();
  }

  function resolveSender(sender: string): { isSelf: boolean; userID: string } | null {
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

  async function findMessengerPage(): Promise<PageTarget> {
    if (options.targetURL) {
      const wanted = options.targetURL.replace(/\/$/, "");
      const existing = (await listPages(port)).find(
        (page) => page.url.replace(/\/$/, "") === wanted
      );
      if (existing) return existing;
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

  async function poll(session: CdpSession): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const st = await pageState(session);
      if (!st) return;

      if (!st.composer) {
        const recovered = await ensureThreadOpen(
          session,
          { selfLabel, partners: options.partners, threadKey, setThreadKey: (k) => (threadKey = k) },
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
            url: threadKey
              ? `https://www.messenger.com/e2ee/t/${threadKey}/`
              : `https://www.messenger.com/t/${fallbackID}`
          }).catch(() => {});
          return;
        }
        // Auto mode: only E2EE 1:1 threads belong here. Groups come through
        // MQTT; watching them would double-handle messages.
        if (options.requireE2ee && !/\/e2ee\/t\//.test(String(st.url))) {
          die("thread is not E2EE (group or plain chat) — leaving it to MQTT");
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

      // Only surface the newest rendered message. Mark older rows handled so
      // delayed tab initialization cannot replay the whole conversation.
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
      // This bridge watches one active 1:1 conversation. Any non-self
      // sender in that conversation is allowed; partners are only used to
      // identify the thread and provide a fallback ID for display.
      if (who?.isSelf || parsed.sender === selfLabel) return;
      const senderID = who?.userID || options.partners[0]?.userID || threadKey || "0";
      const bodyKey = `${senderID}\u0000${parsed.body}`;
      const previousBody = handledBodies.get(bodyKey);
      if (previousBody && Date.now() - previousBody < 3000) return;
      handledBodies.set(bodyKey, Date.now());
      for (const [key, timestamp] of handledBodies) {
        if (Date.now() - timestamp >= 3000) handledBodies.delete(key);
      }
      for (const fn of listeners) {
        fn({ threadID: threadKey || "e2ee", senderID, body: parsed.body });
      }
    } catch (e) {
      const err = e as Loose;
      const msg = String(err?.error || err?.message || e);
      if (!/Target closed|Execution context was destroyed|CDP connection closed/.test(msg)) {
        log(`poll error: ${msg}`);
      }
    } finally {
      polling = false;
    }
  }

  async function sendWhenReady(session: CdpSession, text: string): Promise<SendResult> {
    let result: SendResult = "not-started";
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
            await session.send("Page.enable").catch(() => {});
            await session.send("Accessibility.enable");
            const ok = await ensureThreadOpen(
              session,
              { selfLabel, partners: options.partners, threadKey, setThreadKey: (k) => (threadKey = k) },
              log
            );
            if (!ok) {
              lastError = "could not reach the E2EE thread after retries";
              break;
            }
            const st = await pageState(session);
            if (options.requireE2ee && st && !/\/e2ee\/t\//.test(String(st.url))) {
              die("thread is not E2EE (group or plain chat) — leaving it to MQTT");
              return;
            }
            log(`watching: ${st.url} | thread=${threadKey || "unknown"}`);
            timer = setInterval(() => void poll(session), pollMs);
            // Do not wait for the first interval tick after the thread is ready.
            void poll(session);
            log("running. Waiting for DMs...");
          } catch (e) {
            const err = e as Loose;
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
      replyQueue = replyQueue
        .catch(() => "not-started")
        .then(() => sendWhenReady(session, text));
      return await replyQueue;
    },
    getThreadKey() {
      return threadKey;
    }
  };
}

// ---------------------------------------------------------------------------
// Auto mode: discover every 1:1 conversation from the inbox sidebar.
// ---------------------------------------------------------------------------

export interface AutoDmBridgeOptions {
  /** CDP port of the bot's Chromium (default 9222). */
  port?: number;
  /** Bot's own FB user ID. */
  selfID: string;
  /** Max conversation tabs kept open at once (default 15, FIFO eviction). */
  maxTabs?: number;
  /** How often to rescan the inbox for new conversations (default 60s). */
  rescanMs?: number;
  /** Per-thread poll interval (default 1500ms). */
  pollMs?: number;
  /** Optional logger (library logger signature). */
  log?: (text: string, type?: string) => void;
}

export interface AutoDmBridgeImpl {
  onMessage(fn: Listener<DmBridgeMessageEvent & { dmBridge: Loose }>): void;
  start(): void;
  stop(): void;
  /** Reply in a specific conversation (thread key -> its watcher). */
  replyIn(threadKey: string, text: string): Promise<SendResult | "unknown-thread">;
  /** Conversation keys currently watched. */
  watchedThreads(): string[];
}

/**
 * Scan the inbox sidebar of a Messenger tab and return its conversation links.
 * Links look like /t/<id> or /e2ee/t/<id>; hrefs are the only stable identity.
 */
async function scanInboxLinks(session: CdpSession): Promise<string[]> {
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
  return Array.isArray(links) ? (links as string[]) : [];
}

/**
 * Auto DM bridge: watches the Messenger inbox, opens one watcher tab per
 * discovered conversation (E2EE 1:1 only — groups stay on MQTT), re-emits
 * incoming DMs, and rescans for new conversations periodically. No partner
 * list needed; everyone with an existing conversation gets covered.
 */
export function createAutoDmBridge(options: AutoDmBridgeOptions): AutoDmBridgeImpl {
  const port = options.port || 9222;
  const maxTabs = options.maxTabs || 15;
  const rescanMs = options.rescanMs ?? 60000;
  const log = options.log
    ? (line: string) => options.log!(`[dm-auto] ${line}`)
    : (line: string) => console.log(`[dm-auto] ${line}`);

  const listeners: Listener<DmBridgeMessageEvent & { dmBridge: Loose }>[] = [];
  const watchers = new Map<string, { bridge: DmBridgeImpl; url: string }>();
  let inboxSession: CdpSession | null = null;
  let rescanTimer: ReturnType<typeof setInterval> | null = null;
  let scanning = false;

  function threadKeyFromUrl(url: string): string | null {
    const m = url.match(/\/(?:e2ee\/)?t\/(\d+)/);
    return m ? m[1] : null;
  }

  async function ensureInbox(): Promise<CdpSession | null> {
    try {
      const pages = await listPages(port);
      let inbox = pages.find((p) => /messenger\.com\/?(\?.*)?$/.test(p.url));
      if (!inbox) {
        inbox = await openPage(port, "https://www.messenger.com/");
        await sleep(8000); // let the sidebar load
      }
      if (!inboxSession || inboxSession.closed) {
        inboxSession = await attachTo(inbox);
        await inboxSession.send("Page.enable").catch(() => {});
      }
      return inboxSession;
    } catch (e) {
      const err = e as Loose;
      log(`inbox unavailable: ${String(err?.error || err?.message || e)}`);
      return null;
    }
  }

  async function rescan(): Promise<void> {
    if (scanning) return;
    scanning = true;
    try {
       const session = await ensureInbox();
       if (!session) return;

       // Messenger often renders the inbox as a client-side tree without
       // conversation anchors. Reuse any E2EE page targets Chrome already has
       // open, which is also the reliable source of thread keys.
       const openE2eeUrls = (await listPages(port))
         .filter((page) => /messenger\.com\/e2ee\/t\/\d+/.test(page.url))
         .map((page) => page.url);

       // Login can complete before Messenger has mounted the inbox links. In
       // one-time mode, wait for that initial render instead of returning with
       // zero watchers and never getting another chance to attach them.
       let links: string[] = [];
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

      // The sidebar lists the same conversation under several URL shapes
      // (/t/X, /e2ee/t/X, plus marketplace/requests/archived variants).
      // Normalize to a plain conversation URL, prefer the e2ee form, drop
      // non-chat sections.
      const byKey = new Map<string, string>();
      for (const url of links) {
        if (/\/(marketplace|requests|archived)\//.test(url)) continue;
        const key = threadKeyFromUrl(url);
        if (!key) continue;
        const prev = byKey.get(key);
        if (!prev || (!/\/e2ee\//.test(prev) && /\/e2ee\//.test(url))) {
          byKey.set(key, url);
        }
      }

      // FIFO eviction when over budget
      const fresh: string[] = [];
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
          } catch {}
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
            const key = threadKeyFromUrl(url);
            if (key) watchers.delete(key);
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
      const err = e as Loose;
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
        log(`auto mode on — inbox scan every ${Math.round(rescanMs / 1000)}s, max ${maxTabs} tabs`);
      } else {
        log(`auto mode on — one-time inbox scan, max ${maxTabs} tabs`);
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
        } catch {}
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
