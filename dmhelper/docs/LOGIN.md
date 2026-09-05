# login-remote — get the VPS browser logged in (one time)

`login-remote.js` gets the **Chromium on :9222 logged in to Messenger** so the
DM bridge can drive it. It has no puppeteer dependency — only the same
`ws` + CDP approach the library itself uses.

```
node dmhelper/login-remote.js [--email you@x.com] [--password 'secret'] [--port 9222]
```

## What actually works (use this)

**Headed manual login** — the script opens the login page, then waits (up to
10 min) while a human logs in in the Chrome window: solves the Arkose
captcha, enters 2FA, and clicks "Keep me signed in". On a VPS, view the
window through an SSH tunnel:

```bash
ssh -L 9222:localhost:9222 user@vps      # from your PC, keep open
# locally, with Chrome running on the VPS via start-chrome.sh:
node dmhelper/login-remote.js            # then open http://localhost:9222 in your PC's browser
```

The session persists in `dmhelper/bot-profile/` — headless restarts reuse it.

> After login, Messenger may show a **"Enter your PIN to restore your chats"**
> wall (E2EE backup PIN, once per device). Either enter the PIN in the window,
> or let dm-bridge auto-click "Restore without PIN" (old encrypted history is
> lost; new messages still work fine — that's all the bot needs).

## Automated fallbacks (kept, but often captcha-walled)

| # | Strategy | Why it usually fails |
|---|---|---|
| 1 | Cookie injection — copies `../appstate.json` cookies into the browser via `Network.setCookie` | Web sessions are device-bound; API-valid cookies still bounce to login.php |
| 2 | Login form — fills email/password, handles TOTP (`TOTP_SECRET` env) or pasted codes | Headless logins trigger Arkose Labs captcha no script passes reliably |

If both fail, the script prints the manual tunnel instructions.

## Verify

- `login-remote.js` exits `0` and prints `session detected`
- `node dmhelper/dm-bridge.js` reaches `watching: ... /e2ee/t/<key>/` with no error

## Notes

- Run it **after** `bash dmhelper/start-chrome.sh` and **before** `start-all.sh`.
- It never prints your password; input is hidden where the terminal supports it.
- `TOTP_SECRET` must be the account's base32 secret. Without it you'll be
  prompted to paste a code from your authenticator when the 2FA screen appears.
