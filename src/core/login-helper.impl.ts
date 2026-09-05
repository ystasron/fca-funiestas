"use strict";

import EventEmitter from "node:events";
import { attachLegacyApiSurface } from "../app/attach-legacy-api";
import { attachClientFacade } from "../compat/api-registry";
import models from "../database/models";
import logger from "../func/logger";
import { createRemoteClient } from "../remote/remoteClient";
import { saveCookies, getAppState } from "../utils/client";
import { getFrom } from "../utils/constants";
import { createAuthCore } from "./auth-helpers";
import { loadConfig } from "./config";
import { attachMqttCompatibility } from "./mqtt";
import { setOptions } from "./options";
import { createRequestCore } from "./request";
import { attachThreadInfoRealtimeSync } from "./thread-info-realtime-sync";
import { attachThreadUpdater, createApiFacade, createFcaState } from "./state";
import { DataTypes } from "sequelize";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const g = globalThis as Loose;

const { config } = loadConfig();
const requestCore = createRequestCore();
const { get, post, jar, makeDefaults } = requestCore;
const authCore = createAuthCore({});
const REGION_MAP = authCore.REGION_MAP;

function parseRegion(html: string) {
  return authCore.parseRegion(html);
}

function normalizeCookieHeaderString(s: string) {
  return authCore.normalizeCookieHeaderString(s);
}

function setJarFromPairs(j: Loose, pairs: string[], domain: string) {
  return authCore.setJarFromPairs(j, pairs, domain);
}

function cookieHeaderFromJar(j: Loose) {
  const urls = ["https://www.facebook.com"];
  const seen = new Set();
  const parts = [];
  for (const u of urls) {
    let s = "";
    try {
      s = typeof j.getCookieStringSync === "function" ? j.getCookieStringSync(u) : "";
    } catch { }
    if (!s) continue;
    for (const kv of s.split(";")) {
      const t = kv.trim();
      const name = t.split("=")[0];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      parts.push(t);
    }
  }
  return parts.join("; ");
}

let uniqueIndexEnsured = false;

function getBackupModel() {
  try {
    if (!models || !models.sequelize || !models.Sequelize) return null;
    const sequelize = models.sequelize;

    // Validate that sequelize is a proper Sequelize instance
    if (!sequelize || typeof sequelize.define !== "function") return null;

    if (sequelize.models && sequelize.models.AppStateBackup) return sequelize.models.AppStateBackup;
    const dialect = typeof sequelize.getDialect === "function" ? sequelize.getDialect() : "sqlite";
    const LongText = (dialect === "mysql" || dialect === "mariadb") ? DataTypes.TEXT("long") : DataTypes.TEXT;

    try {
      const AppStateBackup = sequelize.define(
        "AppStateBackup",
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          userID: { type: DataTypes.STRING, allowNull: false },
          type: { type: DataTypes.STRING, allowNull: false },
          data: { type: LongText }
        },
        { tableName: "app_state_backups", timestamps: true, indexes: [{ unique: true, fields: ["userID", "type"] }] }
      );
      return AppStateBackup;
    } catch (defineError) {
      // If define fails, log and return null
      logger(`Failed to define AppStateBackup model: ${errMsg(defineError)}`, "warn");
      return null;
    }
  } catch (e) {
    // Silently handle errors in getBackupModel
    return null;
  }
}

async function ensureUniqueIndex(sequelize: Loose) {
  if (uniqueIndexEnsured || !sequelize) return;
  try {
    if (typeof sequelize.getQueryInterface !== "function") return;
    await sequelize.getQueryInterface().addIndex("app_state_backups", ["userID", "type"], { unique: true, name: "app_state_user_type_unique" });
  } catch { }
  uniqueIndexEnsured = true;
}

async function upsertBackup(Model: Loose, userID: Loose, type: string, data: Loose) {
  const where = { userID: String(userID || ""), type };
  const row = await Model.findOne({ where });
  if (row) {
    await row.update({ data });
    logger(`Overwrote existing ${type} backup for user ${where.userID}`, "sys");
    return;
  }
  await Model.create({ ...where, data });
  logger(`Created new ${type} backup for user ${where.userID}`, "sys");
}

