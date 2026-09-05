import {
  defaultProfileDir,
  ensureChromium,
  findChromiumBinary,
  hasUsableProfile,
  isCdpAlive,
  missingProfileError,
  resolveProfileDir,
  waitForCdp
} from "./chunk-DF4KAQ2S.mjs";

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
export {
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
};
