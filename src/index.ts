export {
  login,
  loginAsync,
  loginLegacy,
  normalizeCookieHeaderString,
  setJarFromPairs,
  type LoginApiCallback
} from "./core/auth";

export { login as default } from "./core/auth";
export { createDefaultContext, createFcaState, createApiFacade } from "./core/state";
export { createRequestHelper } from "./core/request";
export { listenMqtt } from "./core/mqtt";
export { createAuthCore } from "./core/auth-helpers";
export { defaultConfig, loadConfig, resolveConfig, writeConfigTemplate } from "./core/config";
export { attachThreadInfoRealtimeSync } from "./core/thread-info-realtime-sync";
export { checkForPackageUpdate, runConfiguredUpdateCheck } from "./core/update-check";
export { createFcaClient } from "./app/create-client";
export {
  MessengerBot,
  createMessengerBot,
  type MessengerBotOptions,
  type MessengerMiddleware,
  type MessengerNext
} from "./app/messenger-bot";
export { MessengerContext, type MessengerBotLike } from "./app/messenger-context";
export { attachClientFacade } from "./compat/api-registry";

// Browser (CDP) DM layer — E2EE 1:1 messages the API paths cannot write.
export { createBrowserDmSender } from "./transport/browser/cdp-send";
export { createDmBridge, createAutoDmBridge, type DmBridgeOptions, type DmBridgePartner } from "./transport/browser/dm-bridge";
export {
  ensureBrowserForDms,
  parseBrowserSendOption,
  type EnsureBrowserDeps,
  type EnsureBrowserResult
} from "./transport/browser";
export {
  resolveProfileDir,
  defaultProfileDir,
  hasUsableProfile,
  missingProfileError,
  findChromiumBinary
} from "./transport/browser/profile";
export { ensureChromium, isCdpAlive, waitForCdp } from "./transport/browser/launcher";
export { createMessagesDomain } from "./domains/messages";
export { createThreadsDomain } from "./domains/threads";
export { createRealtimeDomain } from "./domains/realtime";
export { createUsersDomain } from "./domains/users";
export { createAccountDomain } from "./domains/account";
export { createHttpDomain } from "./domains/http";
export { createSchedulerDomain } from "./domains/scheduler";

export * from "./types";
