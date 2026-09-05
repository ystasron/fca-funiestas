/**
 * login-remote.js — get the VPS Chromium logged in to Messenger.
 *
 * IMPORTANT (learned the hard way while wiring this up):
 *   - Cookie injection from appstate.json does NOT work: Facebook's web
 *     frontend sessions are device-bound; valid API cookies still bounce to
 *     login.php in the browser.
 *   - Automated form login in headless mode triggers an Arkose Labs captcha
 *     that scripts cannot reliably pass.
 *
 * The flow that works: run Chromium HEADED once (visible window), log in by
 * hand (captcha + 2FA as a human), and the session persists in
 * dmhelper/bot-profile/ forever after. On a VPS, do it over an SSH tunnel.
 *
 * This script therefore helps with two things:
 *   1. HEADED SETUP (local or tunneled VPS): it opens the login page in the
 *      already-running Chrome and waits until it detects a logged-in session.
 *   2. COOKIES+FORM fallback (kept for completeness, may hit the captcha).
 *
 * Usage (Chrome from start-chrome.sh must already be running on :9222):
 *   node dmhelper/login-remote.js                    # wait-for-manual-login
 *   node dmhelper/login-remote.js --email a@b.c --password 'x'   # automated
 *   TOTP_SECRET=XXXX... node dmhelper/login-remote.js            # auto-2FA
 *
 * Headed window on a tunneled VPS (from your PC):
 *   ssh -L 9222:localhost:9222 user@vps   # keep open
 *   node dmhelper/login-remote.js          # run locally, login via the tunnel
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const {
  createTarget,
  closeTarget,
  attach,
  evaluate
} = require("./lib/cdp");

// ---------------------------------------------------------------- args ---
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};
const PORT = Number(arg("port")) || 9222;
const APPSTATE_PATH = path.join(__dirname, "..", "appstate.json");

// ------------------------------------------------------------ helpers ---
function ask(question, hidden) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (!hidden) {
      rl.question(question, (a) => { rl.close(); resolve(a); });
      return;
    }
    // hide password input (windows-compatible fallback: plain, shown once)
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume();
    let buf = "";
    const onData = (ch) => {
      if (ch[0] === 13 || ch[0] === 10) { // Enter
        stdin.setRawMode && stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        rl.close();
        process.stdout.write("\n");
        resolve(buf);
      } else if (ch[0] === 3) { // Ctrl+C
        process.exit(1);
      } else {
        buf += ch.toString("utf8");
      }
    };
    stdin.on("data", onData);
  });
}

function totp(secretBase32) {
  // Use the project's runtime dependency when available; skip TOTP otherwise.
  try {
    const totpGenerator = require(path.join(__dirname, "..", "node_modules", "totp-generator"));
    return totpGenerator.default(secretBase32);
  } catch {
    throw new Error("TOTP_SECRET set but totp-generator is not installed (npm install)");
  }
}

// Normalize appstate cookies ({key,name,domain,...} | {name,value,domain,...}).
function readAppstateCookies() {
  if (!fs.existsSync(APPSTATE_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(APPSTATE_PATH, "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.appState;
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((c) => c && (c.key || c.name) && (c.value != null || c.val != null))
      .map((c) => ({
        name: String(c.key || c.name),
        value: String(c.value != null ? c.value : c.val),
        domain: c.domain || ".facebook.com",
        path: c.path || "/",
        expires: typeof c.expires === "number" ? c.expires : undefined,
        secure: c.secure !== false,
        httpOnly: c.httpOnly !== false
      }));
  } catch {
    return null;
  }
}

// ------------------------------------------------- logged-in detection ---
async function isLoggedIn(session) {
  const state = await evaluate(
    session,
    `(() => {
      const text = (document.body && document.body.innerText) || "";
      return {
        url: location.href,
        loggedIn: !/\\b(Log in|Log In to Continue)\\b/.test(text.slice(0, 3000)) &&
                !!document.querySelector('[aria-label*="account"], [aria-label*="Account"]')
      };
    })()`
  ).catch(() => null);
  return !!(state && state.loggedIn);
}

// ---------------------------------- 0. wait for manual (headed) login ----
// The RELIABLE path: Chrome runs headed (or tunneled), a human logs in,
// this just watches until the session exists. Exits when it does.
async function waitForManualLogin() {
  const { findOrOpenPage } = require("./lib/cdp");
  const page = await findOrOpenPage(PORT, "facebook.com", "https://www.facebook.com/login");
  const session = await attach(page);
  await session.send("Page.enable").catch(() => {});

  console.log("[login] waiting for you to log in the Chrome window (captcha/2FA by hand)...");
  const deadline = Date.now() + 10 * 60 * 1000; // 10 minutes
  while (Date.now() < deadline) {
    if (await isLoggedIn(session)) {
      console.log("[login] session detected — you are logged in. Profile saved; this works headless from now on.");
      session.close();
      return true;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("[login] timed out waiting for manual login");
  session.close();
  return false;
}

// ------------------------------------------------- 1. cookie injection ---
async function tryCookieLogin() {
  const cookies = readAppstateCookies();
  if (!cookies || !cookies.length) {
    console.log("[login] no appstate.json cookies found — skipping cookie login");
    return false;
  }
  console.log(`[login] injecting ${cookies.length} appstate cookies into the browser...`);

  const target = await createTarget(PORT, "https://www.messenger.com");
  const session = await attach(target);
  try {
    await session.send("Network.enable");
    let ok = 0;
    for (const c of cookies) {
      try {
        const res = await session.send("Network.setCookie", {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          ...(c.expires ? { expires: c.expires } : {})
        });
        if (res && res.success) ok++;
      } catch {}
    }
    console.log(`[login] ${ok}/${cookies.length} cookies set — reloading messenger.com`);

    // Navigate with the fresh cookies and wait for the app to settle.
    await session.send("Page.enable");
    await session.send("Page.navigate", { url: "https://www.messenger.com" });
    await new Promise((r) => setTimeout(r, 8000));

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await isLoggedIn(session)) {
        console.log("[login] cookie session works — browser is logged in");
        return true;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log("[login] cookie session was rejected by the browser backend");
    return false;
  } catch (e) {
    console.log(`[login] cookie injection failed: ${(e && (e.error || e.message)) || e}`);
    return false;
  } finally {
    session.close();
    await closeTarget(PORT, target.id);
  }
}

// ---------------------------------------------------- 2. login form -----
const FILL_LOGIN_FORM = `(() => {
  const inputs = Array.from(document.querySelectorAll("input"));
  const email = inputs.find(i => /email|phone/i.test(i.name + " " + (i.id || "") + " " + i.type));
  const pass  = inputs.find(i => i.type === "password");
  if (!email || !pass) return "no-form";
  return { emailFound: true };
})()`;

async function setValue(session, selectorExpr, value) {
  // Native setter + events so React registers the change.
  await evaluate(
    session,
    `(() => {
      const el = ${selectorExpr};
      if (!el) return false;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`
  );
}

async function clickButton(session, texts) {
  return evaluate(
    session,
    `(() => {
      const wanted = ${JSON.stringify(texts)};
      const btn = Array.from(document.querySelectorAll('button, div[role="button"], input[type="submit"]'))
        .find(b => wanted.some(w => (b.textContent || b.value || "").trim().toLowerCase() === w));
      if (!btn) return false;
      btn.click();
      return true;
    })()`
  );
}

async function tryFormLogin() {
  let email = arg("email");
  let password = arg("password");

  console.log("[login] falling back to the login form (email + password)");
  if (!email) email = await ask("Account email or phone: ");
  if (!password) password = await ask("Password: ", true);
  if (!email || !password) {
    console.log("[login] email/password required for form login");
    return false;
  }

  const target = await createTarget(PORT, "https://www.facebook.com/login");
  const session = await attach(target);
  try {
    // Wait for the form
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      ready = await evaluate(session, FILL_LOGIN_FORM).then((r) => r && r.emailFound).catch(() => false);
      if (!ready) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ready) {
      console.log("[login] login form never appeared (already logged in?)");
      return await isLoggedIn(session);
    }

    await setValue(session, `document.querySelector('input[name="email"], input#email')`, email);
    await setValue(session, `document.querySelector('input[type="password"]')`, password);
    const submitted = await clickButton(session, ["log in", "login", "log in to facebook"]);
    if (!submitted) {
      console.log("[login] could not find the submit button");
      return false;
    }
    console.log("[login] submitted — waiting for the result...");

    // 2FA / checkpoint / success loop
    const deadline = Date.now() + 180000; // 3 min
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const state = await evaluate(
        session,
        `(() => {
          const text = (document.body && document.body.innerText) || "";
          const inputs = Array.from(document.querySelectorAll("input"));
          const codeEl = inputs.find(i =>
            /code|otp/i.test(i.name + " " + (i.id || "")) && i.type !== "password") ||
            inputs.find(i => (i.type === "text" || i.type === "tel") && i.name !== "email");
          return {
            url: location.href,
            needsCode: !!(codeEl && /code|points|password/i.test(text) || codeEl),
            wrong: /wrong password|incorrect password/i.test(text),
            needsApproval: /approve this login|login approval|check your notifications/i.test(text)
          };
        })()`
      ).catch(() => null);
      if (!state) continue;
      if (state.wrong) { console.log("[login] WRONG PASSWORD"); return false; }
      if (state.needsApproval) {
        console.log("[login] Facebook asks for device approval — approve it from the account's other sessions, this script waits...");
      }
      if (state.needsCode) {
        // 2FA screen. Get a code.
        let code = null;
        if (process.env.TOTP_SECRET) {
          try {
            code = totp(process.env.TOTP_SECRET);
            console.log(`[login] generated TOTP code ${code}`);
          } catch (e) {
            console.log(`[login] ${e.message}`);
          }
        }
        if (!code) code = await ask("2FA code (from your authenticator): ");
        const ok = await setCodeInput(session, code);
        if (!ok) continue;
        // Many 2FA screens need an explicit Continue.
        await clickButton(session, ["continue", "submit", "next", "verify"]);
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      if (/messenger\.com/.test(state.url) || /facebook\.com\/?$/.test(state.url)) {
        if (await isLoggedIn(session)) {
          console.log("[login] form login succeeded — browser is logged in");
          return true;
        }
      }
    }
    console.log("[login] timed out waiting for login to complete");
    return false;
  } finally {
    session.close();
    await closeTarget(PORT, target.id);
  }
}

async function setCodeInput(session, code) {
  return evaluate(
    session,
    `(() => {
      const inputs = Array.from(document.querySelectorAll("input"))
        .filter(i => (i.type === "text" || i.type === "tel") && i.name !== "email");
      if (!inputs.length) return false;
      inputs[0].focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;
      setter.call(inputs[0], ${JSON.stringify(code)});
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  ).catch(() => false);
}

// ---------------------------------------------------------------- main ---
(async () => {
  console.log(`[login] target: http://127.0.0.1:${PORT} (start dmhelper/start-chrome.sh first)`);

  // Preferred: manual headed login (survives captcha + 2FA + PIN walls).
  if (await waitForManualLogin()) return process.exit(0);

  // Fallbacks (may hit Arkose captcha in headless):
  if (await tryCookieLogin()) return process.exit(0);
  if (await tryFormLogin()) return process.exit(0);

  console.log("\n[login] could not log in automatically.");
  console.log("Manual option: ssh -L 9222:localhost:9222 user@vps, then open");
  console.log("http://localhost:9222 in your local browser and log in by hand once.");
  process.exit(1);
})().catch((e) => {
  console.error("[login] failed:", (e && (e.error || e.message)) || e);
  process.exit(1);
});
