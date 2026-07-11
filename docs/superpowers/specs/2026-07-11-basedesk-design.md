# BaseDesk — Design Document

**Date:** 2026-07-11
**Status:** Approved for v0.1 implementation
**Repo:** https://github.com/fizzexual/BaseDesk

---

## 1. What BaseDesk is

BaseDesk is an **open-source, self-hostable helpdesk** — an alternative to Zendesk / Freshdesk / Help Scout that anyone can run on their own hardware — built around four promises the community keeps asking for and not getting:

1. **A fast, beautiful, keyboard-first agent UI** (Linear-quality UX applied to support).
2. **A generous open core**: views, SLAs-ready data model, reporting, and search are product features, not pricing tiers or paid modules. No open-core bait-and-switch.
3. **Runs anywhere**: one process + one SQLite file. No Elasticsearch, no Redis, no 8 GB RAM requirement. `docker run` or `npm start` and you have a helpdesk.
4. **Simplicity**: an agent can learn it in a day; a team can run it without a dedicated admin.

License: **MIT**. No telemetry.

## 2. Research findings that shaped this design

Three research passes (mainstream-helpdesk complaints, open-source landscape, desired features) converged on:

| Finding | Design response |
|---|---|
| #1 complaint everywhere: per-seat pricing + feature gating (SLAs/reporting locked behind $115+/agent tiers); FreeScout/Chatwoot resented for paid modules & EE gating | MIT-licensed, everything in the core; monetization (if ever) is hosting/support, never features |
| Open-source gap: nobody combines modern UI + light deploy + full features (Zammad heavy/dated, FreeScout paywalled, osTicket ancient, Chatwoot slow) | UI quality is the marquee feature; deploy story is one container with SQLite |
| Libredesk's HN traction proves "single binary + simple DB" is the #1 self-host adoption driver | v0.1: single Node process serving API + app, SQLite storage; roadmap keeps this shape |
| Incumbents are "overbuilt": 3-month deployments, <30% feature usage, cluttered UIs | Small surface: Inbox, Tickets, Contacts, Reports, Settings. No admin maze |
| "Toggle tax": agents lose ~40% of time switching tools for customer context | Customer 360 side panel inside every ticket |
| Most-praised modern UX: Cmd+K palette, j/k navigation, single-key actions, saved views, snooze, internal notes with @mentions | All in v0.1 |
| AI wanted as *copilot* (drafts, triage, summaries, human-in-loop), resented as forced/deflecting/per-resolution-billed | AI surfaces designed in but optional, agent-facing, BYO-key later; no autonomous customer-facing bot |
| Replies should look like personal email — no ticket-number boilerplate | Conversation view models clean email threads |
| Migration friction keeps unhappy users stuck | Roadmap: importers (osTicket/FreeScout/Zendesk CSV) |

## 3. Scope

### v0.1 (this build) — a hostable helpdesk with the full agent workspace

Two deliverables in one repo:

**A. Server (`server/`)** — the self-host story:
- Single Node process: REST API + serves the built web app.
- SQLite database (one file, created + seeded with demo data on first boot; `DATA_DIR` env var).
- REST API: tickets (list/filter/create/update), messages (reply/note), contacts, agents, canned replies, stats for reports.
- Dockerfile (multi-stage) + docker-compose.yml → `docker compose up` = running helpdesk.
- No auth in v0.1 (single-team deployment behind your reverse proxy) — documented honestly; auth is the first v0.2 item.

