# dmhelper — E2EE DM bridge for a headless VPS

Facebook routes 1:1 DMs through its E2EE ("Armadillo") backend, which no API
path can write to. This folder bundles everything needed to bridge those DMs
through a **headless Chromium** on a VPS — no display, no real Chrome window.

```
dmhelper/
├── README.md          this file
├── lib/
│   └── cdp.js         shared CDP client (http + ws only, no puppeteer)
├── start-chrome.sh    launches headless Chromium on :9222 (xvfb fallback)
├── login-remote.js    injects appstate.json cookies / login form + 2FA
├── dm-bridge.js       watches the open E2EE chat, logs + replies to DMs
└── start-all.sh       chrome + run.js + dm-bridge in one command
```

## Quick start

### A. Fresh VPS with a logged-in profile (normal case)

The profile (`dmhelper/bot-profile/`) is the credential — it holds the
logged-in session, and headless Chrome reuses it with no captcha/2FA. Create
it once on a machine with a display (see B), then:

```bash
# on your PC: ship project + profile
tar -czf bot-profile.tar.gz -C dmhelper bot-profile   # if not already packed
scp bot-profile.tar.gz user@vps:~/bot/
rsync -av --exclude node_modules --exclude dmhelper/bot-profile ./ user@vps:~/bot/

# on the VPS
cd ~/bot
tar -xzf bot-profile.tar.gz -C dmhelper
npm install                       # once
bash dmhelper/start-all.sh        # chrome + run.js + dm-bridge
tail -f bot.log bridge.log
```

On boot the bridge self-heals: it clicks through the "Continue as" wall and
auto-clicks "Restore without PIN" if the E2EE PIN prompt appears on the new
device, then locks onto the thread.

### B. No profile yet (create the session once, needs a display)

Fresh logins in headless hit an Arkose captcha no script passes — so do this
once in a **headed** Chrome:

1. Local PC (or any machine with a screen):

   ```bash
   bash dmhelper/start-chrome.sh          # or start Chrome manually:
   # chrome --remote-debugging-port=9222 --user-data-dir="$(pwd)/dmhelper/bot-profile"
   ```

   (On a headless VPS you'd tunnel instead: `ssh -L 9222:localhost:9222 user@vps`
   and open `http://localhost:9222` in your local browser.)

2. Open `http://localhost:9222` in your own browser, click the Chrome tab,
   log in to Facebook by hand (captcha, 2FA, "Keep me signed in").
3. `node dmhelper/login-remote.js` — it waits and confirms the session.
4. In Messenger, open the bot's DM thread once (or just let dm-bridge click
   the sidebar conversation on its own).
5. Then package the profile as in A.

> Deleting `bot-profile` = logged out. Keep a backup of the tarball somewhere
> safe; it IS the account session.

## How the pieces talk

- `run.js` (project root) keeps `browserSend: { port: 9222 }` → when an API
  send to a 1:1 thread fails, the library drives a Messenger tab through the
  same port (see `src/transport/browser/cdp-send.ts`).
- `dm-bridge.js` polls the chat's accessibility tree over the same port, logs
  incoming DMs to `bot.log` in the same format as group messages, and replies
  `/ping`, `hi` via the composer (the page's Armadillo worker encrypts).
- Everything connects to `127.0.0.1:9222`; nothing is exposed publicly.

## Config

`dm-bridge.js` top-of-file `CONFIG`:
- `selfID` / `selfLabel` — bot's FB ID and how its own messages are labeled
- `partners` — chat display name → FB user ID (extend per DM partner)
- `pollMs` — scan interval (default 1500 ms)

Env: `DM_BRIDGE_DEBUG=1` for per-poll diagnostics.
Port: pass `--port` to any script (default 9222).

## systemd (run permanently)

```ini
# /etc/systemd/system/fca-bot.service
[Unit]
Description=FCA Messenger bot
After=network.target

[Service]
WorkingDirectory=/root/bot
ExecStart=/bin/bash dmhelper/start-all.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Security

- Never expose 9222 publicly — DevTools access = full account control.
  Only SSH tunneling, or localhost on the VPS itself.
- `bot-profile/` and `appstate.json` hold full sessions: `chmod 600`, keep out
  of git (already in `.gitignore` via `appstate.json`; run
  `echo "dmhelper/bot-profile/" >> .gitignore` to be safe).

## Troubleshooting

| Symptom | What happens / fix |
|---|---|
| `dm-bridge` logs "PIN wall shown" | Facebook asks for the E2EE backup PIN on a new device. The bridge auto-clicks "Restore without PIN" when offered (old history is lost, new messages still work). If no skip option appears, tunnel in (`ssh -L`) and enter the PIN once — the choice persists in the profile. |
| "Continue as \<name>" wall | Auto-clicked by `dm-bridge` on boot; `cdp-send.ts` (the `browserSend` fallback in run.js) clicks it too. |
| Cookie injection says "session rejected" | Normal for moved/refreshed sessions — web sessions are device-bound. Use the headed-login flow (log in once in a visible Chrome window using this profile), then ship the profile. |
| Arkose captcha during automated form login | Headless logins often trigger it. Log in once in a headed Chrome window instead — no captcha when a human clicks. |
| Groups work, DMs don't | Browser session expired — open the profile in headed Chrome, log in again. |
| Thread won't open by URL (`/t/<id>` stalls) | Known Messenger quirk; the bridge clicks the partner's sidebar conversation instead, which works. |
