/**
 * Login-time browser orchestration for DM support.
 *
 * Called from the login process when `browserSend` is enabled:
 *   1. verifies the bot profile exists (throws the instructive
 *      "run fca-dm-login first" error when it doesn't),
 *   2. ensures a headless Chromium with that profile is on the CDP port,
 *   3. opens the Messenger tab so Armadillo/E2EE is warm.
 *
 * After this, cdp-send.ts (sendMessage fallback) and the DM bridge both
 * talk to the same browser.
 */

import { hasUsableProfile, missingProfileError, resolveProfileDir } from "./profile";
import { ensureChromium } from "./launcher";

export {
  resolveProfileDir,
  defaultProfileDir,
  hasUsableProfile,
  missingProfileError,
  findChromiumBinary
} from "./profile";
export { ensureChromium, isCdpAlive, waitForCdp } from "./launcher";
export type { LaunchChromiumDeps, LaunchChromiumResult } from "./launcher";

export interface EnsureBrowserDeps {
  /** browserSend option value: true | { port?, profileDir? } */
  option: boolean | { port?: number; profileDir?: string } | undefined;
  log?: (text: string, type?: string) => void;
}

export interface EnsureBrowserResult {
  port: number;
  profileDir: string;
  started: boolean;
}

/** Parse the browserSend option into concrete port/profile. */
export function parseBrowserSendOption(option: EnsureBrowserDeps["option"]): { port: number; profileDir: string } {
  const port =
    option && typeof option === "object" && Number((option as { port?: number }).port)
      ? Number((option as { port?: number }).port)
      : 9222;
  const profileDir = resolveProfileDir(option && typeof option === "object" ? option : undefined);
  return { port, profileDir };
}

/**
 * Validate + launch the browser side of DM support. Throws a descriptive
 * Error when the profile is missing (first-run on a new machine).
 */
export async function ensureBrowserForDms(deps: EnsureBrowserDeps): Promise<EnsureBrowserResult> {
  const { port, profileDir } = parseBrowserSendOption(deps.option);
  const log = deps.log || (() => {});

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