**B. Web app (`web/`)** — everything an agent touches all day:
- **Inbox / ticket list** — the reference-screenshot view: icon rail, sidebar with live counts (All / Unassigned / My open / Open / Pending / On hold / Solved / Closed / Archive / Spam / Trash), ticket table with customer, subject, priority; row hover actions; filtering + search.
- **Ticket detail** — threaded conversation (email-style messages + internal notes with @mentions), reply/note composer, status/priority/assignee/tags controls, snooze, Customer 360 context panel (profile, company, recent tickets, attributes).
- **Command palette (Ctrl/⌘+K)** — go-to-anything: tickets, views, contacts, actions.
- **Keyboard shortcuts** — j/k navigation, Enter open, r reply, n note, e resolve, u assign-to-me, 1/2/3/4 priority, ? help overlay.
- **Contacts** — customer list + detail with ticket history.
- **Reports** — dashboard: ticket volume, resolution times, priority mix, per-agent load (in-house SVG charts, no chart library).
- **Settings** — profile, appearance (light/dark/system), canned replies management.
- **AI Agent section (UI-ready)** — sidebar section as in the reference; "AI draft" affordance in the composer stubbed at the data layer for a future BYO-key model.

**Data layer:** the web app talks to a `Repository` interface. Default implementation is the REST client; a local (in-memory + localStorage, self-seeding) implementation powers instant demo builds and unit tests.

### Explicitly out of v0.1 (roadmap, in order)

1. Auth + team management (v0.2, first priority)
2. Real email ingestion (IMAP/SMTP/Gmail/MS365 OAuth) — research says do it *bulletproof* or not at all
3. Automation rules + SLA engine (business hours, holidays, timezones)
4. Knowledge base + customer portal (status transparency)
5. Multi-channel (Slack shared channels first — 54% of B2B buyers prefer it — then chat widget, WhatsApp)
6. Live AI copilot (BYO API key), migration importers
7. Single-binary packaging (Bun compile / pkg) to complete the Libredesk-style deploy story

## 4. Architecture

- **Monorepo:** npm workspaces — `web/` + `server/` + shared types in `server/src/schema` mirrored via `web/src/data/types.ts` (kept tiny and stable).
- **Server stack:** Node 20+, Hono (router), better-sqlite3 (storage; synchronous, transactional, zero-config), no ORM — a thin typed data module with explicit SQL. Serves `web/dist` statically in production.
- **Web stack:** Vite + React 19 + TypeScript (strict) + Tailwind CSS v4 (CSS-first config carrying the design tokens) + Zustand (state) + React Router v7.
- **No UI kit, no icon library, no chart library:** every icon is a hand-drawn 20×20 SVG React component (1.5px round-capped strokes); charts are in-house SVG.
- **One font:** Inter Variable (self-hosted via @fontsource-variable/inter) everywhere; tabular numerals for counts/metrics.

```
server/
  src/
    index.ts        boot: ensure schema, seed if empty, mount API, serve static
    db.ts           sqlite open/migrate/seed
    api/            tickets.ts, messages.ts, contacts.ts, agents.ts, canned.ts, stats.ts
    seed.ts         realistic demo dataset (shared shape with web/src/data/seed.ts)
web/
  src/
    app/            shell: routes, layout (icon rail, sidebar, content), theme
    components/     primitives (Avatar, Badge, PriorityPill, Menu, Dialog, Tooltip, Toast, EmptyState, Kbd)
    icons/          custom icon set (one file per icon + index)
    features/
      inbox/        ticket list, filters, views, bulk bar
      ticket/       conversation, composer, context panel
      contacts/     list + detail
      reports/      dashboard + SVG charts
      settings/     profile, appearance, canned replies
      palette/      command palette + shortcut registry
    data/
      types.ts      domain model (Ticket, Message, Contact, Agent, SavedView, CannedReply)
      repository.ts Repository interface
      api.ts        REST client implementation
      local.ts      localStorage implementation (demo/tests)
      store.ts      Zustand store + selectors (counts, filtered views)
      seed.ts       seed dataset for local mode
    styles/         tokens.css (design tokens), globals.css
Dockerfile, docker-compose.yml, LICENSE (MIT), README.md
```

**Domain model (core):** `Ticket {id, number, subject, status, priority, requesterId, assigneeId?, tags[], channel, createdAt, updatedAt, snoozedUntil?, bucket}`, `Message {id, ticketId, authorKind: 'contact'|'agent', authorId, kind: 'reply'|'note', body, at}`, `Contact {id, name, email, company?, avatarHue, attributes}`, `Agent {id, name, email, avatarHue}`, `SavedView {id, name, filters, sort}`, `CannedReply {id, title, body}`.

