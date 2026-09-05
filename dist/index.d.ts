import { EventEmitter } from 'node:events';

interface FcaOptions {
    logLevel?: "silly" | "info" | "warn" | "error" | "silent";
    listenEvents?: boolean;
    selfListen?: boolean;
    selfListenEvent?: boolean;
    listenTyping?: boolean;
    updatePresence?: boolean;
    forceLogin?: boolean;
    autoMarkRead?: boolean;
    autoReconnect?: boolean;
    online?: boolean;
    emitReady?: boolean;
    userAgent?: string;
    proxy?: string;
    pageID?: string;
    /**
     * When set, 1:1 DMs that the API cannot send (E2EE "Armadillo" threads) are
     * sent through a logged-in Messenger browser tab via Chrome DevTools
     * Protocol. Value: true | { port?, profileDir? }. See
     * src/transport/browser/cdp-send.ts. Login verifies the profile exists
     * (throws "run fca-dm-login first" when missing) and launches headless
     * Chromium with it.
     */
    browserSend?: boolean | {
        port?: number;
        profileDir?: string;
    };
}
interface FcaContext {
    fbid: string;
    clientId: string;
    cookieString: string;
    mqttClient: Loose | null;
    options: FcaOptions;
    globalOptions?: FcaOptions;
    jar?: Loose;
    userID?: string;
    access_token?: string;
    fb_dtsg?: string;
    ttstamp?: string;
    lastSeqId?: string | number | null;
    syncToken?: string;
    mqttEndpoint?: string;
    region?: string;
    firstListen?: boolean;
    clientID?: string;
    wsReqNumber?: number;
    wsTaskNumber?: number;
    tasks?: Map<string | number, Loose>;
    _emitter?: {
        emit: (event: string, payload?: Loose) => void;
    };
    [key: string]: Loose;
}
declare const createDefaultContext: () => FcaContext;
declare function createFcaState(input: Record<string, Loose>): FcaContext;
declare function createApiFacade(params: {
    globalOptions: FcaOptions;
    jar: Loose;
    userID: string;
    emitter: Loose;
    setOptions: (globalOptions: FcaOptions, options: Record<string, Loose>) => void;
    getAppState: (jar: Loose) => Loose;
    cookieHeaderFromJar: (jar: Loose) => string;
    getLatestBackup: (uid: string, type: string) => Promise<string | null>;
}): {
    setOptions: (options: Record<string, any>) => void;
    getCookies: () => string;
    getAppState: () => any;
    getLatestAppStateFromDB: (uid?: string) => Promise<any>;
    getLatestCookieFromDB: (uid?: string) => Promise<string | null>;
    on: any;
    once: any;
    off: any;
    removeAllListeners: any;
};

interface LoginCredentials$1 {
    appState?: Loose[];
    email?: string;
    password?: string;
    Cookie?: string | string[] | Record<string, string>;
}
/** Classic FCA-style callback receives the flat `api` object (same as `ctx.api`). */
type LoginApiCallback = (err: Error | null | undefined, api?: Loose) => void;
declare function loginAsync(credentials: LoginCredentials$1, customOptions?: FcaOptions): Promise<FcaContext>;
/**
 * Login: Promise API, or legacy `login(credentials, (err, api) => …)` like classic FCA.
 * For `const login = require('@dongdev/fca-unofficial')`, use the published `dist/cjs.cjs` entry.
 */
declare function login(credentials: LoginCredentials$1, callback: LoginApiCallback): void;
declare function login(credentials: LoginCredentials$1, options: FcaOptions, callback: LoginApiCallback): void;
declare function login(credentials: LoginCredentials$1, customOptions?: FcaOptions): Promise<FcaContext>;
declare function loginLegacy(credentials: LoginCredentials$1, options?: FcaOptions | ((err: Error | null, ctx?: FcaContext) => void), callback?: (err: Error | null, ctx?: FcaContext) => void): Promise<FcaContext> | undefined;
declare const normalizeCookieHeaderString: (cookieHeader: string) => string[];
declare const setJarFromPairs: (jar: {
    setCookieSync?: (cookie: string, url: string) => void;
    setCookie?: (cookie: string, url: string, cb?: (err?: Error | null) => void) => void;
}, pairs: string[], domain: string) => void;

interface RequestHelper {
    get: (url: string, config?: Loose) => Promise<Loose>;
    post: (url: string, data?: Loose, config?: Loose) => Promise<Loose>;
    postFormData: (url: string, formData: Loose, config?: Loose) => Promise<Loose>;
}
declare const createRequestHelper: (ctx: FcaContext) => RequestHelper;

type FcaID = string;
interface FcaGlobalOptions {
    selfListen: boolean;
    selfListenEvent: boolean;
    listenEvents: boolean;
    listenTyping: boolean;
    updatePresence: boolean;
    forceLogin: boolean;
    autoMarkRead: boolean;
    autoReconnect: boolean;
    online: boolean;
    emitReady: boolean;
    userAgent: string;
    proxy?: string;
    pageID?: string;
}
interface FcaState {
    userID: FcaID;
    jar: Loose;
    globalOptions: FcaGlobalOptions;
    loggedIn: boolean;
    access_token?: string;
    fb_dtsg?: string;
    ttstamp?: string;
    mqttClient?: Loose;
    lastSeqId?: string | number | null;
    syncToken?: string;
    mqttEndpoint?: string;
    region?: string;
    firstListen?: boolean;
    clientID?: string;
    clientId?: string;
    wsReqNumber?: number;
    wsTaskNumber?: number;
    tasks?: Map<string | number, Loose>;
    _emitter?: {
        emit: (event: string, payload?: Loose) => void;
    };
}
interface LoginCredentials {
    email?: string;
    password?: string;
    appState?: Loose;
    Cookie?: string | string[] | Record<string, string>;
}

