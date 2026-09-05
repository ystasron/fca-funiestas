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

// src/transport/browser/cdp-session.ts
var cdp_session_exports = {};
__export(cdp_session_exports, {
  CdpSession: () => CdpSession,
  attachTo: () => attachTo,
  closePage: () => closePage,
  evaluateOn: () => evaluateOn,
  httpRequest: () => httpRequest,
  listPages: () => listPages,
  openPage: () => openPage
});
module.exports = __toCommonJS(cdp_session_exports);
var import_node_http = __toESM(require("http"));
var import_ws = __toESM(require("ws"));
function httpRequest(port, method, path) {
  return new Promise((resolve, reject) => {
    const req = import_node_http.default.request(
      { host: "127.0.0.1", port, method, path, headers: { "Content-Length": 0 } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.setTimeout(8e3, () => {
      req.destroy(new Error("CDP http timeout"));
    });
    req.end();
  });
}
async function listPages(port) {
  const raw = await httpRequest(port, "GET", "/json/list");
  const parsed = JSON.parse(raw || "[]");
  return parsed.filter((t) => t.type === "page").map((t) => ({ id: String(t.id), url: String(t.url), wsUrl: String(t.webSocketDebuggerUrl) }));
}
async function openPage(port, url) {
  const path = `/json/new?${encodeURIComponent(url)}`;
  let raw;
  try {
    raw = await httpRequest(port, "PUT", path);
  } catch {
    raw = await httpRequest(port, "GET", path);
  }
  const parsed = JSON.parse(raw || "{}");
  if (!parsed.id || !parsed.webSocketDebuggerUrl) {
    throw { error: `Could not open a Chrome tab (${raw.slice(0, 120)})` };
  }
  return { id: String(parsed.id), url: String(parsed.url || url), wsUrl: String(parsed.webSocketDebuggerUrl) };
}
async function closePage(port, id) {
  try {
    await httpRequest(port, "GET", `/json/close/${id}`);
  } catch {
  }
}
var CdpSession = class {
  ws;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  closed = false;
  constructor(wsUrl) {
    this.ws = new import_ws.default(wsUrl);
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
      this.ws.on("message", (data) => this.handleMessage(data));
      this.ws.on("close", () => {
        this.closed = true;
        for (const { reject: reject2 } of this.pending.values()) {
          reject2({ error: "CDP connection closed" });
        }
        this.pending.clear();
      });
    });
  }
  handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || msg.id == null) return;
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      entry.reject({ error: msg.error.message || "CDP error", code: msg.error.code });
    } else {
      entry.resolve(msg.result || {});
    }
  }
  send(method, params = {}) {
    if (this.closed) {
      return Promise.reject({ error: "CDP connection closed" });
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
    }
  }
};
async function attachTo(target) {
  const session = new CdpSession(target.wsUrl);
  await session.open();
  return session;
}
async function evaluateOn(session, expression) {
  const res = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (res.exceptionDetails) {
    throw {
      error: res.exceptionDetails.exception?.description || res.exceptionDetails.text || "page evaluate threw"
    };
  }
  return res.result && res.result.value;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CdpSession,
  attachTo,
  closePage,
  evaluateOn,
  httpRequest,
  listPages,
  openPage
});
