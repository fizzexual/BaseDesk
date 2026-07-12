# BaseDesk Discord bot

A turnkey Discord ticket bot. Drop in your bot token + client ID, invite it, and
your server has a full ticket system wired to your BaseDesk dashboard:

- `/ticket` opens a **private thread** — that thread *is* a BaseDesk ticket.
- Everything the customer types in the thread lands on the ticket.
- Agent replies from the **BaseDesk dashboard** show up in the thread automatically.
- Staff can manage the ticket from Discord: `/reply`, `/solve`, `/close`, `/reopen`, `/status`.

The bot **auto-creates its own channel** in BaseDesk on first run — you don't copy
any tokens between the two.

## Setup (about 3 minutes)

1. **Create the bot** at <https://discord.com/developers/applications> → *New
   Application*. Under **Bot**, *Reset Token* and copy it. Under **Bot →
   Privileged Gateway Intents**, turn on **Message Content Intent**. Copy the
   **Application ID** from *General Information*.

2. **Configure it:**
   ```bash
   cd bot
   cp .env.example .env
   # edit .env — set DISCORD_TOKEN, DISCORD_CLIENT_ID, and BASEDESK_URL
   npm install
   npm start
   ```

3. **Invite it.** On start the bot prints an invite link (already scoped to the
   permissions it needs). Open it, pick your server, authorize.

4. **Use it.** In any channel run `/ticket` — a private ticket thread opens and a
   matching ticket appears in your BaseDesk inbox. Reply from the dashboard and it
   lands in the thread; or reply in Discord with `/reply`. `/solve` or `/close`
   archives the thread.

That's it. Leave `npm start` running (or run it under `pm2`, a systemd unit, a
container, etc.).

## How it maps

| Discord | BaseDesk |
|---|---|
| `/ticket` → private thread | new ticket (source: Discord) |
| customer messages in the thread | replies on the ticket (threaded — one ticket per thread) |
| dashboard / `/reply` agent reply | posted back into the thread |
| `/solve` · `/close` · `/reopen` | ticket status change (+ thread archived on solve/close) |
| `/status` | current ticket status |

If the ticket was solved and the customer writes again, a fresh ticket opens
automatically and the thread re-binds to it.

## Credentials & safety

- Your **Discord token** lives only in `bot/.env`, which is git-ignored — it is
  never committed.
- The bot's provisioned **BaseDesk channel + inbound token** are cached in
  `bot/bot-state.json` (also git-ignored).
- BaseDesk stores its own channel secrets in its git-ignored database and only
  ever exposes booleans — nothing sensitive is committed on either side.
- For signed requests, set `BASEDESK_SIGNING_SECRET` here **and** the matching
  inbound signing secret on the channel in BaseDesk.

## Deployment note

The bot delivers dashboard replies by polling BaseDesk every few seconds
(`POLL_MS`), so it needs **no public URL** — it only makes outbound calls to your
BaseDesk instance and to Discord. Run it anywhere that can reach both. See
[../docs/channels.md](../docs/channels.md) for the raw inbound/command API it uses.