interface EventBase {
    threadID?: FcaID;
    senderID?: FcaID;
    timestamp?: number;
}
interface MessageEvent extends EventBase {
    type: "message" | "message_reply";
    messageID: string;
    body?: string;
    attachments?: Loose[];
}
interface ReactionEvent extends EventBase {
    type: "message_reaction";
    messageID: string;
    reaction: string;
    userID: FcaID;
}
interface MessageUnsendEvent extends EventBase {
    type: "message_unsend";
    messageID: string;
    senderID: FcaID;
    deletionTimestamp?: number;
    timestamp?: number;
}
interface ReadEvent extends EventBase {
    type: "read" | "read_receipt";
    reader: FcaID;
}
interface PresenceEvent extends EventBase {
    type: "presence";
    userID?: FcaID;
    statuses?: Loose;
}
interface TypingEvent extends EventBase {
    type: "typ";
    isTyping: boolean;
    from?: FcaID;
}
interface FriendRequestReceivedEvent extends EventBase {
    type: "friend_request_received";
    actorFbId: FcaID;
}
interface FriendRequestCancelEvent extends EventBase {
    type: "friend_request_cancel";
    actorFbId: FcaID;
}
interface ReadyEvent extends EventBase {
    type: "ready";
    error: null;
}
interface ThreadEvent extends EventBase {
    type: "event";
    logMessageType?: string;
    logMessageData?: Record<string, Loose>;
    logMessageBody?: string;
    author?: FcaID;
    eventType?: string;
    eventData?: Record<string, Loose>;
}
interface AccountInactiveEvent extends EventBase {
    type: "account_inactive";
    reason: string;
    error: string;
}
interface StopListenEvent extends EventBase {
    type: "stop_listen";
    error: string;
}
type MqttEvent = MessageEvent | ReactionEvent | MessageUnsendEvent | ReadEvent | PresenceEvent | TypingEvent | FriendRequestReceivedEvent | FriendRequestCancelEvent | ReadyEvent | ThreadEvent | AccountInactiveEvent | StopListenEvent;
type ListenMqttError = Error | AccountInactiveEvent | StopListenEvent;

type MqttStreamEvent = MqttEvent | {
    type: "error";
    error: ListenMqttError;
};
declare const listenMqtt: (ctx: FcaContext, callback?: (event: MqttStreamEvent) => void) => Loose;

declare const DEFAULT_REGIONS: {
    code: string;
    name: string;
    location: string;
}[];
declare function createAuthCore(opts?: {
    logger?: (message: string, type?: string) => void;
    config?: Record<string, Loose>;
    axiosBase?: Loose;
    regions?: typeof DEFAULT_REGIONS;
}): {
    REGION_MAP: Map<string, {
        code: string;
        name: string;
        location: string;
    }>;
    parseRegion: (html: string) => string;
    normalizeCookieHeaderString: (s: string) => string[];
    setJarFromPairs: (j: Loose, pairs: string[], domain: string) => void;
};

interface FcaUpdateCheckConfig {
    enabled: boolean;
    install: boolean;
    notifyIfCurrent: boolean;
    packageName: string;
    registryUrl: string;
    timeoutMs: number;
}
interface FcaConfig {
    autoUpdate: boolean;
    checkUpdate: FcaUpdateCheckConfig;
    mqtt: {
        enabled: boolean;
        reconnectInterval: number;
    };
    autoLogin: boolean;
    apiServer: string;
    apiKey: string;
    credentials: {
        email: string;
        password: string;
        twofactor: string;
    };
    antiGetInfo: {
        AntiGetThreadInfo: boolean;
        AntiGetUserInfo: boolean;
    };
    remoteControl: {
        enabled: boolean;
        url: string;
        token: string;
        autoReconnect: boolean;
    };
    [key: string]: Loose;
}
interface LoadedFcaConfig {
    config: FcaConfig;
    configPath: string;
    exists: boolean;
}
declare const defaultConfig: FcaConfig;
declare function resolveConfig(input?: Loose): FcaConfig;
declare function loadConfig(): LoadedFcaConfig;
declare function writeConfigTemplate(targetPath?: string): string;

/**
 * Gắn vào ctx sau login (cần Sequelize Thread model). Không có DB → bỏ qua.
 */
declare function attachThreadInfoRealtimeSync(ctx: Loose, models: Loose, logger: (msg: string, level?: string) => void, api?: Loose): boolean;

interface PackageUpdateCheckResult {
    packageName: string;
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    installed: boolean;
}
declare function checkForPackageUpdate(input?: FcaConfig | FcaUpdateCheckConfig, logger?: (text: string, type?: string) => void): Promise<PackageUpdateCheckResult | null>;
declare function runConfiguredUpdateCheck(config: FcaConfig, logger?: (text: string, type?: string) => void): Promise<PackageUpdateCheckResult | null>;

type LegacyApiLike = Record<string, Loose>;
interface FcaClientNamespace {
    [key: string]: Loose;
}
interface FcaClientFacade {
    raw: LegacyApiLike;
    messages: FcaClientNamespace;
    threads: FcaClientNamespace;
    users: FcaClientNamespace;
    account: FcaClientNamespace;
    realtime: FcaClientNamespace;
    http: FcaClientNamespace;
    scheduler: FcaClientNamespace;
}
interface FcaClientNamespaces {
    messages: FcaClientNamespace;
    threads: FcaClientNamespace;
    users: FcaClientNamespace;
    account: FcaClientNamespace;
    realtime: FcaClientNamespace;
    http: FcaClientNamespace;
    scheduler: FcaClientNamespace;
}

declare function createFcaClient(api: LegacyApiLike): FcaClientFacade;

/** Tối thiểu để `MessengerContext.reply` gọi `sendMessage`. */
interface MessengerBotLike {
    readonly api: Loose;
    /** Internal: the running E2EE DM bridge (set by MessengerBot.startDmBridge). */
    _dmBridge?: Loose | null;
}
/**
 * Ngữ cảnh tin nhắn (tương tự `ctx` trong Telegraf): trả lời thread hiện tại, đọc `text` / `senderID`.
 */
declare class MessengerContext {
    readonly bot: MessengerBotLike;
    readonly event: MessageEvent;
    constructor(bot: MessengerBotLike, event: MessageEvent);
    get threadID(): MessageEvent["threadID"];
    get senderID(): MessageEvent["senderID"];
    get messageID(): string;
    /** Nội dung text đã trim (Messenger thường dùng `body`). */
    get text(): string;
    get body(): MessageEvent["body"];
    get message(): MessageEvent;
    /**
     * Gửi tin vào đúng thread của sự kiện (callback-style như API legacy).
     *
     * Sự kiện E2EE DM (`isE2eeDm`, từ dm-bridge) được trả lời bằng cách gõ
     * trực tiếp vào composer của tab mà bridge đang theo dõi — API paths
     * (mercury/MQTT) không ghi được vào backend Armadillo.
     */
    reply(payload: Loose, callback?: Loose): Loose;
    /** `reply` nhưng luôn trả về Promise khi `sendMessage` hỗ trợ promise. */
    replyAsync(payload: Loose): Promise<Loose>;
}

