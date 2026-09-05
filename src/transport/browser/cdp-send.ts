/**
 * Browser (CDP) DM sender.
 *
 * 1:1 personal messages now run on Facebook's "Armadillo" E2EE backend, which
 * the classic mercury/MQTT send paths cannot write to ("Thread Disabled",
 * occam_thread:null). The one reliable way to send a DM is through a real
 * Messenger tab logged in as the account — the page's Armadillo worker does
 * all the encryption.
 *
 * This module drives such a tab over the Chrome DevTools Protocol using only
 * dependencies the library already ships (`ws` + node http). It:
 *   1. opens a new tab at https://www.messenger.com/t/<userID> (Messenger
 *      redirects E2EE conversations to /e2ee/t/<threadKey>/),
 *   2. waits for the composer,
 *   3. types the message with trusted input and presses Enter,
 *   4. returns the resolved E2EE thread key + a synthetic message id.
 *
 * The browser itself is managed by the library (see profile.ts / launcher.ts
 * / index.ts): when `browserSend` is enabled, login verifies the bot profile
 * exists ("run fca-dm-login first" otherwise) and launches headless Chromium
 * with it on the debug port.
 */

import {
  httpRequest,
  openPage,
  closePage,
  attachTo,
  evaluateOn,
  type CdpSession
} from "./cdp-session";

export interface BrowserDmSenderDeps {
  /** Chrome remote-debugging port. Defaults to 9222. */
  port?: number;
  logError?: (scope: string, error: Loose) => void;
}

export interface BrowserDmSendParams {
  /** FB user ID to DM (NOT a group thread ID). */
  threadID: string;
  body: string;
}

export interface BrowserDmSendResult {
  body: string | null;
  messageID: string | null;
  threadID: string | null;
  /** Extra detail for logs. */
  detail?: string;
}

const DEFAULT_PORT = 9222;
const COMPOSER_SELECTOR = '[contenteditable="true"][role="textbox"]';

/** Poll until the chat composer exists; click past the "Continue" wall if shown. */
async function waitForComposer(session: CdpSession, timeoutMs: number): Promise<Loose> {
  const deadline = Date.now() + timeoutMs;
  let lastState: Loose = {};
  while (Date.now() < deadline) {
    lastState = await evaluateOn(
      session,
      `(() => {
        const el = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
        const bodyText = (document.body && document.body.innerText || "").slice(0, 2000);
        // Some sessions land on a "Continue" resume wall before the chat opens.
        let clicked = false;
        const btn = Array.from(document.querySelectorAll("div[role=button], button"))
          .find((b) => (b.textContent || "").trim() === "Continue");
        if (btn && !el && /Keep me signed in|Continue/.test(bodyText)) {
          btn.click();
          clicked = true;
        }
        return { has: !!el, url: location.href, clicked };
      })()`
    );
    if (lastState.has) {
      return { ok: true, url: lastState.url };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: false, reason: `timed out waiting for composer (last url: ${lastState.url || "?"})` };
}

/** Focus + clear the composer, type text, press Enter, confirm it left. */
async function typeAndSend(
  session: CdpSession,
  text: string
): Promise<{ ok: boolean; reason?: string }> {
  const cleared = await evaluateOn(
    session,
    `(() => {
      const el = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
      if (!el) return false;
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      return el.textContent.length === 0;
    })()`
  );
  if (!cleared) return { ok: false, reason: "could not clear composer" };

  await session.send("Input.insertText", { text });
  await new Promise((r) => setTimeout(r, 400));
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

  // Give Messenger a moment to send, then confirm the composer emptied.
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const content: Loose = await evaluateOn(
      session,
      `(() => {
        const el = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)});
        return el ? el.textContent : null;
      })()`
    );
    if (content === "") {
      return { ok: true };
    }
  }
  return { ok: false, reason: "composer not empty after Enter" };
}

function extractThreadKey(url: string, fallback: string): string {
  const m = url.match(/\/(?:e2ee\/)?t\/(\d+)/);
  return m ? m[1] : fallback;
}

/**
 * Send one text DM to `userID` through a logged-in Messenger browser tab.
 * Throws an object with `.error` on failure (including when Chrome/CDP is not
 * reachable or the account is not logged in).
 */
export function createBrowserDmSender(deps: BrowserDmSenderDeps) {
  const port = deps.port || DEFAULT_PORT;

  return async function sendDmViaBrowser(params: BrowserDmSendParams): Promise<BrowserDmSendResult> {
    const { threadID: userID, body } = params;
    if (!/^\d{1,15}$/.test(String(userID))) {
      throw { error: `browser DM send expects a user ID, got "${userID}"` };
    }

    let targetId: string | null = null;
    let session: CdpSession | null = null;
    try {
      const target = await openPage(port, `https://www.messenger.com/t/${userID}`);
      targetId = target.id;
      session = await attachTo(target);
      await session.send("Runtime.enable");

      const ready = await waitForComposer(session, 45000);
      if (!ready.ok) {
        throw { error: ready.reason };
      }

      const sent = await typeAndSend(session, body);
      if (!sent.ok) {
        throw { error: `browser send failed: ${sent.reason}` };
      }

      const url: string = (await evaluateOn(session, "location.href")) || "";
      const threadKey = extractThreadKey(url, String(userID));
      const messageID = `browser.${Date.now()}`;
      return {
        body: body || null,
        messageID,
        threadID: threadKey,
        detail: `browser thread ${threadKey}`
      };
    } catch (rawErr) {
      const err = rawErr as Loose;
      const msg = err && err.error ? err.error : err && err.message ? err.message : String(rawErr);
      throw { error: `browser DM send unavailable: ${msg}` };
    } finally {
      if (session) session.close();
      if (targetId) {
        void closePage(port, targetId);
      }
    }
  };
}

export default createBrowserDmSender;
