# ⚓ Harbor IRC

### A calmer harbor for your IRC conversations.

Harbor is a Windows desktop IRC client built with Electron. It brings channels, conversations, and member lists into a clean interface—and keeps the connection secure with verified TLS.

## ✨ What’s on board

- **Secure connections** — TLS is required, with certificate verification enabled.
- **Account sign-in** — Choose SASL PLAIN or NickServ IDENTIFY, and optionally require authentication for individual server endpoints. Opt in to remember the authentication password using Windows secure storage, or use it for one connection only. NickServ authentication is confirmed before auto-joining channels.
- **Backup nicknames** — Configure up to four alternatives, tried in order when your requested nickname is already in use.
- **Custom quit message** — Configure the message sent by `/quit`, `/disconnect`, or the Disconnect button. `{nick}` is replaced with your current nickname.
- **The essentials** — Connect to a server, join channels, chat, see members and topics, and use familiar IRC commands.
- **CTCP support** — Replies to CTCP PING and identifies as **“Harbor IRC - the best client out there”** for CTCP VERSION. The Connection log shows incoming requests, replies, and server notices.
- **Quick user actions** — Click a member in the user list or a message author to message, WHOIS, send CTCP PING/VERSION, or send a notice.
- **Clickable IRC activity** — Nicknames in join, part, quit, rename, WHOIS, notice, and connection activity entries open the same user-action dialog.
- **Smart nickname completion** — Press Tab after typing the start of a nickname to complete the most recent matching chatter first.
- **Custom scripts** — Configure automatic private-message replies, phrase-triggered replies, and channel-join messages. Rules can be limited to a channel, run only while you are marked away, and use per-sender/channel cooldowns. Up to three matching rules can reply to one event. Scripts are simple event rules, not arbitrary JavaScript.
- **Emoji** — Use the emoji picker beside the message box, or type/paste emoji directly.
- **Your own look** — Choose Harbor, Midnight, Violet, or Ember color schemes, customize chat and panel window colors, and tune a four-color nickname palette. Nick colors stay consistent across messages, activity, and the member list.
- **Local by design** — Appearance and server settings stay on your device. Server passwords are not saved.

## 🚀 Get started on Windows

1. Install [Node.js 22 LTS](https://nodejs.org/) (npm is included).
2. Open PowerShell and go to the project folder:

   ```powershell
   Set-Location C:\Users\YourName\ircclient-app
   ```

3. Install dependencies and launch Harbor:

   ```powershell
   npm.cmd install
   npm.cmd run dev
   ```

   `npm.cmd` runs npm without requiring you to change PowerShell's script execution policy.

## 🧭 Build an installer

From the project folder, run:

```powershell
npm.cmd run package
```

The Windows installer will be created under `dist\`.

## ⌨️ Handy commands

Enter commands in the chat box:

| Command | What it does |
| --- | --- |
| `/join #channel` | Join a channel |
| `/part [#channel]` | Leave a channel |
| `/nick name` | Change your nickname |
| `/me action` | Send an action |
| `/msg nick message` | Send a private message |
| `/notice nick message` | Send a notice |
| `/away [message]` | Mark yourself away with an optional message; run `/away` again to clear it |
| `/quit [reason]` | Disconnect with your configured quit message, or the supplied reason |
| `/disconnect [reason]` | Same as `/quit` |
| `/clear` | Clear the current conversation |
| `/help` | Show the command list |

## 🔐 Security & privacy

Harbor requires verified TLS and does not offer plaintext or certificate-bypass connections. Each server endpoint can optionally require SASL or NickServ authentication. Authentication passwords are not stored unless you opt in; saved credentials are encrypted with Electron safeStorage (Windows OS-backed encryption) and kept out of renderer settings. SASL PLAIN credentials are sent inside the verified TLS connection. NickServ authentication sends `IDENTIFY <password>` for the current nickname and waits for a service confirmation before auto-joining. The Electron renderer uses context isolation, sandboxing, and disabled Node.js integration; its preload exposes a small, validated IPC API. IRC lines are length-limited, remote messages are rendered as text, and links require an explicit click and are restricted to HTTP(S). Background images are stored in local IndexedDB and are never sent to the IRC server.

Custom scripts are saved with local Harbor settings and only perform the message actions provided by Harbor; they cannot run JavaScript or access files. Automatic replies have configurable cooldowns and can be restricted to your away status.

TLS protects traffic in transit to the server, but it does not make an IRC network private: the server and channel members can read messages. Harbor does not currently provide end-to-end encryption, certificate pinning, or signed Windows releases. Connect only to networks you trust, and keep Windows and project dependencies up to date.