interface MessengerBotOptions extends FcaOptions {
    /** Gọi `listenMqtt` ngay sau login. Mặc định `true`. */
    autoListen?: boolean;
    /** Bật chuỗi `use` / `command` / `hears`. Mặc định `true`. */
    enableComposer?: boolean;
    /** Tiền tố lệnh cho `command()`. Mặc định `/`. */
    commandPrefix?: string;
    /** `process.once('SIGINT'|'SIGTERM')` → `stop()`. Mặc định `false`. */
    stopOnSignals?: boolean;
    /**
     * Giới hạn listener trên bot (EventEmitter). Mặc định 64.
     * Dùng 0 nếu cần không giới hạn (tốn RAM hơn khi gắn rất nhiều handler).
     */
    maxEventListeners?: number;
    /**
     * Incoming E2EE DM watcher. When browserSend is on, the bot additionally
     * polls the open Messenger tab (see transport/browser/dm-bridge.ts) and
     * re-emits 1:1 DMs as normal `message` events — so `bot.command` / `hears`
     * and the composer handle DMs exactly like group messages. Replies take
     * the normal sendMessage path (which falls back to the browser for DMs).
     *
     * - true        -> bridge with default settings (partners discovered from
     *                   incoming traffic are logged but need config to reply)
     * - { partners } -> bridge with explicit partner list (name -> userID)
     */
    dmBridge?: boolean | {
        partners?: {
            name: string;
            userID: string;
        }[];
        pollMs?: number;
        rescanMs?: number;
    };
}
type MessengerNext = () => Promise<void>;
type MessengerMiddleware = (ctx: MessengerContext, next: MessengerNext) => void | Promise<void>;
/**
 * Client kiểu Discord.js / Telegraf:
 * - Sự kiện: `messageCreate`, `raw`, `messageReactionAdd`, `messageDelete`, `typingStart` / `typingStop`, `threadUpdate`, `ready`, …
 * - Composer: `use`, `command`, `hears`, `catch` (chuỗi middleware + khớp lệnh / text).
 */
declare class MessengerBot extends EventEmitter implements MessengerBotLike {
    readonly ctx: FcaContext;
    readonly api: Loose;
    private _facade;
    private _mqtt;
    private _listening;
    private readonly _enableComposer;
    private _commandPrefix;
    private readonly _stopOnSignals;
    private readonly _dmBridgeOptions;
    private readonly _middlewares;
    private _catchHandler?;
    private _signalsBound;
    private _onStopSignal?;
    /** Running E2EE DM bridge (set by startDmBridge; read by MessengerContext.reply). */
    _dmBridge: Loose | null;
    private readonly _recentDmEvents;
    private constructor();
    get commandPrefix(): string;
    set commandPrefix(value: string);
    get client(): FcaClientFacade;
    /**
     * Middleware toàn cục (Telegraf-style). Gọi `next()` để chuyển sang lớp sau.
     */
    use(middleware: MessengerMiddleware): this;
    /**
     * Khớp `/{name}` hoặc `{prefix}{name}` ở đầu nội dung (không phân biệt hoa thường tên lệnh).
     */
    command(name: string, handler: (ctx: MessengerContext) => void | Promise<void>): this;
    /**
     * Chuỗi khớp toàn bộ text (RegExp) hoặc chứa substring (string).
     */
    hears(trigger: string | RegExp, handler: (ctx: MessengerContext) => void | Promise<void>): this;
    /**
     * Bắt lỗi ném ra trong composer (middleware / command / hears).
     */
    catch(handler: (err: unknown, ctx?: MessengerContext) => void): this;
    /** Bắt đầu MQTT (idempotent). */
    startListening(): this;
    /**
     * `startListening` + tùy chọn gắn SIGINT/SIGTERM (Telegraf `launch` gần tương đương).
     * Khi `dmBridge` được bật ở options, đây cũng là lúc bật DM watcher.
     */
    launch(opts?: {
        stopOnSignals?: boolean;
    }): Promise<this>;
    /**
     * Bật E2EE DM watcher: các tin nhắn 1:1 trên backend Armadillo (API không
     * đọc được) được poll từ tab Messenger và phát lại như sự kiện `message`
     * bình thường — chạy qua composer + các handler giống hệt tin nhóm.
     * - Không có partners: tự quét inbox, theo dõi MỌI hội thoại 1:1 (auto mode).
     * - Có partners: chỉ theo dõi những người được cấu hình.
     * Yêu cầu `browserSend` đã bật (login đã mở Chromium + profile hợp lệ).
     */
    startDmBridge(partners: {
        name: string;
        userID: string;
    }[]): this;
    private attachStopSignals;
    /** Gỡ handler SIGINT/SIGTERM để process không giữ reference bot (tối ưu RAM khi stop sớm). */
    private detachStopSignals;
    stop(): Promise<void>;
    private enqueueComposerIfNeeded;
    private runComposer;
    static connect(credentials: LoginCredentials$1, options?: MessengerBotOptions): Promise<MessengerBot>;
}
declare function createMessengerBot(credentials: LoginCredentials$1, options?: MessengerBotOptions): Promise<MessengerBot>;

declare function attachClientFacade(api: LegacyApiLike, namespaces?: FcaClientNamespaces): FcaClientFacade;

/**
 * Browser (CDP) DM sender.
 *
 * 1:1 personal messages now run on Facebook's "Armadillo" E2EE backend, which
 * the classic mercury/MQTT send paths cannot write to ("Thread Disabled",
 * occam_thread:null). The one reliable way to send a DM is through a real
 * Messenger tab logged in as the account — the page's Armadillo worker does
 * all the encryption.
 *
 * This module drives such a tab over the Chrome DevTools Protocol using only
 * dependencies the library already ships (`ws` + node http). It:
 *   1. opens a new tab at https://www.messenger.com/t/<userID> (Messenger
 *      redirects E2EE conversations to /e2ee/t/<threadKey>/),
 *   2. waits for the composer,
 *   3. types the message with trusted input and presses Enter,
 *   4. returns the resolved E2EE thread key + a synthetic message id.
 *
 * The browser itself is managed by the library (see profile.ts / launcher.ts
 * / index.ts): when `browserSend` is enabled, login verifies the bot profile
 * exists ("run fca-dm-login first" otherwise) and launches headless Chromium
 * with it on the debug port.
 */