**Statuses:** `open, pending, on_hold, solved, closed`; **buckets** (orthogonal): `inbox, archive, spam, trash`; derived views: unassigned, mine, snoozed. **Priorities:** `urgent, high, medium, low`.

## 5. Design system (from the reference screenshot)

- **Feel:** calm, white-surface product in a soft mint-green ambient frame; large radii (12–16px), hairline borders, generous row height, no visual noise.
- **Type:** Inter Variable only. Sizes: 13px UI meta, 14px body, 15px emphasized names, 18–20px page titles; weights 450/550/650.
- **Light theme tokens:** background `#F6F8F7` (green-tinted neutral), surface `#FFFFFF`, text `#171A19`, secondary `#5C6461`, hairline `#E5E9E7`, hover `#F2F5F3`.
- **Accent system:** ink-black primary actions; semantic colors reserved for meaning — urgent/high red `#D92D20`, medium neutral `#98A2A0`, low green `#12805C`, success/money green pill like "$12.50k Sales closed".
- **Priority language (as in screenshot):** Urgent = red double-chevron ↑↑, High = red arrow ↑, Medium = gray dot •, Low = green arrow ↓ — each with a label, never color alone.
- **Avatars:** solid-hue circles with single white initial (hue derived from entity id).
- **Dark theme:** same token names remapped (background `#0E1110`, surface `#161A18`, text `#F0F3F1`…), switchable light/dark/system.
- **Contrast:** all text/background pairs meet WCAG AA (≥4.5:1 body, ≥3:1 large/secondary); priority colors tuned per-theme to pass.
- **Icons:** single custom set, 20×20 viewBox, 1.5px round-capped strokes, pixel-grid aligned — inbox tray, ticket, contact card, user-plus, play, bar-chart, search, filter, plus, chevrons, archive box, spam alert, trash, check, double-check, clock, pause, circle, sparkle (AI), send, reply arrow, note, tag, gear, sun, moon, command key, kebab, x, arrows, paperclip, keyboard.

## 6. Data flow & behavior

- Store hydrates from the Repository on boot; optimistic, instant UI — every action (status change, reply, assign) applies synchronously to the store, then persists (API call or localStorage write); failures roll back with a toast. The "local-first feel" the research praised.
- Live counts and filtered views are memoized selectors over one normalized store.
- Search: server-side `LIKE`-based search endpoint (SQLite FTS5 on the roadmap headline: "great search, zero extra infra"); local mode uses an in-memory index. Palette "go to" uses the same search.
- Snooze: `snoozedUntil` hides from active views; visible chip shows sleep state.
- Nothing hard-deletes in v0.1: trash/spam are buckets; every destructive-looking action is reversible.

## 7. Testing & verification

- Vitest: server API tests (CRUD, filters, counts, stats over a temp DB) + web data-layer tests (store actions, selectors, search, snooze, seed integrity).
- Type safety as a gate: `tsc --noEmit` clean in both workspaces, strict mode.
- Manual end-to-end verification in the browser pane: every view, shortcuts/palette, both themes, contrast spot-checks.
- Fresh-clone check: `npm install && npm run dev` works; `docker build` succeeds.

## 8. Success criteria

- The inbox visually matches the reference screenshot's quality bar (spacing, hierarchy, calm color) in both themes.
- Every daily agent action reachable by keyboard; palette covers navigation + actions.
- Full ticket lifecycle works end-to-end through the real server + SQLite: open → reply → status/priority/assign/tags/snooze → solved/closed, persisted across restarts.
- `docker compose up` (or `npm run build && npm start`) yields a working helpdesk seeded with demo data.
- No third-party UI/icon/chart dependency; MIT LICENSE; README with self-host guide, screenshots, roadmap, and the "generous core" promise.
- Repo pushed to GitHub with readable history: docs → scaffold → design system → server → features → polish.
