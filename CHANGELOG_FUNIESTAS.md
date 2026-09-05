# Changelog (Funiestas Bug-Fix Pass)

All notable bug fixes from the full architecture audit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) where applicable.

---

## [Unreleased]

### Fixed

#### Realtime (MQTT) — behavior & reliability

- **Inverted presence gate** (`transport/realtime/connect-mqtt.ts`): the `/orca_presence` handler emitted presence events only when `updatePresence` was **false** (the default), flooding every user with `presence` events and giving users who explicitly opted in (`updatePresence: true`) none. The condition is now `if (ctx.globalOptions.updatePresence)` — presence is emitted **only** when opted in, matching upstream FCA behavior.
- **Middleware changes never reached the live connection** (`domains/realtime/listener.ts`, `transport/realtime/connect-mqtt.ts`): `rewrapCallbackIfNeeded()` updated the listener's outer `globalCallback`, but the active MQTT client's handlers kept using the callback value captured at connect time; `connect-mqtt`'s own reconnect path also reused its captured parameter. Middleware added/removed mid-session only took effect after a full `getSeqID → listenMqttCore` cycle. The MQTT handlers now dereference `ctx.globalCallback` at call time, the listener publishes every re-wrap (and `stopListening`'s reset to a no-op) onto `ctx.globalCallback`, and reconnects pass the freshest callback — middleware changes apply to the live connection immediately, and a stopped listener truly stops emitting.
- **`/ls_resp` task map leak** (`transport/realtime/connect-mqtt.ts`): resolved `/ls_resp` request entries were never deleted from `ctx.tasks`, growing the map without bound for the lifetime of the process. Entries are now consumed (`delete`) after their callback fires.
- **Double-`next()` in middleware pipeline** (`domains/realtime/middleware.ts`): a middleware calling `next()` twice (or returning a value after resolving an async `next()`) could complete the pipeline twice. The pipeline is now settled-once with warnings on redundant completions.

#### Commands — numeric precision

- **Precision loss via `Number.parseInt` on values above `Number.MAX_SAFE_INTEGER`**: offline-threading IDs (`generateOfflineThreadingID()` ≈ `Date.now() << 22`) and 16–17-digit thread keys were silently corrupted when parsed as JS numbers.
  - `messages/commands/send-typing-indicator.ts`: `thread_key` is now passed as a string.
  - `messages/commands/set-message-reaction.ts`, `edit-message.ts`, `delete-message.ts`, `unsend-message.ts` and `threads/commands/change-thread-color.ts`: `epoch_id` is now passed as a string, matching what `send-message.ts`, `share-contact.ts`, `forward-attachment.ts` and the thread commands already did correctly.

#### Transport (HTTP) — uploads

- **Upload retry replayed a drained stream** (`transport/http/upload-attachment.ts`): `form.append("farr", file.stream, …)` sat inside the retry loop, so on attempt 2+ the body stream had already been consumed by attempt 1 — retried uploads sent an empty/closed stream and could never succeed. The stream is now buffered into memory once and replayed from the buffer on every attempt.

#### Core — options & config

- **`setOptions` silently dropped `pageID`** (`core/options.ts`): `pageID` (declared in `FcaOptions`) had no case in the option switch, so it fell into the "Unrecognized option" default branch and was never written to `globalOptions`. Consequence: page-scoped behavior (e.g. `markAsRead` via page HTTP transport) was unreachable from user options. `pageID` (and `logLevel`) are now accepted and stored; object-valued config options (`autoUpdate`, `checkUpdate`) are accepted without a spurious warning.
- **`autoUpdate` config precedence** (`core/config.ts`): `config.autoUpdate = config.checkUpdate.enabled` at the end of `resolveConfig()` overrode an explicit `autoUpdate: false` whenever `checkUpdate.enabled` was true. Now `checkUpdate.enabled` defaults to `autoUpdate` only when the config did not set it, and an explicit `autoUpdate` value always wins; explicit `checkUpdate.enabled` values (including `"true"`/`"false"` strings) are still honored.
- **Global `uncaughtException` handler swallowed every crash** (`core/auth.ts`): the handler logged "attempting to continue" for all unknown exceptions, letting the process run on in an undefined state (half-written state files, broken invariants). The handler was removed — Node's default behavior (print and exit non-zero) applies. The `unhandledRejection` filter for known network noise remains.

#### Event formatting

- **Missing `break` in `formatDeltaEvent`** (`utils/format/delta.ts`): the `case "UserLocation":` block fell through into `case "ApprovalQueue":`, overwriting `logMessageType`/`logMessageData` — live-location events were emitted as bogus `log:approval-queue` events with `action`/`recipientFbId` = `undefined`. Both cases now `break` correctly, so `log:user-location` events carry their real payload.
- **`getData_Path` never advanced its counter** (`utils/format/utils.ts`): the recursion passed `Stt++` (post-increment → old value) instead of `Stt + 1`, so the depth counter never advanced.

#### App layer

- **Stateful `RegExp` triggers in `hears()`** (`app/messenger-bot.ts`): a user-supplied `/g` regex kept its `lastIndex` across messages, causing intermittent non-matches for patterns that matched mid-string. `lastIndex` is reset before each `test()`.

---

## Notes

- Entries are grouped by subsystem instead of severity; the most impactful fixes are the presence gate, `pageID` handling, the upload retry, and the middleware re-wrap.
- No public API signatures changed: all fixes are behavior corrections within the existing contracts.