interface BrowserDmSenderDeps {
    /** Chrome remote-debugging port. Defaults to 9222. */
    port?: number;
    logError?: (scope: string, error: Loose) => void;
}
interface BrowserDmSendParams {
    /** FB user ID to DM (NOT a group thread ID). */
    threadID: string;
    body: string;
}
interface BrowserDmSendResult {
    body: string | null;
    messageID: string | null;
    threadID: string | null;
    /** Extra detail for logs. */
    detail?: string;
}
/**
 * Send one text DM to `userID` through a logged-in Messenger browser tab.
 * Throws an object with `.error` on failure (including when Chrome/CDP is not
 * reachable or the account is not logged in).
 */
declare function createBrowserDmSender(deps: BrowserDmSenderDeps): (params: BrowserDmSendParams) => Promise<BrowserDmSendResult>;

/**
 * In-library E2EE DM bridge (ported from dmhelper/dm-bridge.js).
 *
 * Watches the open E2EE 1:1 chat in the bot's browser tab, emits DM events
 * in the same shape as API messages, and answers commands through the
 * composer (the page's Armadillo worker encrypts). Self-heals through the
 * walls a Messenger session can show: login, "Continue as", PIN restore,
 * wrong/missing thread.
 *
 * Usage (login already ran ensureBrowserForDms):
 *   const bridge = createDmBridge({ port: 9222, selfID, partners, targetUserID });
 *   bridge.on("message", ({ threadID, senderID, body }) => …);
 *   bridge.start();
 */
interface DmBridgePartner {
    /** Display name as shown in the chat header/sidebar. */
    name: string;
    /** FB user ID. */
    userID: string;
}
interface DmBridgeOptions {
    /** CDP port of the bot's Chromium (default 9222). */
    port?: number;
    /** Bot's own FB user ID. */
    selfID: string;
    /** How Messenger labels the bot's own messages ("You"). */
    selfLabel?: string;
    /** DM partners to bridge: display name -> user ID. */
    partners: DmBridgePartner[];
    /** E2EE thread key (auto-detected from the open tab when omitted). */
    threadKey?: string | null;
    /** Open a dedicated tab for this partner instead of reusing an existing tab. */
    targetUserID?: string;
    /** Open this exact URL instead of deriving it from targetUserID (auto mode). */
    targetURL?: string;
    /**
     * When true (auto mode), a bridge whose thread turns out NOT to be an
     * E2EE 1:1 chat (e.g. a group) stops itself — groups arrive via MQTT and
     * would be double-handled.
     */
    requireE2ee?: boolean;
    /** Called when the bridge gives up (recovery exhausted / tab closed). */
    onDead?: () => void;
    /** Poll interval ms (default 1500). */
    pollMs?: number;
    /** Optional logger (library logger signature). */
    log?: (text: string, type?: string) => void;
}
interface DmBridgeMessageEvent {
    threadID: string;
    senderID: string;
    body: string;
}
type Listener<T> = (payload: T) => void;
type SendResult = "sent" | "no-composer" | "clear-failed" | "composer-not-empty" | "not-started";
interface DmBridgeImpl {
    onMessage(fn: Listener<DmBridgeMessageEvent>): void;
    start(): void;
    stop(): void;
    /** Type `text` into the open composer and press Enter. */
    reply(text: string): Promise<SendResult>;
    /** Resolve config (e.g. detected thread key) — mainly for diagnostics. */
    getThreadKey(): string | null;
}
/** Create a DM bridge bound to the bot's browser. */
declare function createDmBridge(options: DmBridgeOptions): DmBridgeImpl;
interface AutoDmBridgeOptions {
    /** CDP port of the bot's Chromium (default 9222). */
    port?: number;
    /** Bot's own FB user ID. */
    selfID: string;
    /** Max conversation tabs kept open at once (default 15, FIFO eviction). */
    maxTabs?: number;
    /** How often to rescan the inbox for new conversations (default 60s). */
    rescanMs?: number;
    /** Per-thread poll interval (default 1500ms). */
    pollMs?: number;
    /** Optional logger (library logger signature). */
    log?: (text: string, type?: string) => void;
}
interface AutoDmBridgeImpl {
    onMessage(fn: Listener<DmBridgeMessageEvent & {
        dmBridge: Loose;
    }>): void;
    start(): void;
    stop(): void;
    /** Reply in a specific conversation (thread key -> its watcher). */
    replyIn(threadKey: string, text: string): Promise<SendResult | "unknown-thread">;
    /** Conversation keys currently watched. */
    watchedThreads(): string[];
}
/**
 * Auto DM bridge: watches the Messenger inbox, opens one watcher tab per
 * discovered conversation (E2EE 1:1 only — groups stay on MQTT), re-emits
 * incoming DMs, and rescans for new conversations periodically. No partner
 * list needed; everyone with an existing conversation gets covered.
 */
declare function createAutoDmBridge(options: AutoDmBridgeOptions): AutoDmBridgeImpl;

/**
 * Browser profile + Chromium binary resolution for the DM bridge stack.
 *
 * The "bot profile" is a Chrome user-data-dir that holds the logged-in
 * Messenger session (created once by a human — see bin/fca-dm-login.js).
 * Headless Chromium reuses it forever after; no captcha, no 2FA.
 */
/** Default profile location: <cwd>/dmhelper/bot-profile (matches dmhelper/). */
declare function defaultProfileDir(): string;
/** Resolve the profile dir from options (override) or the default location. */
declare function resolveProfileDir(option?: string | {
    profileDir?: string;
}): string;
/**
 * True when the profile directory exists AND looks like a real Chrome profile
 * (has a Default/ subdirectory), i.e. it was actually used by Chrome at least
 * once — not just an empty folder someone created.
 */
declare function hasUsableProfile(profileDir: string): boolean;
/** Instructive error text for the missing-profile case. */
declare function missingProfileError(profileDir: string): Error;
/** Locate a Chromium/Chrome binary across platforms. */
declare function findChromiumBinary(): string | null;

/**
 * Chromium launcher for the DM bridge stack.
 *
 * Spawns Chromium --headless=new with the bot profile on the CDP port, but
 * only when nothing is already listening there (idempotent). The library
 * never requires a display: the profile carries the login session.
 */
/** True when something already answers on the CDP port. */
declare function isCdpAlive(port?: number): Promise<boolean>;
/** Wait until the CDP endpoint answers (or timeout). */
declare function waitForCdp(port: number, timeoutMs: number): Promise<boolean>;
interface LaunchChromiumDeps {
    port?: number;
    profileDir: string;
    headless?: boolean;
    log?: (line: string) => void;
}
interface LaunchChromiumResult {
    started: boolean;
    binary: string;
}
/**
 * Ensure a Chromium with the given profile is running on the CDP port.
 * Returns which binary was used. Throws { error } when no binary is found.
 */
