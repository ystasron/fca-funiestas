/**
 * Browser profile + Chromium binary resolution for the DM bridge stack.
 *
 * The "bot profile" is a Chrome user-data-dir that holds the logged-in
 * Messenger session (created once by a human — see bin/fca-dm-login.js).
 * Headless Chromium reuses it forever after; no captcha, no 2FA.
 */

import fs from "node:fs";
import path from "node:path";

/** Default profile location: <cwd>/dmhelper/bot-profile (matches dmhelper/). */
export function defaultProfileDir(): string {
  return path.join(process.cwd(), "dmhelper", "bot-profile");
}

/** Resolve the profile dir from options (override) or the default location. */
export function resolveProfileDir(option?: string | { profileDir?: string }): string {
  if (typeof option === "string" && option) return path.resolve(option);
  if (option && typeof option === "object" && option.profileDir) {
    return path.resolve(option.profileDir);
  }
  return defaultProfileDir();
}

/**
 * True when the profile directory exists AND looks like a real Chrome profile
 * (has a Default/ subdirectory), i.e. it was actually used by Chrome at least
 * once — not just an empty folder someone created.
 */
export function hasUsableProfile(profileDir: string): boolean {
  try {
    return fs.existsSync(path.join(profileDir, "Default"));
  } catch {
    return false;
  }
}

/** Instructive error text for the missing-profile case. */
export function missingProfileError(profileDir: string): Error {
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
      "  3. Run your bot again — login will now pass this check.",
      "",
      "On a headless VPS, tunnel the port and use your own browser:",
      "  ssh -L 9222:localhost:9222 user@vps   # then open http://localhost:9222"
    ].join("\n")
  );
}

/** Locate a Chromium/Chrome binary across platforms. */
export function findChromiumBinary(): string | null {
  const candidates = [
    process.env.FCA_CHROME_BIN,
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN
  ].filter(Boolean) as string[];

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
