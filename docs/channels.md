# Channels — two-way social & chat integration

BaseDesk treats Discord, Slack, Telegram, Messenger, WhatsApp, SMS, email and any
custom source as **channels**. A channel can do three things:

1. **Inbound** — a customer message becomes a ticket (and threads into their one
   open ticket, so a conversation is one ticket, not one-ticket-per-message).
2. **Outbound** — an agent (or AI) reply is delivered back out to the channel.
3. **Command** — a bot can manage a ticket from the channel side (reply, solve,
   reopen, read status) — e.g. a Discord slash command.

Web chat and the generic webhook work with **zero external setup**. Discord,
Slack, Telegram, Messenger, WhatsApp and SMS connect through a small **relay bot**
you run (with the provider's SDK + your token) that talks to the URLs below. This
keeps provider-specific credentials in the bot's own environment, and BaseDesk's
channel secrets in its database — never in source, never committed.

## Credentials & safety

Every channel secret — the inbound token, the optional inbound **signing secret**,
and the outbound webhook URL / auth token — is stored **server-side in the SQLite
database** (`data/basedesk.db`). The database and the whole data directory are
`.gitignore`d, and the API only ever returns booleans (`hasOutboundSecret`,
`hasInboundSecret`) — never the values. So credentials cannot be committed or
pushed by accident. Your **provider tokens** (Discord bot token, Meta page token)
live in your **relay bot's** environment / a secrets manager, not in BaseDesk and
not in this repo.

Copy the **Inbound URL** and **Command URL** from Settings → Channels. Both carry
a per-channel `?token=…`. For stronger auth, set a **signing secret** on the
channel; then every inbound/command request must include an
`X-BaseDesk-Signature: <hmac>` header, where `<hmac>` is the hex HMAC-SHA256 of the
raw request body under that secret (a bare hex digest or a `sha256=` prefix both
work).

## Inbound API

```
POST /api/channels/:id/inbound?token=<inboundToken>
Content-Type: application/json
X-BaseDesk-Signature: <hex hmac-sha256 of body>   # only if a signing secret is set

{
  "from": { "name": "Ada Lovelace", "externalId": "discord:1490…", "email": "ada@x.com" },
  "subject": "Order #4182",   // optional; first message's preview is used otherwise
  "body": "my order is late"
}
```

- Provide **`email`** or **`externalId`** (a stable per-user id from the provider).
  The same identity threads into the same open ticket and maps to one contact.
- Response: `{ "ticketId", "ticketNumber", "threaded" }`. `threaded` is `true`
  when the message was appended to an existing open ticket, `false` when a new
  ticket was created (a new one opens once the previous is solved/closed).

## Command API — manage a ticket from the channel

```
POST /api/channels/:id/command?token=<inboundToken>
{ "action": "reply", "ticket": 4182, "text": "On its way — tracking #ZX99." }
```

`ticket` is the ticket **number** or id (must belong to this channel). Actions:

| action   | effect                                              |
|----------|-----------------------------------------------------|
| `reply`  | posts an agent reply (also delivered back outbound) |
| `solve`  | marks the ticket solved                             |
| `close`  | closes the ticket                                   |
| `reopen` | reopens the ticket                                  |
| `status` | no change — just returns the current state          |

Response: `{ "ok": true, "ticket": { "id", "number", "subject", "status", "assigneeId" } }`
— echo it back into the chat so the agent sees the result.

## Outbound

When an agent (or AI) replies, BaseDesk delivers it to the channel's **outbound
URL**: Discord and Slack use their native incoming-webhook bodies; Telegram,
Messenger, WhatsApp, SMS and custom webhooks receive a generic JSON envelope your
relay forwards. Configure it (and an optional Bearer token) in the channel dialog;
the **Send test** button verifies it.

## Example: a minimal Discord relay bot

The bot is a ~40-line process you run with your Discord token in its own env. On a
message it calls **inbound**; on a `/reply` or `/close` slash command it calls
**command**. Sketch:

```js
// env: DISCORD_TOKEN, BASEDESK_INBOUND_URL, BASEDESK_COMMAND_URL, SIGNING_SECRET
import { Client, GatewayIntentBits } from 'discord.js';
import crypto from 'node:crypto';

const post = (url, payload) => {
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', process.env.SIGNING_SECRET).update(raw).digest('hex');
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-basedesk-signature': sig }, body: raw });
};

const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

bot.on('messageCreate', (m) => {
  if (m.author.bot) return;
  post(process.env.BASEDESK_INBOUND_URL, {
    from: { name: m.author.username, externalId: `discord:${m.author.id}` },
    body: m.content,
  });
});

bot.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  if (i.commandName === 'reply') {
    const r = await post(process.env.BASEDESK_COMMAND_URL, {
      action: 'reply', ticket: i.options.getInteger('ticket'), text: i.options.getString('text'),
    }).then((x) => x.json());
    await i.reply(`Ticket #${r.ticket.number} → ${r.ticket.status}`);
  }
});

bot.login(process.env.DISCORD_TOKEN); // token stays in the bot's env, never in BaseDesk
```

The same shape works for Messenger/WhatsApp (Meta webhook → inbound; page Send API
for outbound), Telegram (`getUpdates`/webhook → inbound; `sendMessage` for
outbound), and Slack (Events API → inbound; incoming webhook for outbound).