declare function ensureChromium(deps: LaunchChromiumDeps): Promise<LaunchChromiumResult>;

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

interface EnsureBrowserDeps {
    /** browserSend option value: true | { port?, profileDir? } */
    option: boolean | {
        port?: number;
        profileDir?: string;
    } | undefined;
    log?: (text: string, type?: string) => void;
}
interface EnsureBrowserResult {
    port: number;
    profileDir: string;
    started: boolean;
}
/** Parse the browserSend option into concrete port/profile. */
declare function parseBrowserSendOption(option: EnsureBrowserDeps["option"]): {
    port: number;
    profileDir: string;
};
/**
 * Validate + launch the browser side of DM support. Throws a descriptive
 * Error when the profile is missing (first-run on a new machine).
 */
declare function ensureBrowserForDms(deps: EnsureBrowserDeps): Promise<EnsureBrowserResult>;

type NodeStyleCallback<T> = (err?: Loose, data?: T) => void;

interface LegacyDefaultFuncs {
    post: (url: string, jar?: Loose, form?: Loose, qs?: Loose, options?: Loose, customHeader?: Loose) => Promise<Loose>;
}
interface MqttPublishClient {
    publish: (topic: string, payload: string, options: {
        qos: number;
        retain: boolean;
    }, callback?: (err?: Loose) => void) => void;
}
interface MqttRequestClient extends MqttPublishClient {
    on: (event: "message", listener: (topic: string, message: Buffer | string) => void) => void;
    removeListener: (event: "message", listener: (topic: string, message: Buffer | string) => void) => void;
    setMaxListeners?: (count: number) => void;
}

type MessageReaction = string | null;
interface SetMessageReactionResult {
    success: boolean;
}
interface ChangeThreadEmojiResult {
    success: true;
}
interface ShareContactResult {
    success: true;
}
type ChangeThreadColorResult = {
    success: true;
} | {
    body: string;
    messageID: string;
};
interface ChangeGroupImageResult {
    success: true;
    response: Loose;
}
interface EditMessageResult {
    body: string;
    messageID: string;
}
interface DeleteMessageResult {
    success: true;
    response: Loose;
}
type UnsendMessageResult = {
    success: true;
} | {
    body: string;
    messageID: string;
};
interface ForwardAttachmentResult {
    success: true;
}
type ThreadColorMap = Record<string, string>;
interface SendTypingOptions {
    duration?: number;
    autoStop?: boolean;
    type?: number;
}
interface SendMessageMention {
    id: string | number;
    tag: string;
    fromIndex?: number;
}
interface MentionPayload {
    mentions?: SendMessageMention[];
}
interface SendMessageLocation {
    latitude: number;
    longitude: number;
    current?: boolean;
    live?: boolean;
}
interface LocationPayload {
    location: SendMessageLocation;
}
type SendMessageEmojiSize = "small" | "medium" | "large" | number;
interface EmojiPayload {
    emoji: string;
    emojiSize?: SendMessageEmojiSize;
}
type StreamAttachment = NodeJS.ReadableStream | Buffer;
type PreUploadedAttachment = [string, string | number];
type SendMessageAttachment = StreamAttachment | PreUploadedAttachment;
interface UploadAttachmentDescriptor {
    buffer?: Buffer;
    data?: Buffer;
    stream?: NodeJS.ReadableStream;
    url?: string;
    path?: string;
    filename?: string;
    contentType?: string;
}
type UploadAttachmentInput = StreamAttachment | string | UploadAttachmentDescriptor;
interface UploadAttachmentOptions {
    concurrency?: number;
    mode?: "single" | "parallel";
}
type UploadAttachmentMetadata = Record<string, string | number> & {
    filename?: string;
    filetype?: string;
    thumbnail_src?: string;
};
type UploadAttachmentResult = UploadAttachmentMetadata[];
interface TextPayload {
    body: string;
}
interface AttachmentPayload {
    attachment: SendMessageAttachment | SendMessageAttachment[];
}
interface StickerPayload {
    sticker: string | number;
}
interface UrlPayload {
    url?: string;
}
interface ReplyPayload {
    replyToMessage: string;
}
interface ForwardPayload {
    forwardAttachmentIds: Array<string | number>;
}
type SendMessageContentPayload = TextPayload | AttachmentPayload | EmojiPayload | LocationPayload | StickerPayload | (TextPayload & AttachmentPayload);
type SendMessageObjectPayload = SendMessageContentPayload & MentionPayload & UrlPayload & Partial<ReplyPayload> & Partial<ForwardPayload>;
type SendMessagePayload = string | SendMessageObjectPayload | null | undefined;
interface SendMessageResult {
    body: string | null;
    messageID: string | null;
    threadID: string | null;
}

interface SendMessageContext {
    mqttClient?: MqttRequestClient | null;
    wsReqNumber?: number;
    wsTaskNumber?: number;
    userID?: string;
    jar?: Loose;
    clientID?: string;
    clientId?: string;
    globalOptions?: Loose;
    [key: string]: Loose;
}
interface SendMessageCommandDeps {
    ctx: SendMessageContext;
    defaultFuncs: LegacyDefaultFuncs;
    uploadAttachment: (attachments: StreamAttachment[]) => Promise<UploadAttachmentResult>;
    generateOfflineThreadingID: () => string;
    generateThreadingID: (clientID: string) => string;
    generateTimestampRelative: () => string;
    getSignatureID: () => string;
    isReadableStream: (value: Loose) => boolean;
    logError?: (scope: string, error: Loose) => void;
    /**
     * Optional last-resort sender for 1:1 DMs. Facebook routes personal messages
     * through its E2EE ("Armadillo") backend, which the mercury/MQTT paths below
     * cannot write to. When configured, and the target is a user (not a group),
     * a failed API send falls back to sending through a logged-in Messenger
     * browser tab (see src/transport/browser/cdp-send.ts).
     */
    browserSend?: (params: {
        threadID: string;
        body: string;
    }) => Promise<SendMessageResult>;
}

interface MarkReadCommandDeps {
    defaultFuncs: LegacyDefaultFuncs;
    ctx: FcaContext;
    logError?: (scope: string, error: Loose) => void;
}

