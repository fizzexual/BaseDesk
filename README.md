<p align="center">
  <img src="docs/screenshots/inbox-light.png" alt="BaseDesk inbox" width="820" />
</p>

<h1 align="center">BaseDesk</h1>

<p align="center">
  An open-source, self-hostable helpdesk with a fast, keyboard-first agent workspace.<br/>
  <em>One process. One SQLite file. No feature gates.</em>
</p>

---

## Why BaseDesk

We researched what people actually complain about in helpdesk software — Reddit, Hacker News, G2, review sites — and three themes came up over and over:

1. **Pricing punishes you for growing.** Per-seat taxes, SLAs and reporting locked behind $115+/agent tiers, metered AI resolutions, renewal ambushes.
2. **Incumbents are overbuilt.** Three-month deployments, dedicated admins, cluttered UIs; teams use less than a third of what they pay for.
3. **Open-source alternatives make you choose two of three:** modern UI, lightweight deploy, full feature set. Zammad needs Elasticsearch and 8 GB of RAM. FreeScout paywalls basics as "modules". osTicket looks like 2009. Chatwoot slows down at 15 agents.

BaseDesk is our answer:

- **Fast, beautiful, keyboard-first UI** — j/k through the inbox, `Ctrl/⌘ K` command palette, single-key actions, optimistic updates everywhere.
- **A generous core** — views, reporting, search, snooze, internal notes, canned replies: all product features, never pricing tiers. MIT-licensed, no telemetry, no open-core bait.
- **Runs anywhere** — a single Node process with a single SQLite file (Node's built-in `node:sqlite`, zero native dependencies). No Elasticsearch, no Redis.
- **Support that makes money, not just closes tickets** — log expansion, retention and inbound deals right inside the conversation; a pipeline, account-health view and revenue reporting turn support into a growth channel. Incumbents make you leave for Salesforce to do this.
- **AI as a copilot, not a gatekeeper** — designed for agent-side drafts, triage and summaries (BYO key); never an unavoidable bot between you and your customers.

## A look around

| Ticket workspace | Reports |
| --- | --- |
| ![Ticket workspace](docs/screenshots/ticket-light.png) | ![Reports](docs/screenshots/reports-light.png) |

Revenue pipeline — deals logged from conversations, rolled up per account:

![Revenue pipeline](docs/screenshots/revenue-light.png)

Knowledge base — a categorized help center with a reader and editor:

![Knowledge base](docs/screenshots/kb-light.png)

<details>
<summary>Dark theme</summary>

![BaseDesk inbox, dark theme](docs/screenshots/inbox-dark.png)

</details>

## Quickstart

### Docker (recommended)

```bash
git clone https://github.com/fizzexual/BaseDesk.git
cd BaseDesk
docker compose up -d
# → http://localhost:4011  (seeded with demo data on first boot)
```

### From source

Requires Node ≥ 23.4 (built-in SQLite).

```bash
npm install
npm run build
npm start
# → http://localhost:4011
```

Data lives in `./data/basedesk.db` (override with `DATA_DIR`); port via `PORT`.

## Development

```bash
npm install
npm run dev        # API on :4011, web on :4010 (proxied)
npm test           # server API tests + web store tests
npm run typecheck  # strict TS, both workspaces
```

- `web/` — Vite + React 19 + TypeScript strict + Tailwind v4. Custom design-token system, hand-drawn icon set, in-house SVG charts. One font (Inter Variable). No UI kit.
- `server/` — Hono + `node:sqlite`. REST API, seeds itself with realistic demo data on first boot.
- `shared/` — deterministic seed generator (`npm run seed`).

## The agent workspace

- **Inbox views**: All / Unassigned / My open / Snoozed / per-status / Archive / Spam / Trash, with live counts — switchable between a compact **list** and a **card** layout
- **Ticket workspace**: threaded conversation, internal notes with @mentions, canned replies, tags, snooze presets, customer-360 side panel
- **Revenue**: log expansion/retention/inbound deals from a conversation; pipeline, account-health rollup, revenue reporting, and a live "closed this week" figure
- **AI copilot** (human-in-the-loop): reply drafts grounded in the thread + your canned replies, priority/tag triage suggestions, and one-line thread summaries — runs locally with no key, bring-your-own model provider optional
- **SLA + automation**: response/resolution targets per priority with live breach indicators and attainment reporting; automation rules that shape tickets on arrival
- **Knowledge base**: a categorized help center with a reader and editor, draft/published articles, and search
- **Command palette** (`Ctrl/⌘ K`): jump to any ticket, view, contact, or action
- **Keyboard-first**: `j/k` navigate · `e` solve · `u` assign to me · `1–4` priority · `s` snooze · `r` reply · `n` note · `?` all shortcuts
- **Reports**: created vs solved, priority mix, status distribution, per-agent load, first-reply/resolution medians
- **Light & dark themes**, WCAG-AA contrast

## API

The web app talks to a plain REST API you can use directly — see the route tables in [`docs/superpowers/plans/`](docs/superpowers/plans/). Highlights: `GET /api/bootstrap`, `GET /api/tickets?view=…`, `POST /api/tickets/:id/messages`, `GET /api/deals`, `POST /api/deals`, `GET /api/stats`, `GET /api/search?q=…`.

## Roadmap

- [x] **Support → Revenue** — deals, pipeline, account health, revenue reporting *(v0.2)*
- [x] **AI copilot** — drafts, triage, summaries; rule-based and offline today, model-provider hook for later *(v0.2)*
- [x] **SLA + automation** — targets, breach indicators, attainment; create-time automation rules *(v0.3)*
- [x] **Knowledge base** — categorized articles, reader/editor, draft/published, search *(v0.3)*
- [ ] Business-hours/holiday-aware SLA clocks
- [ ] Auth & team management
- [ ] Transparency portal — customer portal + status page + roadmap/feedback voting
- [ ] Email ingestion (IMAP/SMTP + Gmail/MS365 OAuth) — bulletproof threading or nothing
- [ ] Slack shared-channel support, then chat widget & WhatsApp
- [ ] Migration importers (osTicket, FreeScout, Zendesk CSV)
- [ ] Single-binary packaging

## Philosophy

- Every feature in the open-source core. Forever.
- No telemetry. Your data is a file you own.
- The fastest helpdesk UI in the room, or we're not done.
- AI that makes agents faster, never a wall that keeps customers out.

## License

[MIT](LICENSE)
