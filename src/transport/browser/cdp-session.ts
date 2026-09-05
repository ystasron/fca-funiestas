/**
 * Minimal CDP client over a page websocket (shared by cdp-send, dm-bridge,
 * and the login helpers). No puppeteer — only `ws` (runtime dependency).
 */

import http from "node:http";
import WebSocket from "ws";

export interface PageTarget {
  id: string;
  url: string;
  wsUrl: string;
}

export function httpRequest(port: number, method: string, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers: { "Content-Length": 0 } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.setTimeout(8000, () => {
      req.destroy(new Error("CDP http timeout"));
    });
    req.end();
  });
}

/** List open page targets. */
export async function listPages(port: number): Promise<PageTarget[]> {
  const raw = await httpRequest(port, "GET", "/json/list");
  const parsed = JSON.parse(raw || "[]") as Loose[];
  return parsed
    .filter((t) => t.type === "page")
    .map((t) => ({ id: String(t.id), url: String(t.url), wsUrl: String(t.webSocketDebuggerUrl) }));
}

/** Open a new page target. Chrome >= 102 requires PUT for /json/new. */
export async function openPage(port: number, url: string): Promise<PageTarget> {
  const path = `/json/new?${encodeURIComponent(url)}`;
  let raw: string;
  try {
    raw = await httpRequest(port, "PUT", path);
  } catch {
    raw = await httpRequest(port, "GET", path);
  }
  const parsed = JSON.parse(raw || "{}") as Loose;
  if (!parsed.id || !parsed.webSocketDebuggerUrl) {
    throw { error: `Could not open a Chrome tab (${raw.slice(0, 120)})` };
  }
  return { id: String(parsed.id), url: String(parsed.url || url), wsUrl: String(parsed.webSocketDebuggerUrl) };
}

export async function closePage(port: number, id: string): Promise<void> {
  try {
    await httpRequest(port, "GET", `/json/close/${id}`);
  } catch {
    // best-effort
  }
}

/** Minimal CDP session: request/response over a page websocket. */
export class CdpSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Loose) => void; reject: (e: Loose) => void }>();
  closed = false;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
      this.ws.on("message", (data) => this.handleMessage(data));
      this.ws.on("close", () => {
        this.closed = true;
        for (const { reject } of this.pending.values()) {
          reject({ error: "CDP connection closed" });
        }
        this.pending.clear();
      });
    });
  }

  private handleMessage(data: Loose) {
    let msg: Loose;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || msg.id == null) return; // events are ignored
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      entry.reject({ error: msg.error.message || "CDP error", code: msg.error.code });
    } else {
      entry.resolve(msg.result || {});
    }
  }

  send(method: string, params: Loose = {}): Promise<Loose> {
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
      // best-effort
    }
  }
}

/** Attach a CdpSession to a page target. */
export async function attachTo(target: PageTarget): Promise<CdpSession> {
  const session = new CdpSession(target.wsUrl);
  await session.open();
  return session;
}

/** Run JS in the page and return the value (or throw on exception). */
export async function evaluateOn(session: CdpSession, expression: string): Promise<Loose> {
  const res = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (res.exceptionDetails) {
    throw {
      error:
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        "page evaluate threw"
    };
  }
  return res.result && res.result.value;
}