interface SendTypingIndicatorCommandDeps {
    ctx: FcaContext;
    logError?: (scope: string, error: Loose) => void;
}

interface MarkSeenCommandDeps {
    defaultFuncs: LegacyDefaultFuncs;
    ctx: FcaContext;
    logError?: (scope: string, error: Loose) => void;
}

interface MarkDeliveredCommandDeps {
    defaultFuncs: LegacyDefaultFuncs;
    ctx: FcaContext;
    logError?: (scope: string, error: Loose) => void;
}

interface MarkReadAllCommandDeps {
    defaultFuncs: LegacyDefaultFuncs;
    ctx: FcaContext;
    logError?: (scope: string, error: Loose) => void;
}

interface SetMessageReactionCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    getCurrentTimestamp: () => string | number;
    logError?: (scope: string, error: Loose) => void;
}

interface ShareContactCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface EditMessageCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface DeleteMessageCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface UnsendMessageCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface ForwardAttachmentCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface UploadAttachmentLogger {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
}
interface UploadAttachmentCommandDeps {
    ctx: {
        jar?: Loose;
        options?: {
            userAgent?: string;
        };
        userID?: string;
        userId?: string;
    };
    logger?: UploadAttachmentLogger;
    logError?: (scope: string, error: Loose) => void;
}

interface ChangeThreadColorCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface ChangeThreadEmojiCommandDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface ResolvePhotoUrlQueryDeps {
    defaultFuncs: {
        get: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: {
        jar: Loose;
    };
    logError?: (scope: string, error: Loose) => void;
}

interface GetMessageQueryDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: {
        jar: Loose;
        userID?: string;
        globalOptions?: {
            pageID?: string;
        };
    };
    logError?: (scope: string, error: Loose) => void;
}

interface MessagesDomainDeps {
    send: SendMessageCommandDeps;
    markRead: MarkReadCommandDeps;
    typing: SendTypingIndicatorCommandDeps;
    markSeen?: MarkSeenCommandDeps;
    markDelivered?: MarkDeliveredCommandDeps;
    markReadAll?: MarkReadAllCommandDeps;
    reaction: SetMessageReactionCommandDeps;
    uploadAttachment?: UploadAttachmentCommandDeps;
    edit?: EditMessageCommandDeps;
    delete?: DeleteMessageCommandDeps;
    unsend?: UnsendMessageCommandDeps;
    forwardAttachment?: ForwardAttachmentCommandDeps;
    shareContact?: ShareContactCommandDeps;
    threadColor: ChangeThreadColorCommandDeps;
    threadEmoji: ChangeThreadEmojiCommandDeps;
    get?: GetMessageQueryDeps;
    photoUrl?: ResolvePhotoUrlQueryDeps;
}
declare function createMessagesDomain(deps: MessagesDomainDeps): {
    [k: string]: any;
};

interface GetThreadInfoQueryDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    api: Loose;
    ctx: {
        jar: Loose;
    };
    logError?: (scope: string, error: Loose) => void;
}

interface GetThreadListQueryDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: {
        jar: Loose;
        userID?: string;
    };
    logError?: (scope: string, error: Loose) => void;
}

interface GetThreadHistoryQueryDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: {
        jar: Loose;
        userID?: string;
    };
    logError?: (scope: string, error: Loose) => void;
}

interface GetThreadPicturesQueryDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: {
        jar: Loose;
    };
    logError?: (scope: string, error: Loose) => void;
}

interface MuteThreadCommandDeps {
    defaultFuncs: LegacyDefaultFuncs;
    ctx: FcaContext;
    logError?: (scope: string, error: Loose) => void;
}

interface ChangeArchivedStatusCommandDeps {
    defaultFuncs: LegacyDefaultFuncs;
    ctx: FcaContext;
    logError?: (scope: string, error: Loose) => void;
}

interface AddUsersToGroupCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface RemoveUserFromGroupCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface ChangeAdminStatusCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface ChangeGroupImageCommandDeps {
    defaultFuncs: {
        postFormData: (url: string, jar: Loose, form: Record<string, Loose>, query?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface ChangeNicknameCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface CreateNewGroupCommandDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: FcaContext & {
        jar: Loose;
    };
    logError?: (scope: string, error: Loose) => void;
}

interface CreatePollCommandDeps {
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface ThemeAssetImage {
    url: string | null;
}
interface ThemeBackgroundAsset {
    id: string | null;
    image: ThemeAssetImage;
}
interface CreateThemeAIResult {
    id: string;
    accessibility_label: string | null;
    background_asset: ThemeBackgroundAsset;
}
type ThemePicturesResult = Loose;

interface CreateThemeAICommandDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: {
        jar: Loose;
        userID?: string;
    };
    createClientMutationId?: () => string;
    logError?: (scope: string, error: Loose) => void;
}

interface HandleMessageRequestCommandDeps {
    defaultFuncs: LegacyDefaultFuncs;
    ctx: FcaContext;
    logError?: (scope: string, error: Loose) => void;
}

interface DeleteThreadCommandDeps {
    defaultFuncs: LegacyDefaultFuncs;
    ctx: FcaContext;
    logError?: (scope: string, error: Loose) => void;
}

interface SetTitleCommandDeps {
    defaultFuncs: LegacyDefaultFuncs;
    ctx: FcaContext;
    generateOfflineThreadingID: () => string;
    generateTimestampRelative: () => string;
    generateThreadingID: (clientID: string) => string;
    logError?: (scope: string, error: Loose) => void;
}

interface SearchForThreadQueryDeps {
    defaultFuncs: LegacyDefaultFuncs;
    ctx: FcaContext;
    logError?: (scope: string, error: Loose) => void;
}

interface GetThemePicturesQueryDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: {
        jar: Loose;
        userID?: string;
    };
    logError?: (scope: string, error: Loose) => void;
}

interface ThreadsDomainDeps {
    info: GetThreadInfoQueryDeps;
    list: GetThreadListQueryDeps;
    history: GetThreadHistoryQueryDeps;
    pictures: GetThreadPicturesQueryDeps;
    color?: ChangeThreadColorCommandDeps;
    emoji?: ChangeThreadEmojiCommandDeps;
    mute?: MuteThreadCommandDeps;
    archive?: ChangeArchivedStatusCommandDeps;
    addUsers?: AddUsersToGroupCommandDeps;
    removeUser?: RemoveUserFromGroupCommandDeps;
    adminStatus?: ChangeAdminStatusCommandDeps;
    groupImage?: ChangeGroupImageCommandDeps;
    nickname?: ChangeNicknameCommandDeps;
    createGroup?: CreateNewGroupCommandDeps;
    createPoll?: CreatePollCommandDeps;
    createThemeAI?: CreateThemeAICommandDeps;
    messageRequest?: HandleMessageRequestCommandDeps;
    deleteThread?: DeleteThreadCommandDeps;
    title?: SetTitleCommandDeps;
    search?: SearchForThreadQueryDeps;
    themePictures?: GetThemePicturesQueryDeps;
}
declare function createThreadsDomain(deps: ThreadsDomainDeps): {
    [k: string]: any;
};

type ListenerCallback = (error: ListenMqttError | null, event?: MqttEvent | null) => void;
interface RealtimeMessageEmitter {
    stopListening: (callback?: () => void) => void;
    stopListeningAsync: () => Promise<void>;
    [key: string]: Loose;
}
interface RealtimeListenerDeps {
    EventEmitter: Loose;
    logger: (text: string, type?: string) => void;
    emitAuth: (ctx: Loose, api: Loose, globalCallback: ListenerCallback, reason: string, detail?: string) => void;
    createMiddlewareSystem: () => {
        use: (middleware: Loose, fn?: Loose) => Loose;
        remove: (identifier: Loose) => boolean;
        clear: () => void;
        list: () => string[];
        setEnabled: (name: string, enabled: boolean) => boolean;
        wrapCallback: (callback: ListenerCallback) => ListenerCallback;
        count: number;
    };
    topics: readonly string[];
    listenMqttCore: (defaultFuncs: Loose, api: Loose, ctx: Loose, globalCallback: ListenerCallback) => void;
    getSeqIDFactory: (defaultFuncs: Loose, api: Loose, ctx: Loose, globalCallback: ListenerCallback, form: Record<string, Loose>, retryCount?: number) => Promise<void>;
}
declare function createRealtimeListener(deps: RealtimeListenerDeps): (defaultFuncs: Loose, api: Loose, ctx: Loose, opts?: Record<string, Loose>) => (callback?: ListenerCallback) => RealtimeMessageEmitter;

declare function createRealtimeDomain(deps: Parameters<typeof createRealtimeListener>[0]): {
    listen: (defaultFuncs: Loose, api: Loose, ctx: Loose, opts?: Record<string, Loose>) => (callback?: (error: ListenMqttError | null, event?: MqttEvent | null) => void) => RealtimeMessageEmitter;
};

interface GetUserInfoQueryDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    api: Loose;
    ctx: Loose;
    logger?: (text: string, type?: string) => void;
    logError?: (scope: string, error: Loose) => void;
}

