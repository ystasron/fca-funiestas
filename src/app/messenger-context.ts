import type { MessageEvent } from "../types/events";

/** Tối thiểu để `MessengerContext.reply` gọi `sendMessage`. */
export interface MessengerBotLike {
  readonly api: Loose;
  /** Internal: the running E2EE DM bridge (set by MessengerBot.startDmBridge). */
  _dmBridge?: Loose | null;
}

/**
 * Ngữ cảnh tin nhắn (tương tự `ctx` trong Telegraf): trả lời thread hiện tại, đọc `text` / `senderID`.
 */
export class MessengerContext {
  constructor(
    public readonly bot: MessengerBotLike,
    public readonly event: MessageEvent
  ) {}

  get threadID(): MessageEvent["threadID"] {
    return this.event.threadID;
  }

  get senderID(): MessageEvent["senderID"] {
    return this.event.senderID;
  }

  get messageID(): string {
    return this.event.messageID;
  }

  /** Nội dung text đã trim (Messenger thường dùng `body`). */
  get text(): string {
    return (this.event.body ?? "").trim();
  }

  get body(): MessageEvent["body"] {
    return this.event.body;
  }

  get message(): MessageEvent {
    return this.event;
  }

  /**
   * Gửi tin vào đúng thread của sự kiện (callback-style như API legacy).
   *
   * Sự kiện E2EE DM (`isE2eeDm`, từ dm-bridge) được trả lời bằng cách gõ
   * trực tiếp vào composer của tab mà bridge đang theo dõi — API paths
   * (mercury/MQTT) không ghi được vào backend Armadillo.
   */
  reply(payload: Loose, callback?: Loose): Loose {
    const evBridge = (this.event as unknown as { dmBridge?: Loose }).dmBridge;
    const bridge = (evBridge || this.bot._dmBridge) as
      | { reply?: (text: string) => Promise<string> }
      | null
      | undefined;
    const ev = this.event as unknown as { isE2eeDm?: boolean };
    if (ev.isE2eeDm && bridge && typeof bridge.reply === "function") {
      const body =
        typeof payload === "string"
          ? payload
          : String((payload as Loose)?.body ?? "");
      const p = bridge.reply(body).then((res) => {
        if (res === "sent") {
          return {
            body,
            messageID: `dmbridge.${Date.now()}`,
            threadID: this.event.threadID
          };
        }
        throw {
          error: `DM bridge reply failed: ${res}. The E2EE conversation tab is not ready yet.`
        };
      });
      if (typeof callback === "function") {
        p.then(
          (r: Loose) => (callback as (e?: Loose, r?: Loose) => void)(undefined, r),
          (e: Loose) => (callback as (e?: Loose, r?: Loose) => void)(e)
        );
      }
      return p;
    }

    const tid = this.event.threadID;
    if (tid == null) {
      throw new Error("MessengerContext.reply: threadID is missing");
    }
    const send = this.bot.api.sendMessage as (a: Loose, b: Loose, c?: Loose) => Loose;
    return send.call(this.bot.api, payload, tid, callback);
  }

  /** `reply` nhưng luôn trả về Promise khi `sendMessage` hỗ trợ promise. */
  async replyAsync(payload: Loose): Promise<Loose> {
    const r = this.reply(payload);
    if (r && typeof (r as Promise<Loose>).then === "function") {
      return r as Promise<Loose>;
    }
    return Promise.resolve(r);
  }
}

