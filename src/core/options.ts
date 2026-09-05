import type { FcaOptions } from "./state";

import logger from "../func/logger";
import { setProxy } from "../utils/request";

export const Boolean_Option = [
  "online",
  "selfListen",
  "listenEvents",
  "updatePresence",
  "forceLogin",
  "autoMarkRead",
  "listenTyping",
  "autoReconnect",
  "emitReady",
  "selfListenEvent"
] as const;

type BooleanOptionKey = (typeof Boolean_Option)[number];

export function setOptions(
  globalOptions: FcaOptions & Record<string, Loose>,
  options: Record<string, Loose> = {}
) {
  for (const key of Object.keys(options || {})) {
    if ((Boolean_Option as readonly string[]).includes(key)) {
      globalOptions[key as BooleanOptionKey] = Boolean(options[key]);
      continue;
    }
    switch (key) {
      case "userAgent": {
        globalOptions.userAgent =
          options.userAgent ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
        break;
      }
      case "proxy": {
        if (typeof options.proxy !== "string") {
          delete globalOptions.proxy;
          setProxy();
        } else {
          globalOptions.proxy = options.proxy;
          setProxy(globalOptions.proxy);
        }
        break;
      }
      case "pageID": {
        globalOptions.pageID = options.pageID ? String(options.pageID) : undefined;
        break;
      }
      case "logLevel": {
        globalOptions.logLevel = options.logLevel;
        break;
      }
      case "autoUpdate":
      case "checkUpdate": {
        // Object-valued options from the fca config file; accepted without
        // warning but not part of FcaOptions typing.
        (globalOptions as Loose)[key] = options[key];
        break;
      }
      case "browserSend": {
        // Fallback DM send through a logged-in browser tab (E2EE DMs).
        (globalOptions as Loose)[key] = options[key];
        break;
      }
      default: {
        logger("setOptions Unrecognized option given to setOptions: " + key, "warn");
        break;
      }
    }
  }
}