interface GetUserInfoV2QueryDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: Loose;
    logger?: (text: string, type?: string) => void;
}

interface GetUserIdQueryDeps {
    defaultFuncs: {
        get: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: {
        userID: string;
        clientId: string;
        jar: Loose;
    };
    logError?: (scope: string, error: Loose) => void;
}

interface GetFriendsListQueryDeps {
    defaultFuncs: {
        postFormData: (url: string, jar: Loose, form: Record<string, Loose>, query?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: {
        jar: Loose;
        userID?: string;
    };
    logError?: (scope: string, error: Loose) => void;
}

interface UsersDomainDeps {
    info: GetUserInfoQueryDeps;
    infoV2: GetUserInfoV2QueryDeps;
    idLookup: GetUserIdQueryDeps;
    friendsList?: GetFriendsListQueryDeps;
}
declare function createUsersDomain(deps: UsersDomainDeps): {
    [k: string]: any;
};

interface GetCurrentUserIdCommandDeps {
    ctx: {
        userID?: string;
    };
}

interface LogoutCommandDeps {
    defaultFuncs: {
        get: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: Loose;
    logInfo?: (scope: string, message: string) => void;
    logError?: (scope: string, error: Loose) => void;
}

interface RefreshFbDtsgCommandDeps {
    ctx: Loose;
}

interface AddExternalModuleCommandDeps {
    defaultFuncs: Loose;
    api: Loose;
    ctx: Loose;
}

interface EnableAutoSaveAppStateCommandDeps {
    api: {
        getAppState: () => Loose;
    };
    ctx: Loose;
    logger?: (text: string, type?: string) => void;
}

interface ChangeBioCommandDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: Loose;
    logError?: (scope: string, error: Loose) => void;
}

interface ChangeAvatarCommandDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
        postFormData: (url: string, jar: Loose, form: Record<string, Loose>, query?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: Loose;
    isReadableStream: (value: Loose) => value is NodeJS.ReadableStream;
    logError?: (scope: string, error: Loose) => void;
}

interface HandleFriendRequestCommandDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: Loose;
    logError?: (scope: string, error: Loose) => void;
}

interface UnfriendCommandDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: Loose;
    logError?: (scope: string, error: Loose) => void;
}

interface SetPostReactionCommandDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: Loose;
    logError?: (scope: string, error: Loose) => void;
}

interface ChangeBlockedStatusCommandDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: Loose;
    logError?: (scope: string, error: Loose) => void;
}

interface AccountDomainDeps {
    addExternalModule: AddExternalModuleCommandDeps;
    currentUserId: GetCurrentUserIdCommandDeps;
    enableAutoSaveAppState: EnableAutoSaveAppStateCommandDeps;
    logout: LogoutCommandDeps;
    refreshFbDtsg: RefreshFbDtsgCommandDeps;
    changeAvatar: ChangeAvatarCommandDeps;
    changeBio: ChangeBioCommandDeps;
    handleFriendRequest: HandleFriendRequestCommandDeps;
    unfriend: UnfriendCommandDeps;
    setPostReaction: SetPostReactionCommandDeps;
    changeBlockedStatus?: ChangeBlockedStatusCommandDeps;
}
declare function createAccountDomain(deps: AccountDomainDeps): {
    [k: string]: any;
};

interface HttpGetQueryDeps {
    defaultFuncs: {
        get: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<{
            data: Loose;
        }>;
    };
    ctx: {
        jar: Loose;
    };
}

interface HttpPostCommandDeps {
    defaultFuncs: {
        post: (url: string, jar: Loose, form?: Record<string, Loose>, options?: Record<string, Loose>) => Promise<{
            data: Loose;
        }>;
    };
    ctx: {
        jar: Loose;
        globalOptions?: Record<string, Loose>;
    };
}

