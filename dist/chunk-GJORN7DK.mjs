var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/transport/browser/profile.ts
import fs from "fs";
import path from "path";
function defaultProfileDir() {
  return path.join(process.cwd(), "dmhelper", "bot-profile");
}
function resolveProfileDir(option) {
  if (typeof option === "string" && option) return path.resolve(option);
  if (option && typeof option === "object" && option.profileDir) {
    return path.resolve(option.profileDir);
  }
  return defaultProfileDir();
}
function hasUsableProfile(profileDir) {
  try {
    return fs.existsSync(path.join(profileDir, "Default"));
  } catch {
    return false;
  }
}
function missingProfileError(profileDir) {
  return new Error(
    [
      "browserSend is enabled but no logged-in browser profile exists yet.",
      `Expected it at: ${profileDir}`,
      "",
      "Facebook requires ONE human login (captcha + 2FA) before a device is",
      "trusted; after that the profile works headlessly forever.",
      "",
      "Do this once:",
      "  1. Start Chromium on the debug port with that profile:",
      `     chromium --headless=new --remote-debugging-port=9222 --user-data-dir="${profileDir}"`,
      "     (or without --headless to get a visible window)",
      "  2. Log in to Facebook inside it by hand, then run:",
      "     npx @dongdev/fca-dm-login",
      "     (it waits for the session and exits 0 when found)",
      "  3. Run your bot again \u2014 login will now pass this check.",
      "",
      "On a headless VPS, tunnel the port and use your own browser:",
      "  ssh -L 9222:localhost:9222 user@vps   # then open http://localhost:9222"
    ].join("\n")
  );
}
function findChromiumBinary() {
  const candidates = [
    process.env.FCA_CHROME_BIN,
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  if (process.platform === "win32") {
    const winPaths = [
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Chromium\\Application\\chrome.exe")
    ];
    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
  const fsUnix = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
    "/opt/google/chrome/chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  for (const p of fsUnix) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
var init_profile = __esm({
  "src/transport/browser/profile.ts"() {
    "use strict";
  }
});

// src/transport/browser/launcher.ts
import { spawn } from "child_process";
import fs2 from "fs";
import http from "http";
function isCdpAlive(port = DEFAULT_PORT) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: "GET", path: "/json/version", timeout: 2e3 },
      (res) => {
        res.resume();
        resolve(res.statusCode != null && res.statusCode < 500);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCdpAlive(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
async function ensureChromium(deps) {
  const port = deps.port || DEFAULT_PORT;
  const log = deps.log || (() => {
  });
  if (await isCdpAlive(port)) {
    log(`CDP already listening on :${port} \u2014 reusing existing browser`);
    return { started: false, binary: "(existing)" };
  }
  const binary = findChromiumBinary();
  if (!binary) {
    throw {
      error: "No Chromium/Chrome binary found. Install one (sudo apt install -y chromium) or point FCA_CHROME_BIN at it."
    };
  }
  fs2.mkdirSync(deps.profileDir, { recursive: true });
  const args = [
    deps.headless === false ? "--headless=new" : "--headless=new",
    // default: headless
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${deps.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--window-size=1280,900",
    "about:blank"
  ];
  if (process.platform !== "win32") {
    args.push("--no-sandbox");
  }
  log(`starting ${binary} on :${port} (profile: ${deps.profileDir})`);
  const child = spawn(binary, args, {
    stdio: "ignore",
    detached: true,
    windowsHide: true
  });
  child.unref();
  const ok = await waitForCdp(port, 2e4);
  if (!ok) {
    throw {
      error: `Chromium was launched but CDP did not come up on :${port} within 20s`
    };
  }
  return { started: true, binary };
}
var DEFAULT_PORT;
var init_launcher = __esm({
  "src/transport/browser/launcher.ts"() {
    "use strict";
    init_profile();
    DEFAULT_PORT = 9222;
  }
});

// src/transport/browser/index.ts
function parseBrowserSendOption(option) {
  const port = option && typeof option === "object" && Number(option.port) ? Number(option.port) : 9222;
  const profileDir = resolveProfileDir(option && typeof option === "object" ? option : void 0);
  return { port, profileDir };
}
async function ensureBrowserForDms(deps) {
  const { port, profileDir } = parseBrowserSendOption(deps.option);
  const log = deps.log || (() => {
  });
  if (!hasUsableProfile(profileDir)) {
    throw missingProfileError(profileDir);
  }
  const { started } = await ensureChromium({
    port,
    profileDir,
    log: (line) => log(`[browser] ${line}`, "info")
  });
  return { port, profileDir, started };
}
var init_browser = __esm({
  "src/transport/browser/index.ts"() {
    init_profile();
    init_launcher();
    init_profile();
    init_launcher();
  }
});

export {
  __require,
  __esm,
  __commonJS,
  __export,
  __toESM,
  __toCommonJS,
  defaultProfileDir,
  resolveProfileDir,
  hasUsableProfile,
  missingProfileError,
  findChromiumBinary,
  init_profile,
  isCdpAlive,
  waitForCdp,
  ensureChromium,
  init_launcher,
  parseBrowserSendOption,
  ensureBrowserForDms,
  init_browser
};
