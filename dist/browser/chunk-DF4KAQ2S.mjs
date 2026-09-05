// src/transport/browser/launcher.ts
import { spawn } from "child_process";
import fs2 from "fs";
import http from "http";

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

// src/transport/browser/launcher.ts
var DEFAULT_PORT = 9222;
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

export {
  defaultProfileDir,
  resolveProfileDir,
  hasUsableProfile,
  missingProfileError,
  findChromiumBinary,
  isCdpAlive,
  waitForCdp,
  ensureChromium
};