interface PostFormDataCommandDeps {
    defaultFuncs: {
        postFormData: (url: string, jar: Loose, form: Record<string, Loose>, query?: Record<string, Loose>) => Promise<Loose>;
    };
    ctx: Loose;
    logError?: (scope: string, error: Loose) => void;
}

interface HttpDomainDeps {
    get: HttpGetQueryDeps;
    post: HttpPostCommandDeps;
    postFormData: PostFormDataCommandDeps;
}
declare function createHttpDomain(deps: HttpDomainDeps): {
    get: (url: string, form?: Record<string, Loose> | NodeStyleCallback<Loose>, callback?: NodeStyleCallback<Loose>, notAPI?: boolean) => Promise<any>;
    post: (url: string, form?: Record<string, Loose> | NodeStyleCallback<Loose>, callback?: NodeStyleCallback<Loose>, notAPI?: boolean) => Promise<any>;
    postFormData: (url: string, form?: Record<string, Loose> | NodeStyleCallback<Loose>, callback?: NodeStyleCallback<Loose>) => Promise<any>;
};

interface SchedulerOptions {
    replyMessageID?: string;
    isGroup?: boolean;
    callback?: (...args: Loose[]) => void;
}
interface ScheduledMessageInfo {
    id: string;
    message: Loose;
    threadID: Loose;
    timestamp: number;
    createdAt: number;
    options: SchedulerOptions;
    timeUntilSend: number;
}
interface SchedulerDomain {
    scheduleMessage: (message: Loose, threadID: Loose, when: Date | number | string, options?: SchedulerOptions) => string;
    cancelScheduledMessage: (id: string) => boolean;
    getScheduledMessage: (id: string) => ScheduledMessageInfo | null;
    listScheduledMessages: () => ScheduledMessageInfo[];
    cancelAllScheduledMessages: () => number;
    getScheduledCount: () => number;
    cleanup: () => void;
    destroy: () => number;
    _cleanupInterval: ReturnType<typeof setInterval>;
}

interface SchedulerDomainDeps {
    sendMessage: (...args: Loose[]) => Promise<Loose> | Loose;
    logger?: (message: string, level?: string) => void;
    now?: () => number;
    setTimeoutFn?: typeof setTimeout;
    clearTimeoutFn?: typeof clearTimeout;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
}
declare function createSchedulerDomain(deps: SchedulerDomainDeps): SchedulerDomain;

interface RequestCore {
    get: (...args: Loose[]) => Promise<Loose>;
    post: (...args: Loose[]) => Promise<Loose>;
    postFormData: (...args: Loose[]) => Promise<Loose>;
    jar: Loose;
    makeDefaults: (...args: Loose[]) => Loose;
    client?: Loose;
    setProxy?: (proxyUrl?: string) => void;
}
interface AuthCore {
    REGION_MAP: Map<string, {
        code: string;
        name: string;
        location: string;
    }>;
    parseRegion: (html: string) => string;
    normalizeCookieHeaderString: (cookieHeader: string) => string[];
    setJarFromPairs: (jar: Loose, pairs: string[], domain: string) => void;
}
interface StateCore {
    createFcaState: (input: Record<string, Loose>) => FcaState;
    createApiFacade: (params: Record<string, Loose>) => Record<string, Loose>;
    attachThreadUpdater: (ctx: FcaState, models: Loose, logger: (text: string, type?: string) => void) => boolean;
}
interface MqttCore {
    attachMqttCompatibility: (api: Record<string, Loose>, options?: {
        logger?: (text: string, type?: string) => void;
        refreshIntervalMs?: number;
    }) => NodeJS.Timeout | null;
}

export { type AccountInactiveEvent, type AttachmentPayload, type AuthCore, type ChangeGroupImageResult, type ChangeThreadColorResult, type ChangeThreadEmojiResult, type CreateThemeAIResult, type DeleteMessageResult, type DmBridgeOptions, type DmBridgePartner, type EditMessageResult, type EmojiPayload, type EnsureBrowserDeps, type EnsureBrowserResult, type EventBase, type FcaClientFacade, type FcaClientNamespace, type FcaClientNamespaces, type FcaGlobalOptions, type FcaID, type FcaState, type ForwardAttachmentResult, type ForwardPayload, type FriendRequestCancelEvent, type FriendRequestReceivedEvent, type LegacyApiLike, type ListenMqttError, type LocationPayload, type LoginApiCallback, type LoginCredentials, type MentionPayload, type MessageEvent, type MessageReaction, type MessageUnsendEvent, MessengerBot, type MessengerBotLike, type MessengerBotOptions, MessengerContext, type MessengerMiddleware, type MessengerNext, type MqttCore, type MqttEvent, type PreUploadedAttachment, type PresenceEvent, type ReactionEvent, type ReadEvent, type ReadyEvent, type ReplyPayload, type RequestCore, type ScheduledMessageInfo, type SchedulerDomain, type SchedulerOptions, type SendMessageAttachment, type SendMessageContentPayload, type SendMessageEmojiSize, type SendMessageLocation, type SendMessageMention, type SendMessageObjectPayload, type SendMessagePayload, type SendMessageResult, type SendTypingOptions, type SetMessageReactionResult, type ShareContactResult, type StateCore, type StickerPayload, type StopListenEvent, type StreamAttachment, type TextPayload, type ThemeAssetImage, type ThemeBackgroundAsset, type ThemePicturesResult, type ThreadColorMap, type ThreadEvent, type TypingEvent, type UnsendMessageResult, type UploadAttachmentDescriptor, type UploadAttachmentInput, type UploadAttachmentMetadata, type UploadAttachmentOptions, type UploadAttachmentResult, type UrlPayload, attachClientFacade, attachThreadInfoRealtimeSync, checkForPackageUpdate, createAccountDomain, createApiFacade, createAuthCore, createAutoDmBridge, createBrowserDmSender, createDefaultContext, createDmBridge, createFcaClient, createFcaState, createHttpDomain, createMessagesDomain, createMessengerBot, createRealtimeDomain, createRequestHelper, createSchedulerDomain, createThreadsDomain, createUsersDomain, login as default, defaultConfig, defaultProfileDir, ensureBrowserForDms, ensureChromium, findChromiumBinary, hasUsableProfile, isCdpAlive, listenMqtt, loadConfig, login, loginAsync, loginLegacy, missingProfileError, normalizeCookieHeaderString, parseBrowserSendOption, resolveConfig, resolveProfileDir, runConfiguredUpdateCheck, setJarFromPairs, waitForCdp, writeConfigTemplate };