async function backupAppStateSQL(j: Loose, userID: Loose) {
  try {
    const Model = getBackupModel();
    if (!Model) return;
    if (!models || !models.sequelize) return;
    await Model.sync();
    await ensureUniqueIndex(models.sequelize);
    const appJson = getAppState(j);
    const ck = cookieHeaderFromJar(j);
    await upsertBackup(Model, userID, "appstate", JSON.stringify(appJson));
    await upsertBackup(Model, userID, "cookie", ck);
    logger("Backup stored (overwrite mode)", "sys");
  } catch (e) {
    logger(`Failed to save appstate backup ${errMsg(e)}`, "warn");
  }
}

async function getLatestBackup(userID: Loose, type: string) {
  try {
    const Model = getBackupModel();
    if (!Model) return null;
    const row = await Model.findOne({ where: { userID: String(userID || ""), type } });
    return row ? ((row as Loose).data as string | null) : null;
  } catch {
    return null;
  }
}

async function getLatestBackupAny(type: string) {
  try {
    const Model = getBackupModel();
    if (!Model) return null;
    const row = await Model.findOne({ where: { type }, order: [["updatedAt", "DESC"]] });
    return row ? ((row as Loose).data as string | null) : null;
  } catch {
    return null;
  }
}



async function setJarCookies(j: Loose, appstate: Loose[]) {
  const tasks = [];
  for (const c of appstate) {
    const cookieName = c.name || c.key;
    const cookieValue = c.value;
    if (!cookieName || cookieValue === undefined) continue;

    const cookieDomain = c.domain || ".facebook.com";
    const cookiePath = c.path || "/";
    const dom = cookieDomain.replace(/^\./, "");

    // Handle expirationDate (can be in seconds or milliseconds)
    let expiresStr = "";
    if (c.expirationDate !== undefined) {
      let expiresDate;
      if (typeof c.expirationDate === "number") {
        // If expirationDate is less than a year from now in seconds, treat as seconds
        // Otherwise treat as milliseconds
        const now = Date.now();
        const oneYearInMs = 365 * 24 * 60 * 60 * 1000;
        if (c.expirationDate < (now + oneYearInMs) / 1000) {
          expiresDate = new Date(c.expirationDate * 1000);
        } else {
          expiresDate = new Date(c.expirationDate);
        }
      } else {
        expiresDate = new Date(c.expirationDate);
      }
      expiresStr = `; expires=${expiresDate.toUTCString()}`;
    } else if (c.expires) {
      const expiresDate = typeof c.expires === "number" ? new Date(c.expires) : new Date(c.expires);
      expiresStr = `; expires=${expiresDate.toUTCString()}`;
    }

    // Helper function to build cookie string
    const buildCookieString = (domainOverride = null) => {
      const domain = domainOverride || cookieDomain;
      let cookieParts = [`${cookieName}=${cookieValue}${expiresStr}`];
      cookieParts.push(`Domain=${domain}`);
      cookieParts.push(`Path=${cookiePath}`);

      // Add Secure flag if secure is true
      if (c.secure === true) {
        cookieParts.push("Secure");
      }

      // Add HttpOnly flag if httpOnly is true
      if (c.httpOnly === true) {
        cookieParts.push("HttpOnly");
      }

      // Add SameSite attribute if provided
      if (c.sameSite) {
        const sameSiteValue = String(c.sameSite).toLowerCase();
        if (["strict", "lax", "none"].includes(sameSiteValue)) {
          cookieParts.push(`SameSite=${sameSiteValue.charAt(0).toUpperCase() + sameSiteValue.slice(1)}`);
        }
      }

      return cookieParts.join("; ");
    };
    const cookieConfigs = [];
    if (cookieDomain === ".facebook.com" || cookieDomain === "facebook.com") {
      cookieConfigs.push({ url: `http://${dom}${cookiePath}`, cookieStr: buildCookieString() });
      cookieConfigs.push({ url: `https://${dom}${cookiePath}`, cookieStr: buildCookieString() });
      cookieConfigs.push({ url: `http://www.${dom}${cookiePath}`, cookieStr: buildCookieString() });
      cookieConfigs.push({ url: `https://www.${dom}${cookiePath}`, cookieStr: buildCookieString() });
    } else {
      cookieConfigs.push({ url: `http://${dom}${cookiePath}`, cookieStr: buildCookieString() });
      cookieConfigs.push({ url: `https://${dom}${cookiePath}`, cookieStr: buildCookieString() });
      cookieConfigs.push({ url: `http://www.${dom}${cookiePath}`, cookieStr: buildCookieString() });
      cookieConfigs.push({ url: `https://www.${dom}${cookiePath}`, cookieStr: buildCookieString() });
    }

    for (const config of cookieConfigs) {
      tasks.push(j.setCookie(config.cookieStr, config.url).catch((err: unknown) => {
        if (err instanceof Error && err.message.includes("Cookie not in this host's domain")) {
          return;
        }
        return;
      }));
    }
  }
  await Promise.all(tasks);
}

