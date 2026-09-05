"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/transport/browser/index.ts
var index_exports = {};
__export(index_exports, {
  defaultProfileDir: () => defaultProfileDir,
  ensureBrowserForDms: () => ensureBrowserForDms,
  ensureChromium: () => ensureChromium,
  findChromiumBinary: () => findChromiumBinary,
  hasUsableProfile: () => hasUsableProfile,
  isCdpAlive: () => isCdpAlive,
  missingProfileError: () => missingProfileError,
  parseBrowserSendOption: () => parseBrowserSendOption,
  resolveProfileDir: () => resolveProfileDir,
  waitForCdp: () => waitForCdp
});
module.exports = __toCommonJS(index_exports);

// src/transport/browser/profile.ts
var import_node_fs = __toESM(require("fs"));
var import_node_path = __toESM(require("path"));
function defaultProfileDir() {
  return import_node_path.default.join(process.cwd(), "dmhelper", "bot-profile");
}
function resolveProfileDir(option) {
  if (typeof option === "string" && option) return import_node_path.default.resolve(option);
  if (option && typeof option === "object" && option.profileDir) {
    return import_node_path.default.resolve(option.profileDir);
  }
  return defaultProfileDir();
}
function hasUsableProfile(profileDir) {
  try {
    return import_node_fs.default.existsSync(import_node_path.default.join(profileDir, "Default"));
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
    if (import_node_fs.default.existsSync(c)) return c;
  }
  if (process.platform === "win32") {
    const winPaths = [
      import_node_path.default.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
      import_node_path.default.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
      import_node_path.default.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
      import_node_path.default.join(process.env.PROGRAMFILES || "C:\\Program Files", "Chromium\\Application\\chrome.exe")
    ];
    for (const p of winPaths) {
      if (import_node_fs.default.existsSync(p)) return p;
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
    if (import_node_fs.default.existsSync(p)) return p;
  }
  return null;
}

// src/transport/browser/launcher.ts
var import_node_child_process = require("child_process");
var import_node_fs2 = __toESM(require("fs"));
var import_node_http = __toESM(require("http"));
var DEFAULT_PORT = 9222;
function isCdpAlive(port = DEFAULT_PORT) {
  return new Promise((resolve) => {
    const req = import_node_http.default.request(
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
  import_node_fs2.default.mkdirSync(deps.profileDir, { recursive: true });
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
  const child = (0, import_node_child_process.spawn)(binary, args, {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  defaultProfileDir,
  ensureBrowserForDms,
  ensureChromium,
  findChromiumBinary,
  hasUsableProfile,
  isCdpAlive,
  missingProfileError,
  parseBrowserSendOption,
  resolveProfileDir,
  waitForCdp
});
