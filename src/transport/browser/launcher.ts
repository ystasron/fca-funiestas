/**
 * Chromium launcher for the DM bridge stack.
 *
 * Spawns Chromium --headless=new with the bot profile on the CDP port, but
 * only when nothing is already listening there (idempotent). The library
 * never requires a display: the profile carries the login session.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { findChromiumBinary } from "./profile";

const DEFAULT_PORT = 9222;

/** True when something already answers on the CDP port. */
export function isCdpAlive(port: number = DEFAULT_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: "GET", path: "/json/version", timeout: 2000 },
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

/** Wait until the CDP endpoint answers (or timeout). */
export async function waitForCdp(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCdpAlive(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export interface LaunchChromiumDeps {
  port?: number;
  profileDir: string;
  headless?: boolean;
  log?: (line: string) => void;
}

export interface LaunchChromiumResult {
  started: boolean; // true when WE spawned it (false = already running)
  binary: string;
}

/**
 * Ensure a Chromium with the given profile is running on the CDP port.
 * Returns which binary was used. Throws { error } when no binary is found.
 */
export async function ensureChromium(deps: LaunchChromiumDeps): Promise<LaunchChromiumResult> {
  const port = deps.port || DEFAULT_PORT;
  const log = deps.log || (() => {});

  if (await isCdpAlive(port)) {
    log(`CDP already listening on :${port} — reusing existing browser`);
    return { started: false, binary: "(existing)" };
  }

  const binary = findChromiumBinary();
  if (!binary) {
    throw {
      error:
        "No Chromium/Chrome binary found. Install one (sudo apt install -y chromium) " +
        "or point FCA_CHROME_BIN at it."
    };
  }

  fs.mkdirSync(deps.profileDir, { recursive: true });

  const args = [
    deps.headless === false ? "--headless=new" : "--headless=new", // default: headless
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
    args.push("--no-sandbox"); // standard for VPS containers
  }

  log(`starting ${binary} on :${port} (profile: ${deps.profileDir})`);
  const child = spawn(binary, args, {
    stdio: "ignore",
    detached: true,
    windowsHide: true
  });
  child.unref();

  const ok = await waitForCdp(port, 20000);
  if (!ok) {
    throw {
      error: `Chromium was launched but CDP did not come up on :${port} within 20s`
    };
  }
  return { started: true, binary };
}