async function hydrateJarFromDB(userID: Loose) {
  try {
    let ck = null;
    let app = null;
    if (userID) {
      ck = await getLatestBackup(userID, "cookie");
      app = await getLatestBackup(userID, "appstate");
    } else {
      ck = await getLatestBackupAny("cookie");
      app = await getLatestBackupAny("appstate");
    }
    if (ck) {
      const pairs = normalizeCookieHeaderString(ck);
      if (pairs.length) {
        setJarFromPairs(jar, pairs, ".facebook.com");
        return true;
      }
    }
    if (app) {
      let parsed = null;
      try {
        parsed = JSON.parse(app);
      } catch { }
      if (Array.isArray(parsed)) {
        const pairs = parsed.map(c => [c.name || c.key, c.value].join("="));
        setJarFromPairs(jar, pairs, ".facebook.com");
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function loginHelper(
  appState: Loose,
  Cookie: Loose,
  email: Loose,
  password: Loose,
  globalOptions: Loose,
  callback: (err: Loose | null, api?: Loose) => void
) {
  try {
    const domain = ".facebook.com";
    const ui = logger as Loose;
    const loginFlow = { spinner: null as Loose };
    // Helper to extract userID from appState input
    const extractUIDFromAppState = (appStateInput: Loose) => {
      if (!appStateInput) return null;
      let parsed = appStateInput;
      if (typeof appStateInput === "string") {
        try {
          parsed = JSON.parse(appStateInput);
        } catch {
          return null;
        }
      }
      if (Array.isArray(parsed)) {
        const cUser = parsed.find(c => (c.key === "c_user" || c.name === "c_user"));
        if (cUser) return cUser.value;
        const iUser = parsed.find(c => (c.key === "i_user" || c.name === "i_user"));
        if (iUser) return iUser.value;
      }
      return null;
    };
    let userIDFromAppState = extractUIDFromAppState(appState);
    (async () => {
      if (typeof ui.showBanner === "function") {
        await ui.showBanner();
      }
      try {
        if (appState) {
          // Check and convert cookie to appState format
          if (Array.isArray(appState) && appState.some(c => c.name)) {
            // Convert name to key if needed
            appState = appState.map(c => {
              if (c.name && !c.key) {
                c.key = c.name;
                delete c.name;
              }
              return c;
            });
          } else if (typeof appState === "string") {
            // Try to parse as JSON first
            let parsed = appState;
            try {
              parsed = JSON.parse(appState);
            } catch { }

            if (Array.isArray(parsed)) {
              // Already parsed as array, use it
              appState = parsed;
            } else {
              // Parse string cookie format (key=value; key2=value2)
              const arrayAppState: Loose[] = [];
              appState.split(';').forEach(c => {
                const [key, value] = c.split('=');
                if (key && value) {
                  arrayAppState.push({
                    key: key.trim(),
                    value: value.trim(),
                    domain: ".facebook.com",
                    path: "/",
                    expires: new Date().getTime() + 1000 * 60 * 60 * 24 * 365
                  });
                }
              });
              appState = arrayAppState;
            }
          }

          // Set cookies into jar with individual domain/path
          if (Array.isArray(appState)) {
            await setJarCookies(jar, appState);
          } else {
            throw new Error("Invalid appState format");
          }
        }
        if (Cookie) {
          let cookiePairs: string[] = [];
          if (typeof Cookie === "string") cookiePairs = normalizeCookieHeaderString(Cookie);
          else if (Array.isArray(Cookie)) cookiePairs = Cookie.map(String).filter(Boolean);
          else if (Cookie && typeof Cookie === "object") cookiePairs = Object.entries(Cookie).map(([k, v]) => `${k}=${v}`);
          if (cookiePairs.length) setJarFromPairs(jar, cookiePairs, domain);
        }
      } catch (e) {
        return callback(e);
      }
      const ctx = {
        globalOptions,
        options: globalOptions,
        reconnectAttempts: 0
      } as Loose;
      ctx.bypassAutomation = async function (resp: Loose, j: Loose) {
        g.fca = g.fca || {};
        (g.fca as Loose).BypassAutomationNotification = this.bypassAutomation.bind(this);
        const s = (x: Loose) => (typeof x === "string" ? x : String(x ?? ""));
        const u = (r: Loose) =>
          r?.request?.res?.responseUrl ||
          (r?.config?.baseURL ? new URL(String(r.config.url || "/"), String(r.config.baseURL)).toString() : r?.config?.url || "");
        const isCp = (r: Loose) => typeof u(r) === "string" && u(r).includes("checkpoint/601051028565049");
        const cookieUID = async () => {
          try {
            const cookies = typeof j?.getCookies === "function" ? await j.getCookies("https://www.facebook.com") : [];
            return cookies.find((c: Loose) => c.key === "i_user")?.value || cookies.find((c: Loose) => c.key === "c_user")?.value;
          } catch { return undefined; }
        };
        const htmlUID = (body: Loose) => s(body).match(/"USER_ID"\s*:\s*"(\d+)"/)?.[1] || s(body).match(/\["CurrentUserInitialData",\[\],\{.*?"USER_ID":"(\d+)".*?\},\d+\]/)?.[1];
        const getUID = async (body: Loose) => (await cookieUID()) || htmlUID(body);
        const refreshJar = async () => get("https://www.facebook.com/", j, null, this.options).then(saveCookies(j));
        const bypass = async (body: Loose) => {
          const b = s(body);
          const UID = await getUID(b);
          const fb_dtsg = getFrom(b, '"DTSGInitData",[],{"token":"', '",') || b.match(/name="fb_dtsg"\s+value="([^"]+)"/)?.[1];
          const jazoest = getFrom(b, 'name="jazoest" value="', '"') || getFrom(b, "jazoest=", '",') || b.match(/name="jazoest"\s+value="([^"]+)"/)?.[1];
          const lsd = getFrom(b, '["LSD",[],{"token":"', '"}') || b.match(/name="lsd"\s+value="([^"]+)"/)?.[1];
          const form = { av: UID, fb_dtsg, jazoest, lsd, fb_api_caller_class: "RelayModern", fb_api_req_friendly_name: "FBScrapingWarningMutation", variables: "{}", server_timestamps: true, doc_id: 6339492849481770 };
          await post("https://www.facebook.com/api/graphql/", j, form, null, this.options).then(saveCookies(j));
          logger("Facebook automation warning detected, handling...", "warn");
          this.reconnectAttempts = 0;
        };
        try {
          if (resp) {
            if (isCp(resp)) {
              await bypass(s(resp.data));
              const refreshed = await refreshJar();
              if (isCp(refreshed)) logger("Checkpoint still present after refresh", "warn");
              else logger("Bypass complete, cookies refreshed", "info");
              return refreshed;
            }
            return resp;
          }
          const first = await get("https://www.facebook.com/", j, null, this.options).then(saveCookies(j));
          if (isCp(first)) {
            await bypass(s(first.data));
            const refreshed = await refreshJar();
            if (!isCp(refreshed)) logger("Bypass complete, cookies refreshed", "info");
            else logger("Checkpoint still present after refresh", "warn");
            return refreshed;
          }
          return first;
        } catch (e: unknown) {
          logger(`Bypass automation error: ${errMsg(e)}`, "error");
          return resp;
        }
      };
      if (appState || Cookie) {
        const initial = await get("https://www.facebook.com/", jar, null, globalOptions).then(saveCookies(jar));
        return (await ctx.bypassAutomation(initial, jar)) || initial;
      }
      const hydrated = await hydrateJarFromDB(null);
      if (hydrated) {
        logger("AppState backup live — proceeding to login", "info");
        const initial = await get("https://www.facebook.com/", jar, null, globalOptions).then(saveCookies(jar));
        return (await ctx.bypassAutomation(initial, jar)) || initial;
      }
      logger("AppState expired — no valid session found. Provide appState or Cookie to login.", "error");
      throw new Error("AppState expired — no valid session found. Provide appState or Cookie to login.");
    })()
      .then(async function (res: Loose) {
        const ctx = {} as Loose;
        ctx.options = globalOptions;
        ctx.bypassAutomation = async function (resp: Loose, j: Loose) {
          g.fca = g.fca || {};
          (g.fca as Loose).BypassAutomationNotification = this.bypassAutomation.bind(this);
          const s = (x: Loose) => (typeof x === "string" ? x : String(x ?? ""));
          const u = (r: Loose) =>
            r?.request?.res?.responseUrl ||
            (r?.config?.baseURL ? new URL(String(r.config.url || "/"), String(r.config.baseURL)).toString() : r?.config?.url || "");
          const isCp = (r: Loose) => typeof u(r) === "string" && u(r).includes("checkpoint/601051028565049");
          const cookieUID = async () => {
            try {
              const cookies = typeof j?.getCookies === "function" ? await j.getCookies("https://www.facebook.com") : [];
              return cookies.find((c: Loose) => c.key === "i_user")?.value || cookies.find((c: Loose) => c.key === "c_user")?.value;
            } catch { return undefined; }
          };
          const htmlUID = (body: Loose) => s(body).match(/"USER_ID"\s*:\s*"(\d+)"/)?.[1] || s(body).match(/\["CurrentUserInitialData",\[\],\{.*?"USER_ID":"(\d+)".*?\},\d+\]/)?.[1];
          const getUID = async (body: Loose) => (await cookieUID()) || htmlUID(body);
          const refreshJar = async () => get("https://www.facebook.com/", j, null, this.options).then(saveCookies(j));
          const bypass = async (body: Loose) => {
            const b = s(body);
            const UID = await getUID(b);
            const fb_dtsg = getFrom(b, '"DTSGInitData",[],{"token":"', '",') || b.match(/name="fb_dtsg"\s+value="([^"]+)"/)?.[1];
            const jazoest = getFrom(b, 'name="jazoest" value="', '"') || getFrom(b, "jazoest=", '",') || b.match(/name="jazoest"\s+value="([^"]+)"/)?.[1];
            const lsd = getFrom(b, '["LSD",[],{"token":"', '"}') || b.match(/name="lsd"\s+value="([^"]+)"/)?.[1];
            const form = { av: UID, fb_dtsg, jazoest, lsd, fb_api_caller_class: "RelayModern", fb_api_req_friendly_name: "FBScrapingWarningMutation", variables: "{}", server_timestamps: true, doc_id: 6339492849481770 };
            await post("https://www.facebook.com/api/graphql/", j, form, null, this.options).then(saveCookies(j));
            logger("Facebook automation warning detected, handling...", "warn");
          };
          try {
            if (res && isCp(res)) {
              await bypass(s(res.data));
              const refreshed = await refreshJar();
              if (!isCp(refreshed)) logger("Bypass complete, cookies refreshed", "info");
              return refreshed;
            }
            return res;
          } catch {
            return res;
          }
        };
        if (typeof ui.startSpinner === "function") {
          loginFlow.spinner = await ui.startSpinner("fca: Checking session status...");
        }
        const processed = (await ctx.bypassAutomation(res, jar)) || res;
        if (typeof ui.persistCheckpointOk === "function") {
          ui.persistCheckpointOk(loginFlow.spinner);
        } else if (loginFlow.spinner && typeof loginFlow.spinner.stopAndPersist === "function") {
          loginFlow.spinner.stopAndPersist({ symbol: "ℹ", text: "fca: No checkpoint detected" });
        } else {
          logger("SESSION: No checkpoint detected", "info");
        }
        loginFlow.spinner = null;
        if (typeof ui.startSpinner === "function") {
          loginFlow.spinner = await ui.startSpinner("fca: Finalizing login...");
        }
        let html = processed && processed.data ? processed.data : "";
        let cookies = await Promise.resolve(jar.getCookies("https://www.facebook.com"));
        const getUIDFromCookies = (cs: Loose[]) =>
          cs.find((c: Loose) => c.key === "i_user")?.value ||
          cs.find((c: Loose) => c.key === "c_user")?.value ||
          cs.find((c: Loose) => c.name === "i_user")?.value ||
          cs.find((c: Loose) => c.name === "c_user")?.value;
        const getUIDFromHTML = (body: Loose) => {
          const s = typeof body === "string" ? body : String(body ?? "");
          return s.match(/"USER_ID"\s*:\s*"(\d+)"/)?.[1] || s.match(/\["CurrentUserInitialData",\[\],\{.*?"USER_ID":"(\d+)".*?\},\d+\]/)?.[1];
        };
        // Helper to validate UID - must be a non-zero positive number string
        const isValidUID = (uid: Loose) =>
          Boolean(uid && uid !== "0" && /^\d+$/.test(String(uid)) && parseInt(String(uid), 10) > 0);

        let userID = getUIDFromCookies(cookies);
        // Also try to extract userID from HTML if not found in cookies
        if (!isValidUID(userID)) {
          userID = getUIDFromHTML(html);
        }
        // If still not found and appState was provided, use userID from appState input as fallback
        if (!isValidUID(userID) && userIDFromAppState && isValidUID(userIDFromAppState)) {
          userID = userIDFromAppState;
        }
        // If still not valid, try refreshing the session
        if (!isValidUID(userID)) {
          logger("No valid userID found, attempting session refresh...", "warn");
          try {
            // Try refreshing with m.facebook.com first
            const refreshRes = await get("https://m.facebook.com/", jar, null, globalOptions).then(saveCookies(jar));
            const refreshHtml = refreshRes && refreshRes.data ? refreshRes.data : "";
            const refreshCookies = await Promise.resolve(jar.getCookies("https://www.facebook.com"));
            
            userID = getUIDFromCookies(refreshCookies);
            if (!isValidUID(userID)) {
              userID = getUIDFromHTML(refreshHtml);
            }
            if (isValidUID(userID)) {
              html = refreshHtml;
              cookies = refreshCookies;
              logger(`Session refresh successful, found USER_ID: ${userID}`, "info");
            }
          } catch (refreshErr) {
            logger(`Session refresh failed: ${errMsg(refreshErr)}`, "warn");
          }
        }
        // Final check
        if (!isValidUID(userID)) {
          throw new Error("Login failed - no valid userID found. AppState may be expired. Provide a valid appState or Cookie.");
        }
        if (html.includes("/checkpoint/block/?next")) {
          logger("Appstate die, vui lòng thay cái mới!", "error");
          throw new Error("Checkpoint");
        }
        
        // Final validation: ensure HTML shows we're logged in before proceeding
        let finalHtmlUID = getUIDFromHTML(html);
        if (!isValidUID(finalHtmlUID)) {
          // If cookies have valid UID but HTML doesn't, try to "activate" session
          if (isValidUID(userID)) {
            logger(`HTML shows USER_ID=${finalHtmlUID || "none"} but cookies have valid UID=${userID}. Attempting to activate session...`, "warn");
            
            // Try making requests to activate the session
            try {
              // Wait a bit first for cookies to propagate
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Try refreshing with m.facebook.com/home.php (mobile home page)
              logger("Trying to activate session via m.facebook.com/home.php...", "info");
              const activateRes = await get("https://m.facebook.com/home.php", jar, null, globalOptions).then(saveCookies(jar));
              const activateHtml = activateRes && activateRes.data ? activateRes.data : "";
              const activateUID = getUIDFromHTML(activateHtml);
              
              if (isValidUID(activateUID)) {
                html = activateHtml;
                finalHtmlUID = activateUID;
                userID = activateUID;
                logger(`Session activated! Found valid USER_ID in HTML: ${userID}`, "info");
              } else {
                // Try one more time with www.facebook.com/home.php after delay
                await new Promise(resolve => setTimeout(resolve, 1500));
                logger("Trying to activate session via www.facebook.com/home.php...", "info");
                const activateRes2 = await get("https://www.facebook.com/home.php", jar, null, globalOptions).then(saveCookies(jar));
                const activateHtml2 = activateRes2 && activateRes2.data ? activateRes2.data : "";
                const activateUID2 = getUIDFromHTML(activateHtml2);
                
                if (isValidUID(activateUID2)) {
                  html = activateHtml2;
                  finalHtmlUID = activateUID2;
                  userID = activateUID2;
                  logger(`Session activated on second try! Found valid USER_ID in HTML: ${userID}`, "info");
                } else {
                  // If cookies have valid UID, we can proceed with cookie-based UID but warn
                  logger(`WARNING: HTML still shows USER_ID=${finalHtmlUID || "none"} but cookies have valid UID=${userID}. Proceeding with cookie-based UID.`, "warn");
                  // Don't throw error, proceed with cookie-based UID
                }
              }
            } catch (activateErr) {
              logger(`Failed to activate session: ${errMsg(activateErr)}. Proceeding with cookie-based UID.`, "warn");
              // Don't throw error, proceed with cookie-based UID
            }
          } else {
            // No valid UID in either cookies or HTML
            logger(`Final HTML validation failed - USER_ID from HTML: ${finalHtmlUID || "none"}, from cookies: ${userID || "none"}`, "error");
            throw new Error("Login validation failed - HTML does not contain valid USER_ID. Session may not be properly established.");
          }
        }
        
        // Final check: ensure we have a valid userID (either from HTML or cookies)
        if (!isValidUID(userID)) {
          logger(`No valid USER_ID found - HTML: ${finalHtmlUID || "none"}, Cookies: ${userID || "none"}`, "error");
          throw new Error("Login validation failed - No valid USER_ID found in HTML or cookies.");
        }
        let mqttEndpoint;
        let region = "PRN";
        let fb_dtsg;
        let irisSeqID;
        try {
          const m1 = html.match(/"endpoint":"([^"]+)"/);
          const m2 = m1 ? null : html.match(/endpoint\\":\\"([^\\"]+)\\"/);
          const raw = (m1 && m1[1]) || (m2 && m2[1]);
          if (raw) mqttEndpoint = raw.replace(/\\\//g, "/");
          region = parseRegion(html);
          const rinfo = REGION_MAP.get(region);
          if (rinfo) logger(`REGION: ${region} (${rinfo.name})`, "info");
          else logger(`REGION: ${region} (Server)`, "info");
        } catch {
          logger("Not MQTT endpoint", "warn");
        }
        try {
          const userDataMatch = String(html).match(/\["CurrentUserInitialData",\[\],({.*?}),\d+\]/);
          if (userDataMatch) {
            const info = JSON.parse(userDataMatch[1]);
            logger(`ACCOUNT: ${info.NAME} (${info.USER_ID})`, "info");

            // Check if Facebook response shows USER_ID = 0 (session dead)
            if (!isValidUID(info.USER_ID)) {
              logger("Facebook response shows invalid USER_ID (0 or empty), session is dead!", "error");
              throw new Error("Login failed - Facebook response shows invalid USER_ID. AppState may be expired.");
            }
          } else if (userID) {
            logger(`ACCOUNT: ${userID}`, "info");
          }
        } catch (userDataErr) {
          // If error is from our validation, rethrow it
          if (userDataErr instanceof Error && userDataErr.message.includes("Auto-login failed")) {
            throw userDataErr;
          }
          // Otherwise ignore parsing errors
        }
        const tokenMatch = html.match(/DTSGInitialData.*?token":"(.*?)"/);
        if (tokenMatch) fb_dtsg = tokenMatch[1];
        try {
          if (userID) await backupAppStateSQL(jar, userID);
        } catch { }
        Promise.resolve()
          .then(function () {
            if (models && models.sequelize && typeof models.sequelize.authenticate === "function") {
              return models.sequelize.authenticate();
            }
          })
          .then(function () {
            if (models && typeof models.syncAll === "function") {
              return models.syncAll();
            }
          })
          .catch(function (error) {
            // Silently handle database errors - they're not critical for login
            const errorMsg = errMsg(error);
            if (!errorMsg.includes("No Sequelize instance passed")) {
              // Only log non-Sequelize instance errors
              logger(`Database connection failed: ${errorMsg}`, "warn");
            }
          });
        logger("FCA fix/update by DongDev (Donix-VN)", "info");
        const emitter = new EventEmitter();
        const ctxMain = createFcaState({
          userID,
          jar,
          globalOptions,
          lastSeqId: irisSeqID,
          mqttEndpoint,
          region,
          fb_dtsg,
          clientID: ((Math.random() * 2147483648) | 0).toString(16),
          clientId: getFrom(html, '["MqttWebDeviceID",[],{"clientID":"', '"}') || "",
          emitter,
          bypassAutomation: ctx.bypassAutomation
        });
        const api = createApiFacade({
          globalOptions,
          jar,
          userID,
          emitter,
          setOptions,
          getAppState,
          cookieHeaderFromJar,
          getLatestBackup
        }) as Loose;
        const defaultFuncs = makeDefaults(html, userID, ctxMain);

        // Attach lightweight DB updaters for realtime events (MQTT)
        attachThreadUpdater(ctxMain, models, logger);

        // Attach remote control client if enabled in config
        let remote = null;
        try {
          if (config && config.remoteControl && config.remoteControl.enabled) {
            remote = createRemoteClient(api, ctxMain, config.remoteControl);
          }
        } catch (e) {
          logger(`Remote control initialization failed: ${errMsg(e)}`, "warn");
        }
        if (remote) {
          api.remote = remote;
        }
        const { loaded, skipped, namespaces } = attachLegacyApiSurface(api, defaultFuncs, ctxMain, logger);
        attachThreadInfoRealtimeSync(ctxMain, models, logger, api);
        if (typeof ui.runMethodLoadProgress === "function") {
          await ui.runMethodLoadProgress(loaded);
        }
        const client = attachClientFacade(api, namespaces);
        ctxMain.client = client;
        logger(`READY: Loaded ${loaded} API methods${skipped ? `, skipped ${skipped} duplicates` : ""}`, "success");
        ctxMain._fbDtsgRefreshInterval = attachMqttCompatibility(api, {
          logger,
          refreshIntervalMs: 86400000
        });
        if (typeof ui.persistLoginSuccess === "function") {
          ui.persistLoginSuccess(loginFlow.spinner);
        } else if (loginFlow.spinner && typeof loginFlow.spinner.succeed === "function") {
          loginFlow.spinner.succeed("fca: Login successful!");
        }
        logger("AUTH: Login successful!", "success");
        callback(null, api);
      })
      .catch(function (e) {
        if (typeof ui.persistLoginFail === "function") {
          ui.persistLoginFail(loginFlow.spinner);
        } else if (loginFlow.spinner && typeof loginFlow.spinner.fail === "function") {
          loginFlow.spinner.fail(`fca: Login failed - ${errMsg(e)}`);
        }
        callback(e);
      });
  } catch (e) {
    callback(e);
  }
}

const exported = Object.assign(loginHelper, {
  loginHelper,
  normalizeCookieHeaderString,
  setJarFromPairs
});

export default exported;
