import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getAiAction, getAiActions, getAiAgent, getAiAgents, getAiProviderConfig, getAttachment, getCannedReplies, getTicketTemplates, getCustomReports, getChannel, getChannels, getContact,
  getStatusComponents, insertStatusComponent, updateStatusComponent, deleteStatusComponent, maxComponentPosition,
  getStatusIncidents, getStatusIncident, insertStatusIncident, updateStatusIncident, deleteStatusIncident,
  getAnnouncements, insertAnnouncement, updateAnnouncement, deleteAnnouncement, announcementExists,
  awaitingReplyMap, getAiUsage, getAllEvents, getContactByEmail, getCustomField, getCustomFields, getDeal, getKbArticle, getMessage, getMessages, getModelCache, getNotifications, getPortalAuth, getSavedViews, getSetting, getSmtpConfig, getTicket, getTicketEvents, markNotificationsRead, setModelCache, setSavedViews,
  insertAiAction, insertAiUsage, insertAttachment, insertNotification, insertTicketEvent, linkAttachments, openDb, portalSecret, rowToTicket, setAiProviderConfig, setPortalAuth, setSetting, setSmtpConfig,
  toPublicChannel, toPublicProvider, toPublicSmtp, type TicketRow,
  getAgents, getAgent, getAgentByEmail, getAgentAuth, upsertAgentAuth, getIntakeForm, setIntakeForm, categoriesFromForm, recordSeen, getTicketSeen, setTicketIntake, getTicketIntake,
  followTicket, unfollowTicket, getFollowers,
  getTasks, getTask, insertTask, patchTask, removeTask, nextTaskPosition,
  hasTimeRuleFired, recordTimeRuleFired,
  insertLink, removeLink, getLinkRows, linkExists,
  getApprovals, getApproval, insertApproval, decideApproval,
  getSideConversations, getSideConversation, insertSideConversation, insertSideMessage,
  getHandoverNotes, insertHandoverNote, deleteHandoverNote,
} from './db.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { hashPassword, randomTotpSecret, signSession, totpUri, verifyPassword, verifySession, verifyTotp } from './auth.js';
import { parseCsv, toCsv } from './csv.js';
import { channelCanSend, sendToChannel } from './channel-send.js';
import { sendReplyNotification, sendTestEmail, smtpReady } from './mailer.js';
import { seedIfEmpty } from './seed-load.js';
import { computeStats } from './stats.js';
import { expectedFirstReplyAt } from './sla.js';
import { DEFAULT_AI_AUTOMATION, DEFAULT_AUTO_ACK, DEFAULT_AUTOMATION, DEFAULT_BRANDING, DEFAULT_BUSINESS_HOURS, DEFAULT_ON_CALL, DEFAULT_SLA_HOURS, DEFAULT_SLA_TARGETS, DEFAULT_TIME_RULES, normalizeAutomation } from './defaults.js';
import { isOpenNow, nextOpenIso, normalizeBusinessHours } from './business-hours.js';
import { detectLanguage } from './detect-language.js';
import { draftReply, rankKb, runAgent, suggestTriage, summarizeThread, type AgentContext, type Autonomy } from './ai-engine.js';
import { draftReplyAI, providerReady, resolveAI, suggestTriageAI, summarizeThreadAI, translateAI } from './ai-llm.js';
import { ping, type LlmConfig } from './llm.js';
import type { ThreadMsg } from './ai-prompts.js';
import type {
  AiAction, AiAutomation, AiProviderConfig, Agent, ArticleStatus, AssignmentSettings, AutoAck, BusinessHours, OutsideHours, Attachment, AutomationAction, AutomationCondition, AutomationRule, TimeRule, TicketLink, TicketLinkType,
  BootstrapData, CannedReply, TicketTemplate, CustomReport, Announcement, AnnouncementLevel, Branding, ComponentStatus, IncidentImpact, IncidentStatus, IncidentUpdate, StatusComponent, StatusIncident, OnCallConfig, Channel, ChannelConn, ChannelType, Contact, CustomFieldDef, CustomFieldEntity,
  ChoiceOption, CitationHighlight, CustomFieldType, Deal, DealStage, DealType, HighlightColor, IntakeForm, IntakeNode, KbArticle, MacroActions, Message, MessageEmbed,
  SavedView, ScheduledMessage, SlaHours, SlaTargets, Ticket, TicketEvent, TicketPatch, TicketPriority, TicketStatus, ViewId,
} from './types.js';

const AUTONOMY_RANK: Record<Autonomy, number> = { resolve: 3, draft: 2, suggest: 1 };
const AUTONOMIES: Autonomy[] = ['suggest', 'draft', 'resolve'];
const CHANNEL_TYPES: ChannelType[] = ['webchat', 'webhook', 'email', 'discord', 'slack', 'whatsapp', 'telegram', 'messenger', 'sms'];
const CHANNEL_TO_TICKET: Record<ChannelType, Channel> = {
  webchat: 'chat', webhook: 'api', email: 'email', discord: 'chat', slack: 'chat',
  whatsapp: 'chat', telegram: 'chat', messenger: 'chat', sms: 'chat',
};

const VERSION = '0.1.0';

const DEAL_TYPES: DealType[] = ['expansion', 'retention', 'inbound'];
const DEAL_STAGES: DealStage[] = ['open', 'won', 'lost'];
const RESOLVED_STATUSES = ['solved', 'closed'];

interface AutoMut { subject: string; priority: TicketPriority; tags: string[]; assigneeId: string | null; status: TicketStatus; category: string | null }
interface AutoCtx { subjectLc: string; bodyLc: string; fromLc: string; channelType: string }

function evalCondition(cond: AutomationCondition, mut: AutoMut, ctx: AutoCtx): boolean {
  const v = cond.value.toLowerCase();
  switch (cond.type) {
    case 'subject_contains': return ctx.subjectLc.includes(v);
    case 'body_contains': return ctx.bodyLc.includes(v);
    case 'priority_is': return mut.priority === cond.value;
    case 'channel_is': return ctx.channelType === cond.value;
    case 'from_contains': return ctx.fromLc.includes(v);
    default: return false;
  }
}

function applyAutoAction(action: AutomationAction, mut: AutoMut): void {
  if (action.type === 'set_priority' && PRIORITIES.includes(action.value as TicketPriority)) mut.priority = action.value as TicketPriority;
  else if (action.type === 'add_tag') { if (!mut.tags.includes(action.value)) mut.tags.push(action.value); }
  else if (action.type === 'assign') mut.assigneeId = action.value;
  else if (action.type === 'set_status' && STATUSES.includes(action.value as TicketStatus)) mut.status = action.value as TicketStatus;
  else if (action.type === 'set_category') mut.category = action.value.trim() === '' ? null : action.value;
}

/** Runs enabled automation rules over a ticket mutation, in order. */
function runAutomation(rules: AutomationRule[], mut: AutoMut, ctx: AutoCtx, phase: 'create' | 'update'): void {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (phase === 'update' && rule.runOn !== 'create_update') continue;
    if (rule.conditions.length === 0) continue;
    const results = rule.conditions.map((cnd) => evalCondition(cnd, mut, ctx));
    const ok = rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
    if (ok) for (const action of rule.actions) applyAutoAction(action, mut);
  }
}

const VIEW_IDS: ViewId[] = [
  'all', 'unassigned', 'mine', 'snoozed',
  'open', 'pending', 'on_hold', 'solved', 'closed',
  'archive', 'spam', 'trash',
];
const PRIORITIES: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];
const STATUSES = ['open', 'pending', 'on_hold', 'solved', 'closed'];
const BUCKETS = ['inbox', 'archive', 'spam', 'trash'];

/** Target fields for each CSV import type, in display order. */
type ImportType = 'contacts' | 'tickets';
interface ImportField { key: string; label: string; required: boolean }
const IMPORT_FIELDS: Record<ImportType, ImportField[]> = {
  contacts: [
    { key: 'name', label: 'Name', required: true },
    { key: 'email', label: 'Email', required: true },
    { key: 'company', label: 'Company', required: false },
  ],
  tickets: [
    { key: 'subject', label: 'Subject', required: true },
    { key: 'requesterEmail', label: 'Requester email', required: true },
    { key: 'body', label: 'Message', required: false },
    { key: 'priority', label: 'Priority', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'tags', label: 'Tags', required: false },
  ],
};

const normHeader = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const IMPORT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A human, actionable message for a provider HTTP status. */
function providerStatusHint(status: number): string {
  if (status === 401) return 'Unauthorized (401) — your API key was rejected. Check the key is correct and matches this provider.';
  if (status === 403) return 'Forbidden (403) — the key is valid but lacks access to this endpoint.';
  if (status === 404) return 'Not found (404) — check the base URL (it usually ends in /v1).';
  if (status === 429) return 'Rate limited (429) — wait a moment and try again.';
  if (status >= 500) return `Provider error (${status}) — the provider is having trouble; try again shortly.`;
  return `Provider returned ${status}.`;
}

/** Fetch the model ids a provider currently offers (OpenAI-compatible GET /models). Throws on failure. */
async function fetchModelIds(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
    headers: apiKey !== '' ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(providerStatusHint(res.status));
  const data = (await res.json()) as { data?: { id?: unknown }[] };
  return Array.isArray(data.data)
    ? [...new Set(data.data.map((m) => (m && typeof m.id === 'string' ? m.id : '')).filter((id) => id !== ''))].sort()
    : [];
}

/**
 * The "addresser": refresh the cached list of available models for the configured
 * provider. Runs on boot and on a daily timer. Only reaches out for an enabled
 * provider that has a key (or a local one) — so a fresh/unconfigured install and
 * the tests never touch the network. Keeps the previous cache on any failure.
 */
export async function refreshModelCache(db: DatabaseSync): Promise<void> {
  const cfg = getAiProviderConfig(db);
  const baseUrl = cfg.baseUrl.trim();
  const apiKey = cfg.apiKey.trim();
  const isLocal = /localhost|127\.0\.0\.1|::1/.test(baseUrl);
  if (!cfg.enabled || baseUrl === '' || (apiKey === '' && !isLocal)) return;
  try {
    const models = await fetchModelIds(baseUrl, apiKey);
    if (models.length > 0) setModelCache(db, { baseUrl, models, fetchedAt: new Date().toISOString() });
  } catch {
    /* provider unreachable — keep the last known list */
  }
}

/** Best-effort guess of which CSV column feeds each target field, by header name. */
function autoMapColumns(type: ImportType, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of IMPORT_FIELDS[type]) {
    const target = normHeader(f.key);
    const label = normHeader(f.label);
    let h = headers.find((x) => normHeader(x) === target || normHeader(x) === label);
    if (h === undefined) h = headers.find((x) => { const n = normHeader(x); return n !== '' && (n.includes(target) || target.includes(n)); });
    if (h === undefined && f.key === 'requesterEmail') h = headers.find((x) => normHeader(x).includes('email'));
    if (h === undefined && f.key === 'body') h = headers.find((x) => ['message', 'description', 'body', 'comment'].some((a) => normHeader(x).includes(a)));
    if (h !== undefined) map[f.key] = h;
  }
  return map;
}

/**
 * Validate an untrusted macro-actions payload, keeping only known-good fields.
 * Returns null when nothing usable remains, so a macro with no actions is
 * stored as a plain canned reply.
 */
function normalizeMacroActions(raw: unknown): MacroActions | null {
  if (raw === null || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const out: MacroActions = {};
  if (typeof a.status === 'string' && STATUSES.includes(a.status)) out.status = a.status as TicketStatus;
  if (typeof a.priority === 'string' && PRIORITIES.includes(a.priority as TicketPriority)) out.priority = a.priority as TicketPriority;
  if (a.assignToMe === true) out.assignToMe = true;
  if (Array.isArray(a.addTags)) {
    const tags = [...new Set(a.addTags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()))];
    if (tags.length > 0) out.addTags = tags;
  }
  return Object.keys(out).length > 0 ? out : null;
}
const PATCH_KEYS = ['status', 'priority', 'assigneeId', 'tags', 'bucket', 'snoozedUntil', 'subject', 'customFields'] as const;

function newId(prefix: string): string {
  return `${prefix}${randomUUID().slice(0, 8)}`;
}

/** Simple djb2 string hash, used for contact avatar hues. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function preview(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 90);
}

/**
 * Text form of a message's embeds, appended to outbound replies (email/channel) since the
 * customer sees no embed card there — a cited passage, or a question with its options listed.
 */
function embedsText(embeds: MessageEmbed[]): string {
  return embeds
    .map((e) =>
      e.type === 'kb_citation'
        ? `From our help article “${e.title}”:\n\n“${e.passage}”`
        : e.type === 'choice_prompt'
          ? `${e.question}\n${e.options.map((o) => `- ${o.label}`).join('\n')}`
          : e.message,
    )
    .filter((s) => s.trim() !== '')
    .join('\n\n');
}

/** Short inbox/preview label for a message that carries an embed but no body text. */
function embedPreview(e: MessageEmbed): string {
  return e.type === 'kb_citation'
    ? `Cited “${e.title}”`
    : e.type === 'choice_prompt'
      ? `Asked “${e.question}”`
      : 'Outside working hours';
}

const HL_COLORS = new Set<HighlightColor>(['yellow', 'green', 'blue', 'pink']);

/**
 * Validate client highlight ranges and collapse them to sorted, non-overlapping runs
 * clamped to a passage of length `len`. Bad shapes/colors and out-of-range parts are dropped.
 */
function normalizeHighlights(raw: unknown, len: number): CitationHighlight[] {
  if (!Array.isArray(raw) || len === 0) return [];
  const colors: (HighlightColor | null)[] = new Array(len).fill(null);
  for (const item of raw.slice(0, 200)) {
    if (item === null || typeof item !== 'object') continue;
    const h = item as Record<string, unknown>;
    if (typeof h.start !== 'number' || typeof h.end !== 'number' || typeof h.color !== 'string') continue;
    if (!HL_COLORS.has(h.color as HighlightColor)) continue;
    const s = Math.max(0, Math.min(Math.trunc(h.start), len));
    const e = Math.max(0, Math.min(Math.trunc(h.end), len));
    for (let i = s; i < e; i++) colors[i] = h.color as HighlightColor;
  }
  const out: CitationHighlight[] = [];
  let i = 0;
  while (i < len) {
    const color = colors[i];
    if (color === null) { i++; continue; }
    let j = i + 1;
    while (j < len && colors[j] === color) j++;
    out.push({ start: i, end: j, color });
    i = j;
  }
  return out;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Constant-time check that `provided` is a valid HMAC-SHA256 of `rawBody` under
 * `secret`. Accepts a bare hex digest or a `sha256=…` prefix (Slack/Meta style).
 */
function verifyHmac(secret: string, rawBody: string, provided: string | undefined): boolean {
  if (provided === undefined || provided.trim() === '') return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const got = provided.replace(/^sha256=/i, '').trim();
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(got, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function insertTicketRow(db: DatabaseSync, t: Ticket): void {
  db.prepare(
    `INSERT INTO tickets (
      id, number, subject, status, priority, bucket, requesterId, assigneeId,
      tags, channel, createdAt, updatedAt, snoozedUntil, lastMessageAt, lastMessagePreview,
      firstRespondedAt, resolvedAt, channelId, customFields, category
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    t.id, t.number, t.subject, t.status, t.priority, t.bucket, t.requesterId, t.assigneeId,
    JSON.stringify(t.tags), t.channel, t.createdAt, t.updatedAt, t.snoozedUntil, t.lastMessageAt,
    t.lastMessagePreview, t.firstRespondedAt, t.resolvedAt, t.channelId, JSON.stringify(t.customFields), t.category,
  );
}

/** Validate/normalize an untrusted intake-form payload into a safe decision tree. */
function sanitizeIntakeForm(input: unknown): IntakeForm | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as Record<string, unknown>;
  const nodesIn = typeof raw.nodes === 'object' && raw.nodes !== null ? (raw.nodes as Record<string, unknown>) : {};
  const nodes: Record<string, IntakeNode> = {};
  for (const [key, val] of Object.entries(nodesIn)) {
    if (typeof val !== 'object' || val === null) continue;
    const n = val as Record<string, unknown>;
    const id = typeof n.id === 'string' && n.id.trim() !== '' ? n.id : key;
    const prompt = typeof n.prompt === 'string' ? n.prompt : '';
    const optsIn = Array.isArray(n.options) ? n.options : [];
    const options: IntakeNode['options'] = [];
    optsIn.forEach((o, i) => {
      if (typeof o !== 'object' || o === null) return;
      const opt = o as Record<string, unknown>;
      if (typeof opt.label !== 'string') return;
      options.push({
        id: typeof opt.id === 'string' && opt.id.trim() !== '' ? opt.id : `o_${id}_${i}`,
        label: opt.label,
        next: typeof opt.next === 'string' && opt.next.trim() !== '' ? opt.next : null,
        category: typeof opt.category === 'string' && opt.category.trim() !== '' ? opt.category.trim() : null,
        tags: Array.isArray(opt.tags) ? opt.tags.filter((t): t is string => typeof t === 'string') : [],
      });
    });
    nodes[id] = { id, prompt, options };
  }
  const rootRaw = typeof raw.rootId === 'string' ? raw.rootId : null;
  const rootId = rootRaw !== null && nodes[rootRaw] !== undefined ? rootRaw : (Object.keys(nodes)[0] ?? null);
  return { enabled: raw.enabled === true, rootId, nodes };
}

/**
 * Shared view semantics (must match the web store selectors):
 * - all       = bucket inbox, not snoozed (snoozedUntil null or <= now), status not closed
 * - unassigned= all AND assigneeId null AND status open|pending
 * - mine      = all AND assigneeId = currentAgentId AND status open|pending|on_hold
 * - snoozed   = bucket inbox AND snoozedUntil > now
 * - statuses  = bucket inbox, not snoozed, that status
 * - buckets   = that bucket
 */
function viewWhere(view: ViewId, nowIso: string, currentAgentId: string): { sql: string; params: string[] } {
  const notSnoozed = '(snoozedUntil IS NULL OR snoozedUntil <= ?)';
  switch (view) {
    case 'all':
      return { sql: `bucket = 'inbox' AND ${notSnoozed} AND status != 'closed'`, params: [nowIso] };
    case 'unassigned':
      return {
        sql: `bucket = 'inbox' AND ${notSnoozed} AND status != 'closed' AND assigneeId IS NULL AND status IN ('open', 'pending')`,
        params: [nowIso],
      };
    case 'mine':
      return {
        sql: `bucket = 'inbox' AND ${notSnoozed} AND status != 'closed' AND assigneeId = ? AND status IN ('open', 'pending', 'on_hold')`,
        params: [nowIso, currentAgentId],
      };
    case 'snoozed':
      return { sql: `bucket = 'inbox' AND snoozedUntil IS NOT NULL AND snoozedUntil > ?`, params: [nowIso] };
    case 'open':
    case 'pending':
    case 'on_hold':
    case 'solved':
    case 'closed':
      return { sql: `bucket = 'inbox' AND ${notSnoozed} AND status = ?`, params: [nowIso, view] };
    case 'archive':
    case 'spam':
    case 'trash':
      return { sql: 'bucket = ?', params: [view] };
  }
}

export function createApp(dataDir: string): { app: Hono; db: DatabaseSync; flushScheduled: (nowMs: number) => number } {
  const db = openDb(dataDir);
  seedIfEmpty(db);
  // Refresh the available-model list on boot (no-op unless a provider is set up).
  void refreshModelCache(db);

  // Uploaded files live next to the SQLite database, keyed by attachment id.
  const attachDir = path.join(dataDir, 'attachments');
  mkdirSync(attachDir, { recursive: true });
  const MAX_UPLOAD = 10 * 1024 * 1024; // 10 MB

  // Ensure settings exist (fresh install or migrated pre-v0.3/v0.4 DB).
  if (getSetting(db, 'sla') === null) setSetting(db, 'sla', JSON.stringify(DEFAULT_SLA_TARGETS));
  if (getSetting(db, 'automation') === null) setSetting(db, 'automation', JSON.stringify(DEFAULT_AUTOMATION));
  if (getSetting(db, 'sla_hours') === null) setSetting(db, 'sla_hours', JSON.stringify(DEFAULT_SLA_HOURS));
  if (getSetting(db, 'assignment') === null) setSetting(db, 'assignment', JSON.stringify({ enabled: false, strategy: 'round_robin' }));
  if (getSetting(db, 'time_rules') === null) setSetting(db, 'time_rules', JSON.stringify(DEFAULT_TIME_RULES));

  const slaTargets = (): SlaTargets => {
    try {
      return JSON.parse(getSetting(db, 'sla') ?? '') as SlaTargets;
    } catch {
      return DEFAULT_SLA_TARGETS;
    }
  };
  const automationRules = (): AutomationRule[] => {
    try {
      return normalizeAutomation(JSON.parse(getSetting(db, 'automation') ?? ''));
    } catch {
      return DEFAULT_AUTOMATION;
    }
  };
  const slaHours = () => {
    try {
      return JSON.parse(getSetting(db, 'sla_hours') ?? '') as unknown;
    } catch {
      return DEFAULT_SLA_HOURS;
    }
  };
  const autoAck = (): AutoAck => {
    try {
      const raw = JSON.parse(getSetting(db, 'auto_ack') ?? '') as { enabled?: unknown; message?: unknown };
      return { enabled: raw.enabled === true, message: typeof raw.message === 'string' ? raw.message : DEFAULT_AUTO_ACK.message };
    } catch {
      return DEFAULT_AUTO_ACK;
    }
  };
  const businessHours = (): BusinessHours => {
    try {
      return normalizeBusinessHours(JSON.parse(getSetting(db, 'business_hours') ?? ''), DEFAULT_BUSINESS_HOURS);
    } catch {
      return DEFAULT_BUSINESS_HOURS;
    }
  };
  const aiAutomation = (): AiAutomation => {
    try {
      const raw = JSON.parse(getSetting(db, 'ai_automation') ?? '') as Partial<AiAutomation>;
      return { autoSuggest: raw.autoSuggest === true, autoResolve: raw.autoResolve === true, autoTriage: raw.autoTriage === true };
    } catch {
      return { ...DEFAULT_AI_AUTOMATION };
    }
  };
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  const branding = (): Branding => {
    try {
      const raw = JSON.parse(getSetting(db, 'branding') ?? '') as { productName?: unknown; accentColor?: unknown };
      return {
        productName: typeof raw.productName === 'string' && raw.productName.trim() !== '' ? raw.productName.trim() : DEFAULT_BRANDING.productName,
        accentColor: typeof raw.accentColor === 'string' && HEX_RE.test(raw.accentColor) ? raw.accentColor : '',
      };
    } catch {
      return { ...DEFAULT_BRANDING };
    }
  };
  const onCall = (): OnCallConfig => {
    try {
      const raw = JSON.parse(getSetting(db, 'on_call') ?? '') as Partial<OnCallConfig>;
      return {
        enabled: raw.enabled === true,
        cadence: raw.cadence === 'daily' ? 'daily' : 'weekly',
        startDate: typeof raw.startDate === 'string' ? raw.startDate : DEFAULT_ON_CALL.startDate,
        rotation: Array.isArray(raw.rotation) ? raw.rotation.filter((id): id is string => typeof id === 'string') : [],
      };
    } catch {
      return DEFAULT_ON_CALL;
    }
  };
  const timeRules = (): TimeRule[] => {
    try {
      const raw = JSON.parse(getSetting(db, 'time_rules') ?? '') as unknown;
      return Array.isArray(raw) ? (raw as TimeRule[]) : DEFAULT_TIME_RULES;
    } catch {
      return DEFAULT_TIME_RULES;
    }
  };

  const assignmentSettings = (): AssignmentSettings => {
    try {
      const raw = JSON.parse(getSetting(db, 'assignment') ?? '') as { enabled?: unknown; strategy?: unknown };
      return { enabled: raw.enabled === true, strategy: raw.strategy === 'least_busy' ? 'least_busy' : 'round_robin' };
    } catch {
      return { enabled: false, strategy: 'round_robin' };
    }
  };

  /**
   * Choose an agent for a new ticket per the strategy, or null if no agent is active.
   * When the ticket has a category and any active agent explicitly covers it, the pool
   * is narrowed to those coverers so tickets route to the right team; otherwise every
   * active agent is eligible (generalists with no categories set).
   */
  const pickAssignee = (strategy: AssignmentSettings['strategy'], category: string | null, language: string | null = null): string | null => {
    const active = getAgents(db).filter((a) => a.status === 'active');
    if (active.length === 0) return null;
    let candidates = active;
    // Skill routing: prefer agents who cover the ticket's category.
    if (category !== null) {
      const coverers = candidates.filter((a) => a.categories.includes(category));
      if (coverers.length > 0) candidates = coverers;
    }
    // Language routing: within that pool, prefer a speaker of the detected language.
    if (language !== null) {
      const speakers = candidates.filter((a) => a.languages.some((l) => l.toLowerCase() === language.toLowerCase()));
      if (speakers.length > 0) candidates = speakers;
    }
    const pool = candidates.map((a) => ({ id: a.id }));
    if (strategy === 'least_busy') {
      let best = pool[0].id;
      let bestCount = Infinity;
      for (const a of pool) {
        const { n } = db
          .prepare("SELECT COUNT(*) AS n FROM tickets WHERE assigneeId = ? AND bucket = 'inbox' AND mergedIntoId IS NULL AND status IN ('open', 'pending', 'on_hold')")
          .get(a.id) as { n: number };
        if (n < bestCount) { bestCount = n; best = a.id; }
      }
      return best;
    }
    // round_robin: advance a persisted counter across the (possibly category-filtered) pool.
    const counter = Number(getSetting(db, 'assignment_rr') ?? '0') || 0;
    const pick = pool[counter % pool.length].id;
    setSetting(db, 'assignment_rr', String((counter + 1) % 1_000_000));
    return pick;
  };

  /** Assign an unassigned new ticket when auto-assignment is on. Returns the chosen agent id or null. */
  const logEvent = (ticketId: string, kind: TicketEvent['kind'], actorId: string | null, detail: Record<string, unknown>, at: string): void => {
    insertTicketEvent(db, { id: newId('ev_'), ticketId, kind, actorId, detail, at });
  };

  /** Log ticket_events for the fields that actually changed between a ticket and its patch. */
  const logPatchEvents = (before: Ticket, patch: TicketPatch, actorId: string | null, at: string): void => {
    if (patch.status !== undefined && patch.status !== before.status) logEvent(before.id, 'status', actorId, { from: before.status, to: patch.status }, at);
    if (patch.priority !== undefined && patch.priority !== before.priority) logEvent(before.id, 'priority', actorId, { from: before.priority, to: patch.priority }, at);
    if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) logEvent(before.id, 'assignee', actorId, { from: before.assigneeId, to: patch.assigneeId }, at);
    if (patch.tags !== undefined) {
      const added = patch.tags.filter((t) => !before.tags.includes(t));
      const removed = before.tags.filter((t) => !patch.tags!.includes(t));
      if (added.length > 0 || removed.length > 0) logEvent(before.id, 'tags', actorId, { added, removed }, at);
    }
  };

  /** Recompute a ticket's stored derived fields from its current messages — used after a split moves messages out/in. */
  const recomputeDerived = (ticketId: string): void => {
    const newestReply = db
      .prepare("SELECT body, at FROM messages WHERE ticketId = ? AND kind = 'reply' AND deletedAt IS NULL ORDER BY at DESC, rowid DESC LIMIT 1")
      .get(ticketId) as { body: string; at: string } | undefined;
    const newestAny = db
      .prepare('SELECT body, at FROM messages WHERE ticketId = ? AND deletedAt IS NULL ORDER BY at DESC, rowid DESC LIMIT 1')
      .get(ticketId) as { body: string; at: string } | undefined;
    const last = newestReply ?? newestAny;
    const firstAgent = db
      .prepare("SELECT at FROM messages WHERE ticketId = ? AND kind = 'reply' AND authorKind = 'agent' AND deletedAt IS NULL ORDER BY at ASC, rowid ASC LIMIT 1")
      .get(ticketId) as { at: string } | undefined;
    if (last !== undefined) {
      db.prepare('UPDATE tickets SET lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?')
        .run(last.at, preview(last.body), firstAgent?.at ?? null, ticketId);
    } else {
      db.prepare('UPDATE tickets SET firstRespondedAt = ? WHERE id = ?').run(firstAgent?.at ?? null, ticketId);
    }
  };

  const autoAssign = (ticketId: string, currentAssignee: string | null, category: string | null = null): string | null => {
    if (currentAssignee !== null) return currentAssignee;
    const cfg = assignmentSettings();
    if (!cfg.enabled) return null;
    // Detect the opening message's language to route to a speaker when we have one.
    const opening = getMessages(db, ticketId).find((m) => m.authorKind === 'contact');
    const language = opening !== undefined ? detectLanguage(opening.body) : null;
    const pick = pickAssignee(cfg.strategy, category, language);
    if (pick !== null) {
      const now = new Date().toISOString();
      db.prepare('UPDATE tickets SET assigneeId = ? WHERE id = ?').run(pick, ticketId);
      logEvent(ticketId, 'assignee', null, { from: null, to: pick, auto: true }, now); // null actor = automation
    }
    return pick;
  };

  /** Append a model call's token spend to the usage ledger (skips the free rule-based path). */
  const recordUsage = (kind: string, usage: { promptTokens: number; completionTokens: number }): void => {
    if (usage.promptTokens + usage.completionTokens <= 0) return;
    insertAiUsage(db, { id: newId('use_'), kind, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, at: new Date().toISOString() });
  };

  // Per-request identity. When auth is on, middleware runs each request inside this
  // store holding the signed-in agent's id; otherwise it's empty and we fall back to
  // the first admin — so a login-less install behaves exactly as it always has.
  const agentCtx = new AsyncLocalStorage<string>();
  const firstAdminId = (): string => {
    const row = db.prepare("SELECT id FROM agents WHERE role = 'admin' ORDER BY rowid LIMIT 1").get() as
      | { id: string }
      | undefined;
    if (row === undefined) throw new Error('no admin agent found');
    return row.id;
  };
  const currentAgentId = (): string => {
    const s = agentCtx.getStore();
    return s !== undefined && s !== '' ? s : firstAdminId();
  };
  const authEnabled = (): boolean => getSetting(db, 'auth_enabled') === '1';
  const authSecret = (): string => {
    let s = getSetting(db, 'auth_secret');
    if (s === null) {
      s = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      setSetting(db, 'auth_secret', s);
    }
    return s;
  };
  const bearerToken = (h: string | undefined): string | null => {
    const m = h !== undefined ? /^Bearer\s+(.+)$/i.exec(h.trim()) : null;
    return m ? m[1] : null;
  };
  const sessionAgentId = (token: string | null): string | null => {
    if (token === null) return null;
    const id = verifySession(authSecret(), token);
    if (id === null) return null;
    const agent = getAgent(db, id);
    return agent !== null && agent.status === 'active' ? agent.id : null;
  };

  // Ephemeral in-memory presence — who is viewing each ticket right now, keyed by a
  // per-tab session id so concurrent viewers stay distinct even under one login.
  // Never persisted; entries expire once heartbeats stop.
  const presence = new Map<string, Map<string, { agentId: string; at: number }>>();
  const PRESENCE_TTL = 18_000;

  /**
   * Create an @mention notification for every teammate named in an internal
   * note. Matches an `@word` token against each agent's first name
   * (case-insensitive); the author never notifies themselves.
   */
  const notifyMentions = (opts: { body: string; ticketId: string; messageId: string; actorId: string; now: string }): void => {
    const tokens = new Set((opts.body.match(/@\p{L}[\p{L}'’_-]*/gu) ?? []).map((t) => t.slice(1).toLowerCase()));
    if (tokens.size === 0) return;
    const agents = db.prepare('SELECT id, name FROM agents').all() as { id: string; name: string }[];
    const actorName = agents.find((a) => a.id === opts.actorId)?.name ?? 'A teammate';
    for (const a of agents) {
      if (a.id === opts.actorId) continue;
      const first = a.name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      if (first !== '' && tokens.has(first)) {
        insertNotification(db, {
          id: newId('nt_'), agentId: a.id, ticketId: opts.ticketId, messageId: opts.messageId,
          actorId: opts.actorId, actorName, snippet: preview(opts.body), kind: 'mention', createdAt: opts.now,
        });
      }
    }
  };

  /**
   * Notify a ticket's assignee that its customer replied, so they see the ball is
   * back in their court. Unassigned tickets surface in the Unassigned / Awaiting
   * views instead, so they don't fan out a notification to the whole team.
   */
  const notifyCustomerReply = (opts: { ticket: Ticket; message: Message; contactName: string }): void => {
    const { ticket, message } = opts;
    if (message.authorKind !== 'contact') return;
    // Alert the assignee plus everyone watching the ticket — deduped.
    const recipients = new Set<string>();
    if (ticket.assigneeId !== null) recipients.add(ticket.assigneeId);
    for (const f of getFollowers(db, ticket.id)) recipients.add(f.agentId);
    for (const agentId of recipients) {
      insertNotification(db, {
        id: newId('nt_'), agentId, ticketId: ticket.id, messageId: message.id,
        actorId: message.authorId, actorName: opts.contactName, snippet: preview(message.body || 'Sent an attachment'),
        kind: 'reply', createdAt: message.at,
      });
    }
  };

  /** Fire-and-forget: email the ticket's requester that support replied. */
  const emailReplyToCustomer = (ticket: Ticket, body: string): void => {
    const cfg = getSmtpConfig(db);
    if (!smtpReady(cfg)) return;
    const contact = getContact(db, ticket.requesterId);
    if (contact === null || contact.email.trim() === '') return;
    const ticketUrl = `${cfg.publicUrl.replace(/\/+$/, '')}/portal/ticket/${ticket.id}`;
    void sendReplyNotification(cfg, {
      toEmail: contact.email, toName: contact.name, ticketNumber: ticket.number,
      subject: ticket.subject, body, ticketUrl,
    }).catch((err) => console.error('[email] reply notification failed:', err instanceof Error ? err.message : err));
  };

  /** Fire-and-forget: deliver an agent reply back out to the ticket's chat channel. */
  const sendReplyToChannel = (ticket: Ticket, body: string): void => {
    if (ticket.channelId === null) return;
    const channel = getChannel(db, ticket.channelId);
    if (channel === null || !channelCanSend(channel)) return;
    const contact = getContact(db, ticket.requesterId);
    const fromName = getSmtpConfig(db).fromName.trim() || 'Support';
    void sendToChannel(channel, {
      ticketNumber: ticket.number, subject: ticket.subject, body,
      toName: contact?.name ?? null, fromName,
    })
      .then((r) => { if (!r.ok) console.error(`[channel] outbound to ${channel.type} failed:`, r.error); })
      .catch((err) => console.error('[channel] outbound failed:', err instanceof Error ? err.message : err));
  };

  /** Deliver an outgoing reply on every configured path: email + the source channel. */
  const deliverReply = (ticket: Ticket, body: string): void => {
    emailReplyToCustomer(ticket, body);
    sendReplyToChannel(ticket, body);
  };

  /**
   * Validate client-supplied message embeds, re-resolving each KB citation against the
   * store so the stored title/category/slug are trustworthy (only the picked passage
   * comes from the client). Unknown or unpublished articles are dropped.
   */
  const sanitizeEmbeds = (raw: unknown): MessageEmbed[] => {
    if (!Array.isArray(raw)) return [];
    const out: MessageEmbed[] = [];
    // Scan at most a bounded slice (far more than the 10 we accept) so a giant array can't
    // tie up the event loop with per-item DB lookups before the accept-cap is reached.
    for (const item of raw.slice(0, 50)) {
      if (item === null || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      if (e.type === 'kb_citation' && typeof e.articleId === 'string' && typeof e.passage === 'string') {
        const passage = e.passage.replace(/\s+/g, ' ').trim().slice(0, 2000);
        if (passage === '') continue;
        const article = getKbArticle(db, e.articleId);
        if (article === null || article.status !== 'published') continue;
        const highlights = normalizeHighlights(e.highlights, passage.length);
        out.push({
          type: 'kb_citation',
          articleId: article.id,
          title: article.title,
          category: article.category.trim() === '' ? null : article.category,
          slug: article.slug,
          passage,
          ...(highlights.length > 0 ? { highlights } : {}),
        });
      } else if (e.type === 'choice_prompt') {
        const question = typeof e.question === 'string' ? e.question.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
        // Options get fresh, stable server ids (o1, o2, …); the customer answers against these.
        const options: ChoiceOption[] = [];
        for (const raw of Array.isArray(e.options) ? e.options : []) {
          if (raw === null || typeof raw !== 'object') continue;
          const label = typeof (raw as { label?: unknown }).label === 'string' ? (raw as { label: string }).label.trim().slice(0, 120) : '';
          if (label === '') continue;
          options.push({ id: `o${options.length + 1}`, label });
          if (options.length >= 10) break;
        }
        if (question === '' || options.length < 1) continue;
        // An answer is only ever set via the portal answer endpoint — never trusted from the client on create.
        out.push({ type: 'choice_prompt', question, layout: e.layout === 'dropdown' ? 'dropdown' : 'buttons', options });
      } else continue;
      if (out.length >= 10) break; // a message can't carry an unbounded number of embeds
    }
    return out;
  };

  /** If enabled, fire an automatic first reply the instant a ticket is opened. */
  const sendAutoAck = (ticketId: string, contactName: string): void => {
    const cfg = autoAck();
    if (!cfg.enabled || cfg.message.trim() === '') return;
    const ticket = getTicket(db, ticketId);
    if (ticket === null) return;
    const author =
      ticket.assigneeId ??
      getAgents(db).find((a) => a.status === 'active' && a.role === 'admin')?.id ??
      getAgents(db).find((a) => a.status === 'active')?.id ??
      null;
    if (author === null) return;
    const now = new Date().toISOString();
    const first = contactName.trim().split(/\s+/)[0] || 'there';
    const body = cfg.message.replaceAll('{{number}}', String(ticket.number)).replaceAll('{{name}}', first);
    db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId('m_'), ticketId, 'agent', author, 'reply', body, now);
    // Newest message, but we don't stamp firstRespondedAt — SLA still measures the
    // human first response.
    db.prepare('UPDATE tickets SET updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ? WHERE id = ?')
      .run(now, now, preview(body), ticketId);
    deliverReply(ticket, body);
  };

  /** When hours are on and we're currently closed, post an editable "outside working
   *  hours" reply carrying the next opening instant (for a live countdown). Like the
   *  auto-ack, it does NOT stamp firstRespondedAt — a human still owes a real reply. */
  const sendOutsideHours = (ticketId: string, contactName: string): void => {
    const bh = businessHours();
    const nowMs = Date.now();
    if (!bh.enabled || isOpenNow(bh, nowMs)) return;
    const ticket = getTicket(db, ticketId);
    if (ticket === null) return;
    const author =
      ticket.assigneeId ??
      getAgents(db).find((a) => a.status === 'active' && a.role === 'admin')?.id ??
      getAgents(db).find((a) => a.status === 'active')?.id ??
      null;
    if (author === null) return;
    const now = new Date(nowMs).toISOString();
    const first = contactName.trim().split(/\s+/)[0] || 'there';
    const message = bh.message.replaceAll('{{number}}', String(ticket.number)).replaceAll('{{name}}', first);
    const embed: OutsideHours = { type: 'outside_hours', message, nextOpenAt: nextOpenIso(bh, nowMs) };
    db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at, embeds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('m_'), ticketId, 'agent', author, 'reply', message, now, JSON.stringify([embed]));
    db.prepare('UPDATE tickets SET updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ? WHERE id = ?')
      .run(now, now, preview(message), ticketId);
    deliverReply(ticket, message);
  };

  /** Post any scheduled messages whose time has arrived; returns how many fired.
   *  Stale entries (ticket gone/closed/merged) are dropped without posting. Called
   *  on a timer in production and opportunistically on bootstrap. */
  const flushScheduled = (nowMs: number): number => {
    const rows = db
      .prepare('SELECT * FROM scheduled_messages WHERE sendAt <= ? ORDER BY sendAt ASC')
      .all(new Date(nowMs).toISOString()) as unknown as ScheduledMessage[];
    let sent = 0;
    for (const row of rows) {
      const ticket = getTicket(db, row.ticketId);
      if (ticket === null || ticket.status === 'closed' || ticket.mergedIntoId !== null) {
        db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(row.id);
        continue;
      }
      const now = new Date().toISOString();
      const nextStatus = row.kind === 'reply' && ticket.status === 'open' ? 'pending' : ticket.status;
      const nextPreview = row.kind === 'reply' ? preview(row.body) : ticket.lastMessagePreview;
      const nextFirst = row.kind === 'reply' && ticket.firstRespondedAt === null ? now : ticket.firstRespondedAt;
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(newId('m_'), row.ticketId, 'agent', row.authorId, row.kind, row.body, now);
        db.prepare('UPDATE tickets SET status = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?')
          .run(nextStatus, now, now, nextPreview, nextFirst, row.ticketId);
        db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(row.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      followTicket(db, row.ticketId, row.authorId, now);
      if (row.kind === 'reply') deliverReply(ticket, row.body);
      sent++;
    }
    return sent;
  };

  // ---- Time-based rules: escalations + stale-ticket cleanup -------------------
  const applyTimeRule = (t: Ticket, rule: TimeRule, nowIso: string): void => {
    let priority = t.priority;
    let status = t.status;
    let assigneeId = t.assigneeId;
    let category = t.category;
    const tags = [...t.tags];
    for (const a of rule.actions) {
      if (a.type === 'set_priority' && PRIORITIES.includes(a.value as TicketPriority)) priority = a.value as TicketPriority;
      else if (a.type === 'set_status' && STATUSES.includes(a.value as TicketStatus)) status = a.value as TicketStatus;
      else if (a.type === 'assign') assigneeId = a.value === '' ? null : a.value;
      else if (a.type === 'set_category') category = a.value.trim() === '' ? null : a.value;
      else if (a.type === 'add_tag') { if (!tags.includes(a.value)) tags.push(a.value); }
    }
    const resolvedAt = (status === 'solved' || status === 'closed') && t.resolvedAt === null ? nowIso : t.resolvedAt;
    // Document the automated change as an internal note (team-only).
    const author =
      getAgents(db).find((a) => a.status === 'active' && a.role === 'admin')?.id ??
      getAgents(db).find((a) => a.status === 'active')?.id ??
      null;
    if (author !== null) {
      const note = `⏱️ Automation “${rule.name}” ran — ${rule.trigger.replace(/_/g, ' ')} for ${rule.hours}h+.`;
      db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(newId('m_'), t.id, 'agent', author, 'note', note, nowIso);
    }
    db.prepare('UPDATE tickets SET priority = ?, status = ?, assigneeId = ?, category = ?, tags = ?, updatedAt = ?, resolvedAt = ? WHERE id = ?')
      .run(priority, status, assigneeId, category, JSON.stringify(tags), nowIso, resolvedAt, t.id);
  };

  /** Evaluate enabled time-rules against active tickets; fire matching ones once each. */
  const evaluateTimeRules = (nowMs: number): number => {
    const rules = timeRules().filter((r) => r.enabled && r.actions.length > 0 && r.hours > 0);
    if (rules.length === 0) return 0;
    const nowIso = new Date(nowMs).toISOString();
    const rows = db
      .prepare("SELECT * FROM tickets WHERE bucket = 'inbox' AND status IN ('open', 'pending', 'on_hold')")
      .all() as unknown as TicketRow[];
    let fired = 0;
    for (const row of rows) {
      const t = rowToTicket(row);
      const createdMs = Date.parse(t.createdAt);
      const lastReply = db
        .prepare("SELECT authorKind, at FROM messages WHERE ticketId = ? AND kind = 'reply' AND deletedAt IS NULL ORDER BY at DESC LIMIT 1")
        .get(t.id) as { authorKind: string; at: string } | undefined;
      for (const rule of rules) {
        if (hasTimeRuleFired(db, rule.id, t.id)) continue;
        let match = false;
        if (rule.trigger === 'awaiting_first_response') {
          match = t.firstRespondedAt === null && nowMs - createdMs >= rule.hours * 3_600_000;
        } else if (lastReply !== undefined) {
          const want = rule.trigger === 'awaiting_reply' ? 'contact' : 'agent';
          match = lastReply.authorKind === want && nowMs - Date.parse(lastReply.at) >= rule.hours * 3_600_000;
        }
        if (!match) continue;
        applyTimeRule(t, rule, nowIso);
        recordTimeRuleFired(db, rule.id, t.id, nowIso);
        fired += 1;
        break; // one rule per ticket per pass keeps the snapshot coherent
      }
    }
    return fired;
  };

  /**
   * Runs the enabled AI agents against a freshly-arrived ticket. The
   * highest-autonomy matching agent acts once: a resolve agent that deflects to
   * a KB article sends the reply and solves the ticket; draft/suggest agents
   * record a pending action for the queues.
   */
  const runAgentsOnTicket = async (ticket: Ticket, firstBody: string, opts?: { manual?: boolean }): Promise<AiAction | null> => {
    // Automatic runs are opt-in; a manual "Suggest a reply" bypasses that gate.
    if (opts?.manual !== true && !aiAutomation().autoSuggest) return null;
    const agents = getAiAgents(db)
      .filter((a) => a.enabled)
      // A category-scoped agent only works tickets in one of its categories; an
      // agent with no categories set works everything.
      .filter((a) => a.scopeCategories.length === 0 || (ticket.category !== null && a.scopeCategories.includes(ticket.category)))
      .sort((a, b) => AUTONOMY_RANK[b.autonomy] - AUTONOMY_RANK[a.autonomy]);
    if (agents.length === 0) return null;
    const contact = getContact(db, ticket.requesterId);
    const canned = getCannedReplies(db);
    const kb = db.prepare('SELECT * FROM kb_articles').all() as unknown as KbArticle[];
    const cfg = getAiProviderConfig(db);
    const useModel = providerReady(cfg);
    const canAutoResolve = aiAutomation().autoResolve; // auto-SEND is opt-in even when agents run
    const contactName = contact?.name ?? 'there';
    const thread: ThreadMsg[] = [{ role: 'customer', body: firstBody }];
    for (const agent of agents) {
      const ctx: AgentContext = {
        subject: ticket.subject, bodyText: firstBody,
        contactName, agentName: agent.name,
        currentPriority: ticket.priority, currentTags: ticket.tags,
        canned, kb,
      };
      const decision = runAgent(agent, ctx);
      if (decision === null) continue;

      // When a model is configured, it writes the body. For a resolve agent it
      // also GATES the auto-send: it only sends if it can answer from the KB,
      // otherwise the action degrades to a draft for a human to review.
      let kind = decision.kind;
      let body = decision.draftBody;
      let kbArticleId = decision.kbArticleId;
      let promptTokens = 0;
      let completionTokens = 0;
      if (useModel && agent.autonomy !== 'suggest') {
        const rankedKb = rankKb(`${ticket.subject} ${firstBody}`, kb, 5);
        const draftCtx = { subject: ticket.subject, contactName, agentName: agent.name, signature: '', thread, canned, kb: rankedKb };
        if (agent.autonomy === 'resolve') {
          const solved = await resolveAI(cfg, draftCtx);
          if (solved !== null) {
            kind = 'resolve'; body = solved.reply; kbArticleId = null;
            promptTokens = solved.usage.promptTokens; completionTokens = solved.usage.completionTokens;
          } else {
            kind = 'draft'; kbArticleId = null;
            const d = await draftReplyAI(cfg, draftCtx, decision.draftBody ?? '');
            body = d.body; promptTokens = d.usage.promptTokens; completionTokens = d.usage.completionTokens;
          }
        } else {
          const d = await draftReplyAI(cfg, draftCtx, decision.draftBody ?? '');
          body = d.body; promptTokens = d.usage.promptTokens; completionTokens = d.usage.completionTokens;
        }
      }
      // Auto-send is opt-in: without it, a resolve becomes a draft for a human to approve.
      if (kind === 'resolve' && !canAutoResolve) kind = 'draft';

      const now = new Date().toISOString();
      const action: AiAction = {
        id: newId('act_'), agentId: agent.id, ticketId: ticket.id, kind,
        status: kind === 'resolve' ? 'sent' : 'pending',
        draftBody: body, suggestedPriority: decision.suggestedPriority,
        suggestedTags: decision.suggestedTags, kbArticleId,
        promptTokens, completionTokens,
        createdAt: now, resolvedAt: kind === 'resolve' ? now : null,
      };
      insertAiAction(db, action);
      recordUsage(kind === 'resolve' ? 'agent_resolve' : 'agent_draft', { promptTokens, completionTokens });
      if (kind === 'resolve' && body !== null) {
        const message: Message = {
          id: newId('m_'), ticketId: ticket.id, authorKind: 'agent', authorId: currentAgentId(),
          kind: 'reply', body, at: now,
        };
        db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
        db.prepare('UPDATE tickets SET status = ?, resolvedAt = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?')
          .run('solved', now, now, now, preview(body), now, ticket.id);
        deliverReply(ticket, body);
      }
      return action; // only the highest-autonomy matching agent acts
    }
    return null;
  };

  /** A ticket's customer-facing reply thread, shaped for the prompt builders. */
  const threadOf = (ticketId: string): ThreadMsg[] =>
    getMessages(db, ticketId)
      .filter((m) => m.kind === 'reply')
      .map((m) => ({ role: m.authorKind === 'contact' ? 'customer' : 'agent', body: m.body }));

  const app = new Hono();

  // Admin authentication gate. A no-op passthrough when auth is off (the default), so
  // existing installs are unchanged. When on, admin /api routes require a valid session;
  // the SPA, portal, auth, health, branding, uploads and channel webhooks stay open.
  const isPublicPath = (p: string): boolean =>
    !p.startsWith('/api/') ||
    p.startsWith('/api/auth/') ||
    p.startsWith('/api/portal/') ||
    p === '/api/health' ||
    p === '/api/branding' ||
    p.startsWith('/api/uploads') ||
    p.includes('/inbound');
  app.use('*', async (c, next) => {
    if (!authEnabled()) return next();
    const agentId = sessionAgentId(bearerToken(c.req.header('Authorization')));
    if (agentId === null && !isPublicPath(c.req.path)) return c.json({ error: 'authentication required' }, 401);
    return agentCtx.run(agentId ?? '', next);
  });

  app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }));

  // --- Admin authentication (opt-in). Set a password while auth is off, then enable it. ---
  app.post('/api/auth/login', async (c) => {
    let input: { email?: unknown; password?: unknown; code?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const agent = getAgentByEmail(db, email);
    const auth = agent !== null ? getAgentAuth(db, agent.id) : null;
    if (agent === null || agent.status !== 'active' || auth === null || auth.passwordHash === null || !verifyPassword(password, auth.passwordHash)) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }
    if (auth.totpEnabled) {
      const code = typeof input.code === 'string' ? input.code : '';
      if (auth.totpSecret === null || !verifyTotp(auth.totpSecret, code, Date.now())) {
        return c.json({ error: 'A valid two-factor code is required', needs2fa: true }, 401);
      }
    }
    return c.json({ token: signSession(authSecret(), agent.id), agent });
  });

  app.post('/api/auth/logout', (c) => c.json({ ok: true })); // stateless — the client drops its token

  app.get('/api/auth/me', (c) => {
    const agent = getAgent(db, currentAgentId());
    const a = getAgentAuth(db, currentAgentId());
    return agent !== null
      ? c.json({ agent, authEnabled: authEnabled(), hasPassword: a.passwordHash !== null, totpEnabled: a.totpEnabled })
      : c.json({ error: 'not signed in' }, 401);
  });

  app.post('/api/auth/password', async (c) => {
    let input: { password?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.password !== 'string' || input.password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
    upsertAgentAuth(db, currentAgentId(), { passwordHash: hashPassword(input.password) });
    return c.json({ ok: true });
  });

  app.post('/api/auth/2fa/setup', (c) => {
    const secret = randomTotpSecret();
    upsertAgentAuth(db, currentAgentId(), { totpSecret: secret, totpEnabled: false });
    const agent = getAgent(db, currentAgentId());
    return c.json({ secret, uri: totpUri(secret, agent?.email ?? 'agent') });
  });

  app.post('/api/auth/2fa/enable', async (c) => {
    let input: { code?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const auth = getAgentAuth(db, currentAgentId());
    const code = typeof input.code === 'string' ? input.code : '';
    if (auth.totpSecret === null || !verifyTotp(auth.totpSecret, code, Date.now())) return c.json({ error: 'Invalid code' }, 400);
    upsertAgentAuth(db, currentAgentId(), { totpEnabled: true });
    return c.json({ ok: true });
  });

  app.post('/api/auth/2fa/disable', (c) => {
    upsertAgentAuth(db, currentAgentId(), { totpSecret: null, totpEnabled: false });
    return c.json({ ok: true });
  });

  app.put('/api/settings/auth', async (c) => {
    let input: { enabled?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    // Guard against lockout: refuse to require login until the current agent has a password.
    if (input.enabled === true && getAgentAuth(db, currentAgentId()).passwordHash === null) {
      return c.json({ error: 'Set your password before enabling login' }, 400);
    }
    setSetting(db, 'auth_enabled', input.enabled === true ? '1' : '0');
    return c.json({ enabled: input.enabled === true });
  });

  app.get('/api/bootstrap', (c) => {
    flushScheduled(Date.now()); // fire any due scheduled sends whenever the app loads
    const awaiting = awaitingReplyMap(db);
    const tickets = (db.prepare('SELECT * FROM tickets ORDER BY lastMessageAt DESC').all() as unknown as TicketRow[])
      .map(rowToTicket)
      .map((t) => ({ ...t, awaitingReply: awaiting.get(t.id) ?? false }));
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY rowid').all() as unknown as Contact[];
    const agents = getAgents(db);
    const canned = getCannedReplies(db);
    const intakeForm = getIntakeForm(db);
    const deals = db.prepare('SELECT * FROM deals ORDER BY updatedAt DESC').all() as unknown as Deal[];
    const kb = db.prepare('SELECT * FROM kb_articles ORDER BY category, title').all() as unknown as KbArticle[];
    const data: BootstrapData = {
      tickets, contacts, agents, canned, templates: getTicketTemplates(db), customReports: getCustomReports(db), announcements: getAnnouncements(db), branding: branding(), deals,
      currentAgentId: currentAgentId(),
      sla: slaTargets(),
      automation: automationRules(),
      kb,
      aiAgents: getAiAgents(db),
      aiActions: getAiActions(db),
      aiUsage: getAiUsage(db),
      availableModels: getModelCache(db),
      channels: getChannels(db).map(toPublicChannel),
      customFields: getCustomFields(db),
      savedViews: getSavedViews(db),
      notifications: getNotifications(db, currentAgentId()),
      assignment: assignmentSettings(),
      autoAck: autoAck(),
      businessHours: businessHours(),
      auth: { enabled: authEnabled(), hasPassword: getAgentAuth(db, currentAgentId()).passwordHash !== null, totpEnabled: getAgentAuth(db, currentAgentId()).totpEnabled },
      aiAutomation: aiAutomation(),
      onCall: onCall(),
      timeRules: timeRules(),
      slaHours: slaHours() as BootstrapData['slaHours'],
      aiProvider: toPublicProvider(getAiProviderConfig(db)),
      smtp: toPublicSmtp(getSmtpConfig(db)),
      intakeForm,
      categories: categoriesFromForm(intakeForm),
    };
    return c.json(data);
  });

  // --- Intake form: the branching questionnaire customers walk to open a ticket ---
  app.get('/api/intake-form', (c) => c.json(getIntakeForm(db)));
  app.put('/api/intake-form', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const form = sanitizeIntakeForm(input);
    if (form === null) return c.json({ error: 'invalid intake form' }, 400);
    setIntakeForm(db, form);
    return c.json(form);
  });
  // Public: the portal fetches the form to render — only exposes it while enabled.
  app.get('/api/portal/intake-form', (c) => {
    const form = getIntakeForm(db);
    return c.json(form.enabled ? form : ({ enabled: false, rootId: null, nodes: {} } as IntakeForm));
  });

  app.get('/api/tickets', (c) => {
    const view = c.req.query('view');
    const q = c.req.query('q');
    const priority = c.req.query('priority');
    const assigneeId = c.req.query('assigneeId');

    const clauses: string[] = [];
    const params: string[] = [];

    if (view !== undefined && view !== '') {
      if (!VIEW_IDS.includes(view as ViewId)) return c.json({ error: `unknown view: ${view}` }, 400);
      const w = viewWhere(view as ViewId, new Date().toISOString(), currentAgentId());
      clauses.push(w.sql);
      params.push(...w.params);
    }
    if (q !== undefined && q !== '') {
      clauses.push('(subject LIKE ? OR lastMessagePreview LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (priority !== undefined && priority !== '') {
      if (!PRIORITIES.includes(priority as TicketPriority)) return c.json({ error: `unknown priority: ${priority}` }, 400);
      clauses.push('priority = ?');
      params.push(priority);
    }
    if (assigneeId !== undefined && assigneeId !== '') {
      clauses.push('assigneeId = ?');
      params.push(assigneeId);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT * FROM tickets ${where} ORDER BY lastMessageAt DESC`)
      .all(...params) as unknown as TicketRow[];
    const awaiting = awaitingReplyMap(db);
    return c.json(rows.map(rowToTicket).map((t) => ({ ...t, awaitingReply: awaiting.get(t.id) ?? false })));
  });

  app.post('/api/tickets', async (c) => {
    let input: { subject?: unknown; body?: unknown; requesterId?: unknown; priority?: unknown; category?: unknown; tags?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { subject, body, requesterId, priority } = input;
    if (typeof subject !== 'string' || subject.trim() === '') return c.json({ error: 'subject is required' }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'body is required' }, 400);
    if (typeof requesterId !== 'string' || getContact(db, requesterId) === null) {
      return c.json({ error: 'unknown requesterId' }, 400);
    }
    if (typeof priority !== 'string' || !PRIORITIES.includes(priority as TicketPriority)) {
      return c.json({ error: 'invalid priority' }, 400);
    }
    // Optional starting category + tags (e.g. applied from a ticket template).
    const seedCategory = typeof input.category === 'string' && input.category.trim() !== '' ? input.category.trim() : null;
    const seedTags = Array.isArray(input.tags)
      ? [...new Set(input.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter((t) => t !== ''))]
      : [];

    const now = new Date().toISOString();
    const maxRow = db.prepare('SELECT COALESCE(MAX(number), 0) AS maxNumber FROM tickets').get() as { maxNumber: number };
    // Automation rules may adjust priority/tags/assignee/status at creation time (on top of any template seed).
    const requester = getContact(db, requesterId);
    const shaped: AutoMut = {
      subject: subject.trim(), priority: priority as TicketPriority, tags: [...seedTags], assigneeId: null, status: 'open', category: seedCategory,
    };
    runAutomation(automationRules(), shaped, {
      subjectLc: shaped.subject.toLowerCase(), bodyLc: body.toLowerCase(),
      fromLc: requester ? `${requester.name} ${requester.email}`.toLowerCase() : '',
      channelType: 'web',
    }, 'create');
    const ticket: Ticket = {
      id: newId('t_'),
      number: maxRow.maxNumber + 1,
      subject: shaped.subject,
      status: shaped.status,
      priority: shaped.priority,
      bucket: 'inbox',
      requesterId,
      assigneeId: shaped.assigneeId,
      tags: shaped.tags,
      channel: 'web',
      createdAt: now,
      updatedAt: now,
      snoozedUntil: null,
      lastMessageAt: now,
      lastMessagePreview: preview(body),
      firstRespondedAt: null,
      resolvedAt: null,
      channelId: null,
      mergedIntoId: null,
      awaitingReply: true,
      customFields: {},
      category: shaped.category,
    };
    const message: Message = {
      id: newId('m_'),
      ticketId: ticket.id,
      authorKind: 'contact',
      authorId: requesterId,
      kind: 'reply',
      body,
      at: now,
    };

    db.exec('BEGIN');
    try {
      insertTicketRow(db, ticket);
      db.prepare(
        'INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    logEvent(ticket.id, 'created', currentAgentId(), {}, now);
    // AI agents evaluate the new ticket (may auto-resolve it).
    await runAgentsOnTicket(ticket, body);
    autoAssign(ticket.id, ticket.assigneeId, ticket.category);
    sendAutoAck(ticket.id, requester?.name ?? '');
    return c.json({ ticket: getTicket(db, ticket.id), message });
  });

  app.patch('/api/tickets/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getTicket(db, id);
    if (existing === null) return c.json({ error: `ticket not found: ${id}` }, 404);

    let patch: TicketPatch;
    try {
      patch = (await c.req.json()) as TicketPatch;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    // Validate field values so a buggy or hostile client cannot persist a
    // ticket in an unknown status/priority/bucket that the UI can't render.
    if ('status' in patch && !STATUSES.includes(patch.status as string)) return c.json({ error: 'invalid status' }, 400);
    if ('priority' in patch && !PRIORITIES.includes(patch.priority as TicketPriority)) return c.json({ error: 'invalid priority' }, 400);
    if ('bucket' in patch && !BUCKETS.includes(patch.bucket as string)) return c.json({ error: 'invalid bucket' }, 400);
    if ('subject' in patch && (typeof patch.subject !== 'string' || patch.subject.trim() === '')) return c.json({ error: 'invalid subject' }, 400);
    if ('tags' in patch && !Array.isArray(patch.tags)) return c.json({ error: 'invalid tags' }, 400);
    if ('assigneeId' in patch && patch.assigneeId !== null && typeof patch.assigneeId !== 'string') return c.json({ error: 'invalid assigneeId' }, 400);
    if ('customFields' in patch && (typeof patch.customFields !== 'object' || patch.customFields === null || Array.isArray(patch.customFields))) return c.json({ error: 'invalid customFields' }, 400);

    const sets: string[] = [];
    const params: (string | null)[] = [];
    for (const key of PATCH_KEYS) {
      if (!(key in patch)) continue;
      const value = patch[key];
      sets.push(`${key} = ?`);
      if (key === 'tags') params.push(JSON.stringify(value ?? []));
      else if (key === 'customFields') params.push(JSON.stringify(value ?? {}));
      else params.push(value as string | null);
    }
    const now = new Date().toISOString();
    // Maintain resolvedAt for the SLA resolution clock on status transitions.
    if (patch.status !== undefined) {
      if (RESOLVED_STATUSES.includes(patch.status) && existing.resolvedAt === null) {
        sets.push('resolvedAt = ?');
        params.push(now);
      } else if (!RESOLVED_STATUSES.includes(patch.status) && existing.resolvedAt !== null) {
        sets.push('resolvedAt = ?');
        params.push(null);
      }
    }
    sets.push('updatedAt = ?');
    params.push(now);
    db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    logPatchEvents(existing, patch, currentAgentId(), now);
    return c.json(getTicket(db, id));
  });

  // Bulk update: apply a uniform patch (status/priority/assignee/bucket/snooze) to
  // many tickets at once, plus an optional per-ticket tag union. Returns the
  // updated tickets so the client can merge them.
  app.patch('/api/tickets', async (c) => {
    let input: { ids?: unknown; patch?: unknown; addTags?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const ids = Array.isArray(input.ids) ? input.ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.length === 0) return c.json({ error: 'ids is required' }, 400);
    const patch = (input.patch !== null && typeof input.patch === 'object' ? input.patch : {}) as TicketPatch;
    const addTags = Array.isArray(input.addTags)
      ? input.addTags.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
      : [];
    if ('status' in patch && !STATUSES.includes(patch.status as string)) return c.json({ error: 'invalid status' }, 400);
    if ('priority' in patch && !PRIORITIES.includes(patch.priority as TicketPriority)) return c.json({ error: 'invalid priority' }, 400);
    if ('bucket' in patch && !BUCKETS.includes(patch.bucket as string)) return c.json({ error: 'invalid bucket' }, 400);
    if ('assigneeId' in patch && patch.assigneeId !== null && typeof patch.assigneeId !== 'string') return c.json({ error: 'invalid assigneeId' }, 400);

    const now = new Date().toISOString();
    const BULK_KEYS = ['status', 'priority', 'assigneeId', 'bucket', 'snoozedUntil'] as const;
    const updated: Ticket[] = [];
    for (const id of ids) {
      const existing = getTicket(db, id);
      if (existing === null) continue;
      const sets: string[] = [];
      const params: (string | null)[] = [];
      for (const key of BULK_KEYS) {
        if (!(key in patch)) continue;
        sets.push(`${key} = ?`);
        params.push((patch[key] as string | null | undefined) ?? null);
      }
      if (addTags.length > 0) {
        sets.push('tags = ?');
        params.push(JSON.stringify(Array.from(new Set([...existing.tags, ...addTags]))));
      }
      if ('status' in patch && typeof patch.status === 'string') {
        if (RESOLVED_STATUSES.includes(patch.status) && existing.resolvedAt === null) {
          sets.push('resolvedAt = ?');
          params.push(now);
        } else if (!RESOLVED_STATUSES.includes(patch.status) && existing.resolvedAt !== null) {
          sets.push('resolvedAt = ?');
          params.push(null);
        }
      }
      if (sets.length === 0) {
        updated.push(existing);
        continue;
      }
      sets.push('updatedAt = ?');
      params.push(now);
      db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
      const effective: TicketPatch = { ...patch };
      if (addTags.length > 0) effective.tags = Array.from(new Set([...existing.tags, ...addTags]));
      logPatchEvents(existing, effective, currentAgentId(), now);
      const t = getTicket(db, id);
      if (t !== null) updated.push(t);
    }
    return c.json({ updated });
  });

  app.get('/api/tickets/:id/messages', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    // Opening the thread marks it seen by the current agent (for read receipts).
    recordSeen(db, id, currentAgentId(), 'agent', new Date().toISOString());
    return c.json(getMessages(db, id));
  });

  app.get('/api/tickets/:id/events', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    return c.json(getTicketEvents(db, id));
  });

  // Global audit log — recent activity across every ticket, newest first.
  app.get('/api/events', (c) => {
    const raw = Number(c.req.query('limit'));
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 2000) : 500;
    return c.json(getAllEvents(db, { limit }));
  });

  // Shift handover notes — a team feed for passing context to the next shift.
  app.get('/api/handover', (c) => c.json(getHandoverNotes(db)));
  app.post('/api/handover', async (c) => {
    let input: { body?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (body === '') return c.json({ error: 'note body is required' }, 400);
    insertHandoverNote(db, { id: newId('ho_'), authorId: currentAgentId(), body, createdAt: new Date().toISOString() });
    return c.json(getHandoverNotes(db));
  });
  app.delete('/api/handover/:id', (c) => {
    deleteHandoverNote(db, c.req.param('id'));
    return c.json(getHandoverNotes(db));
  });

  // Read receipts: when each participant last viewed this ticket's thread.
  app.get('/api/tickets/:id/seen', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    return c.json(getTicketSeen(db, id));
  });

  // Followers: agents watching a ticket for activity even when they aren't assigned.
  const followersJson = (ticketId: string) =>
    getFollowers(db, ticketId).map((f) => {
      const a = getAgent(db, f.agentId);
      return { agentId: f.agentId, name: a?.name ?? 'Agent', avatarHue: a?.avatarHue ?? 0, at: f.at };
    });
  app.get('/api/tickets/:id/followers', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    return c.json(followersJson(id));
  });
  // Follow the current agent, or a named teammate via { agentId }.
  app.post('/api/tickets/:id/followers', async (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    let agentId = currentAgentId();
    try {
      const b = (await c.req.json()) as { agentId?: unknown };
      if (typeof b.agentId === 'string' && getAgent(db, b.agentId) !== null) agentId = b.agentId;
    } catch {
      /* no body → follow self */
    }
    followTicket(db, id, agentId, new Date().toISOString());
    return c.json(followersJson(id));
  });
  app.delete('/api/tickets/:id/followers/:agentId', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    unfollowTicket(db, id, c.req.param('agentId'));
    return c.json(followersJson(id));
  });

  // Checklist: the sub-steps an agent works through to resolve a ticket.
  app.get('/api/tickets/:id/tasks', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    return c.json(getTasks(db, id));
  });
  app.post('/api/tickets/:id/tasks', async (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    let title = '';
    try {
      const b = (await c.req.json()) as { title?: unknown };
      if (typeof b.title === 'string') title = b.title.trim();
    } catch {
      /* no/invalid body */
    }
    if (title === '') return c.json({ error: 'title is required' }, 400);
    insertTask(db, {
      id: newId('tk_'), ticketId: id, title, done: false,
      position: nextTaskPosition(db, id), createdAt: new Date().toISOString(), doneAt: null,
    });
    return c.json(getTasks(db, id));
  });
  app.patch('/api/tickets/:id/tasks/:taskId', async (c) => {
    const id = c.req.param('id');
    const taskId = c.req.param('taskId');
    const task = getTask(db, taskId);
    if (task === null || task.ticketId !== id) return c.json({ error: 'task not found' }, 404);
    const patch: { title?: string; done?: boolean } = {};
    try {
      const b = (await c.req.json()) as { title?: unknown; done?: unknown };
      if (typeof b.title === 'string' && b.title.trim() !== '') patch.title = b.title.trim();
      if (typeof b.done === 'boolean') patch.done = b.done;
    } catch {
      /* no/invalid body */
    }
    patchTask(db, taskId, patch, new Date().toISOString());
    return c.json(getTasks(db, id));
  });
  app.delete('/api/tickets/:id/tasks/:taskId', (c) => {
    const id = c.req.param('id');
    const taskId = c.req.param('taskId');
    const task = getTask(db, taskId);
    if (task === null || task.ticketId !== id) return c.json({ error: 'task not found' }, 404);
    removeTask(db, taskId);
    return c.json(getTasks(db, id));
  });

  // Typed links between tickets (related / blocks / blocked by / duplicate of).
  const linksJson = (ticketId: string): TicketLink[] =>
    getLinkRows(db, ticketId)
      .map((r): TicketLink | null => {
        const outgoing = r.fromId === ticketId;
        const otherId = outgoing ? r.toId : r.fromId;
        const other = getTicket(db, otherId);
        if (other === null) return null;
        let type: TicketLinkType;
        if (r.type === 'related') type = 'related';
        else if (r.type === 'blocks') type = outgoing ? 'blocks' : 'blocked_by';
        else type = outgoing ? 'duplicate_of' : 'duplicated_by';
        return { linkId: r.id, ticketId: otherId, number: other.number, subject: other.subject, status: other.status, type };
      })
      .filter((l): l is TicketLink => l !== null);

  app.get('/api/tickets/:id/links', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    return c.json(linksJson(id));
  });
  app.post('/api/tickets/:id/links', async (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    let body: { linkedTicketId?: unknown; type?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const linkedId = typeof body.linkedTicketId === 'string' ? body.linkedTicketId : '';
    const type = body.type;
    if (linkedId === '' || getTicket(db, linkedId) === null) return c.json({ error: 'unknown linked ticket' }, 400);
    if (linkedId === id) return c.json({ error: 'a ticket cannot link to itself' }, 400);
    if (type !== 'related' && type !== 'blocks' && type !== 'blocked_by' && type !== 'duplicate_of') {
      return c.json({ error: 'invalid link type' }, 400);
    }
    if (linkExists(db, id, linkedId)) return c.json({ error: 'these tickets are already linked' }, 409);
    // Normalize the perspective type to a directional stored row.
    let fromId = id;
    let toId = linkedId;
    let stored = 'related';
    if (type === 'blocks') stored = 'blocks';
    else if (type === 'blocked_by') { stored = 'blocks'; fromId = linkedId; toId = id; }
    else if (type === 'duplicate_of') stored = 'duplicate';
    const linkAt = new Date().toISOString();
    insertLink(db, { id: newId('lk_'), fromId, toId, type: stored, createdAt: linkAt });
    const linked = getTicket(db, linkedId);
    if (linked !== null) logEvent(id, 'link', currentAgentId(), { targetId: linkedId, targetNumber: linked.number, linkType: type }, linkAt);
    return c.json(linksJson(id));
  });
  app.delete('/api/tickets/:id/links/:linkId', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    removeLink(db, c.req.param('linkId'));
    return c.json(linksJson(id));
  });

  // Approvals: request sign-off on a ticket action, then approve or reject it.
  app.get('/api/tickets/:id/approvals', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    return c.json(getApprovals(db, id));
  });
  app.post('/api/tickets/:id/approvals', async (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    let body: { reason?: unknown; approverId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason === '') return c.json({ error: 'reason is required' }, 400);
    const approverId = typeof body.approverId === 'string' && body.approverId !== '' ? body.approverId : null;
    if (approverId !== null && getAgent(db, approverId) === null) return c.json({ error: 'unknown approver' }, 400);
    const now = new Date().toISOString();
    insertApproval(db, { id: newId('appr_'), ticketId: id, requestedById: currentAgentId(), approverId, reason, createdAt: now });
    logEvent(id, 'approval', currentAgentId(), { state: 'requested', reason }, now);
    return c.json(getApprovals(db, id));
  });
  app.post('/api/tickets/:id/approvals/:approvalId/decide', async (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    const approval = getApproval(db, c.req.param('approvalId'));
    if (approval === null || approval.ticketId !== id) return c.json({ error: 'approval not found' }, 404);
    if (approval.status !== 'pending') return c.json({ error: 'this request has already been decided' }, 409);
    let body: { decision?: unknown; note?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (body.decision !== 'approved' && body.decision !== 'rejected') return c.json({ error: 'decision must be approved or rejected' }, 400);
    const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
    const now = new Date().toISOString();
    decideApproval(db, { id: approval.id, status: body.decision, decidedById: currentAgentId(), decisionNote: note, decidedAt: now });
    logEvent(id, 'approval', currentAgentId(), { state: body.decision }, now);
    return c.json(getApprovals(db, id));
  });

  // Side conversations: private sub-threads on a ticket, kept off the customer conversation.
  app.get('/api/tickets/:id/side-conversations', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    return c.json(getSideConversations(db, id));
  });
  app.post('/api/tickets/:id/side-conversations', async (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    let body: { subject?: unknown; participant?: unknown; body?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    if (subject === '') return c.json({ error: 'subject is required' }, 400);
    const participant = typeof body.participant === 'string' && body.participant.trim() !== '' ? body.participant.trim() : null;
    const now = new Date().toISOString();
    const sideId = newId('side_');
    insertSideConversation(db, { id: sideId, ticketId: id, subject, participant, createdAt: now });
    const firstBody = typeof body.body === 'string' ? body.body.trim() : '';
    if (firstBody !== '') insertSideMessage(db, { id: newId('sm_'), sideId, authorId: currentAgentId(), body: firstBody, at: now });
    return c.json(getSideConversations(db, id));
  });
  app.post('/api/tickets/:id/side-conversations/:sideId/messages', async (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    const side = getSideConversation(db, c.req.param('sideId'));
    if (side === null || side.ticketId !== id) return c.json({ error: 'side conversation not found' }, 404);
    let body: { body?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (text === '') return c.json({ error: 'message body is required' }, 400);
    insertSideMessage(db, { id: newId('sm_'), sideId: side.id, authorId: currentAgentId(), body: text, at: new Date().toISOString() });
    return c.json(getSideConversations(db, id));
  });

  // Intake-form answers captured when the ticket was opened (shown as metadata).
  app.get('/api/tickets/:id/intake', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    return c.json(getTicketIntake(db, id));
  });

  app.post('/api/tickets/:id/messages', async (c) => {
    const id = c.req.param('id');
    const ticket = getTicket(db, id);
    if (ticket === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    // A closed ticket is locked: no one — not even an admin — can post to it until it is reopened.
    if (ticket.status === 'closed') return c.json({ error: 'ticket is closed — reopen it to reply' }, 409);
    if (ticket.mergedIntoId !== null) return c.json({ error: 'ticket was merged — reply on the ticket it was merged into' }, 409);

    let input: { kind?: unknown; body?: unknown; attachmentIds?: unknown; embeds?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { kind, body } = input;
    if (kind !== 'reply' && kind !== 'note') return c.json({ error: "kind must be 'reply' or 'note'" }, 400);
    if (typeof body !== 'string') return c.json({ error: 'body is required' }, 400);
    const attachmentIds = Array.isArray(input.attachmentIds)
      ? input.attachmentIds.filter((x): x is string => typeof x === 'string')
      : [];
    const embeds = sanitizeEmbeds(input.embeds);
    if (body.trim() === '' && attachmentIds.length === 0 && embeds.length === 0)
      return c.json({ error: 'a message, attachment, or citation is required' }, 400);

    const now = new Date().toISOString();
    const message: Message = {
      id: newId('m_'),
      ticketId: id,
      authorKind: 'agent',
      authorId: currentAgentId(),
      kind,
      body,
      at: now,
      embeds: embeds.length > 0 ? embeds : undefined,
    };
    const previewText =
      body.trim() !== '' ? preview(body) : embeds.length > 0 ? embedPreview(embeds[0]) : 'Sent an attachment';
    const nextStatus = kind === 'reply' && ticket.status === 'open' ? 'pending' : ticket.status;
    const nextPreview = kind === 'reply' ? previewText : ticket.lastMessagePreview;
    // The first agent reply stamps the SLA first-response clock.
    const nextFirstResponded = kind === 'reply' && ticket.firstRespondedAt === null ? now : ticket.firstRespondedAt;

    db.exec('BEGIN');
    try {
      db.prepare(
        'INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at, embeds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at,
        embeds.length > 0 ? JSON.stringify(embeds) : null,
      );
      if (attachmentIds.length > 0) linkAttachments(db, attachmentIds, message.id, id);
      db.prepare(
        'UPDATE tickets SET status = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?',
      ).run(nextStatus, now, now, nextPreview, nextFirstResponded, id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    // The agent who acts on a ticket starts watching it, so later activity reaches them.
    followTicket(db, id, message.authorId, now);
    // Notify the customer on a public reply (never on an internal note): email + source channel.
    // Cited passages ride along as attributed quote text — the customer has no embed card.
    if (kind === 'reply') {
      const outbound =
        [body.trim(), embeds.length > 0 ? embedsText(embeds) : ''].filter((s) => s !== '').join('\n\n') ||
        '(sent an attachment)';
      deliverReply(ticket, outbound);
    }
    // An internal note can @mention teammates — alert each of them.
    if (kind === 'note') notifyMentions({ body, ticketId: id, messageId: message.id, actorId: message.authorId, now });
    const saved = getMessages(db, id).find((m) => m.id === message.id) ?? message;
    return c.json({ message: saved, ticket: getTicket(db, id) });
  });

  // Soft-delete a message: the row stays (audit trail) and we stamp who removed
  // it and when, so the thread shows a tombstone instead of the content.
  app.delete('/api/tickets/:tid/messages/:mid', (c) => {
    const tid = c.req.param('tid');
    const mid = c.req.param('mid');
    const msg = getMessage(db, mid);
    if (msg === null || msg.ticketId !== tid) return c.json({ error: 'message not found' }, 404);
    if (!msg.deletedAt) {
      db.prepare('UPDATE messages SET deletedAt = ?, deletedBy = ? WHERE id = ?')
        .run(new Date().toISOString(), currentAgentId(), mid);
    }
    return c.json({ message: getMessages(db, tid).find((m) => m.id === mid) ?? null });
  });

  // Merge a duplicate ticket into another, GitHub-style: the source keeps its own
  // conversation, is closed as a tombstone pointing at the target, and the target
  // gets a cross-reference note. Nothing is moved or deleted. Idempotency and
  // cycles are rejected up front.
  app.post('/api/tickets/:id/merge', async (c) => {
    const id = c.req.param('id');
    const source = getTicket(db, id);
    if (source === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    let input: { into?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const into = typeof input.into === 'string' ? input.into : '';
    if (into === '') return c.json({ error: 'into is required' }, 400);
    if (into === id) return c.json({ error: 'cannot merge a ticket into itself' }, 400);
    const target = getTicket(db, into);
    if (target === null) return c.json({ error: `target ticket not found: ${into}` }, 404);
    if (source.mergedIntoId !== null) return c.json({ error: 'ticket is already merged' }, 409);
    if (target.mergedIntoId !== null) return c.json({ error: 'cannot merge into an already-merged ticket' }, 409);

    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      // Keep the source's messages/attachments on the source; only cross-reference
      // the merge on the target so nothing is moved or lost.
      db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(newId('m_'), into, 'agent', currentAgentId(), 'note', `Merged ticket #${source.number} — "${source.subject}" — into this one.`, now);
      db.prepare('UPDATE tickets SET mergedIntoId = ?, status = ?, updatedAt = ? WHERE id = ?').run(into, 'closed', now, id);
      logEvent(id, 'merged', currentAgentId(), { targetId: into, targetNumber: target.number }, now);
      // The merge is fresh activity on the target — bump it so it surfaces in views.
      db.prepare('UPDATE tickets SET updatedAt = ? WHERE id = ?').run(now, into);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return c.json({ source: getTicket(db, id), target: getTicket(db, into) });
  });

  // Heartbeat + read presence in one call: records that this session is viewing the
  // ticket and returns the other sessions currently on it (for collision avoidance).
  app.post('/api/tickets/:id/presence', async (c) => {
    const id = c.req.param('id');
    let body: { sessionId?: unknown; agentId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const agentId = typeof body.agentId === 'string' && body.agentId !== '' ? body.agentId : currentAgentId();
    const now = Date.now();
    let forTicket = presence.get(id);
    if (forTicket === undefined) {
      forTicket = new Map();
      presence.set(id, forTicket);
    }
    if (sessionId !== '') forTicket.set(sessionId, { agentId, at: now });
    const seen = new Set<string>();
    const present: string[] = [];
    for (const [sid, e] of forTicket) {
      if (now - e.at > PRESENCE_TTL) {
        forTicket.delete(sid);
        continue;
      }
      if (sid !== sessionId && !seen.has(e.agentId)) {
        seen.add(e.agentId);
        present.push(e.agentId);
      }
    }
    if (forTicket.size === 0) presence.delete(id);
    return c.json({ present });
  });

  // Queue a reply/note to post to a ticket at a future time (send later).
  app.post('/api/tickets/:id/schedule', async (c) => {
    const id = c.req.param('id');
    const ticket = getTicket(db, id);
    if (ticket === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    let input: { kind?: unknown; body?: unknown; sendAt?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (input.kind !== 'reply' && input.kind !== 'note') return c.json({ error: "kind must be 'reply' or 'note'" }, 400);
    if (typeof input.body !== 'string' || input.body.trim() === '') return c.json({ error: 'body is required' }, 400);
    const when = typeof input.sendAt === 'string' ? Date.parse(input.sendAt) : NaN;
    if (Number.isNaN(when)) return c.json({ error: 'sendAt must be an ISO timestamp' }, 400);
    if (when <= Date.now()) return c.json({ error: 'sendAt must be in the future' }, 400);
    const row: ScheduledMessage = {
      id: newId('sm_'), ticketId: id, authorId: currentAgentId(), kind: input.kind,
      body: input.body, sendAt: new Date(when).toISOString(), createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO scheduled_messages (id, ticketId, authorId, kind, body, sendAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.ticketId, row.authorId, row.kind, row.body, row.sendAt, row.createdAt);
    return c.json(row);
  });

  app.get('/api/tickets/:id/scheduled', (c) => {
    const rows = db
      .prepare('SELECT * FROM scheduled_messages WHERE ticketId = ? ORDER BY sendAt ASC')
      .all(c.req.param('id')) as unknown as ScheduledMessage[];
    return c.json(rows);
  });

  app.delete('/api/scheduled/:sid', (c) => {
    db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(c.req.param('sid'));
    return c.json({ ok: true });
  });

  // Split selected messages out of a ticket into a new, related ticket — the inverse of merge.
  app.post('/api/tickets/:id/split', async (c) => {
    const id = c.req.param('id');
    const source = getTicket(db, id);
    if (source === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    if (source.mergedIntoId !== null) return c.json({ error: 'cannot split a merged ticket' }, 409);
    let input: { subject?: unknown; messageIds?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
    if (subject === '') return c.json({ error: 'subject is required' }, 400);
    const messageIds = Array.isArray(input.messageIds) ? input.messageIds.filter((x): x is string => typeof x === 'string') : [];
    if (messageIds.length === 0) return c.json({ error: 'select at least one message to split out' }, 400);
    const owned = db.prepare('SELECT id FROM messages WHERE ticketId = ?').all(id) as { id: string }[];
    const ownedSet = new Set(owned.map((r) => r.id));
    if (!messageIds.every((m) => ownedSet.has(m))) return c.json({ error: 'a message does not belong to this ticket' }, 400);
    if (messageIds.length >= ownedSet.size) return c.json({ error: 'a split must leave at least one message behind' }, 400);

    const now = new Date().toISOString();
    const maxRow = db.prepare('SELECT COALESCE(MAX(number), 0) AS maxNumber FROM tickets').get() as { maxNumber: number };
    const created: Ticket = {
      id: newId('t_'),
      number: maxRow.maxNumber + 1,
      subject,
      status: 'open',
      priority: source.priority,
      bucket: 'inbox',
      requesterId: source.requesterId,
      assigneeId: null,
      tags: [],
      channel: source.channel,
      createdAt: now,
      updatedAt: now,
      snoozedUntil: null,
      lastMessageAt: now,
      lastMessagePreview: '',
      firstRespondedAt: null,
      resolvedAt: null,
      channelId: null,
      mergedIntoId: null,
      awaitingReply: true,
      customFields: {},
      category: source.category,
    };
    const placeholders = messageIds.map(() => '?').join(', ');
    db.exec('BEGIN');
    try {
      insertTicketRow(db, created);
      db.prepare(`UPDATE messages SET ticketId = ? WHERE ticketId = ? AND id IN (${placeholders})`).run(created.id, id, ...messageIds);
      db.prepare(`UPDATE attachments SET ticketId = ? WHERE messageId IN (${placeholders})`).run(created.id, ...messageIds);
      recomputeDerived(id);
      recomputeDerived(created.id);
      // Link the two halves so agents can navigate between them.
      insertLink(db, { id: newId('lk_'), fromId: id, toId: created.id, type: 'related', createdAt: now });
      logEvent(id, 'split', currentAgentId(), { targetId: created.id, targetNumber: created.number, count: messageIds.length }, now);
      logEvent(created.id, 'created', currentAgentId(), {}, now);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return c.json({ source: getTicket(db, id), created: getTicket(db, created.id) });
  });

  // Upload a file (unattached until a message references it), then serve it back.
  app.post('/api/uploads', async (c) => {
    const form = await c.req.parseBody().catch(() => null);
    if (form === null) return c.json({ error: 'invalid form body' }, 400);
    const file = form.file;
    if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);
    if (file.size > MAX_UPLOAD) return c.json({ error: 'file exceeds the 10 MB limit' }, 413);
    const buf = Buffer.from(await file.arrayBuffer());
    const attachment: Attachment = {
      id: newId('at_'),
      messageId: null,
      ticketId: null,
      filename: (file.name || 'file').slice(0, 200),
      mimeType: file.type || 'application/octet-stream',
      size: buf.length,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(path.join(attachDir, attachment.id), buf);
    insertAttachment(db, attachment);
    return c.json(attachment);
  });

  app.get('/api/attachments/:id', (c) => {
    const id = c.req.param('id');
    const att = getAttachment(db, id);
    if (att === null) return c.json({ error: 'attachment not found' }, 404);
    const filePath = path.join(attachDir, id);
    if (!existsSync(filePath)) return c.json({ error: 'file missing' }, 404);
    const buf = readFileSync(filePath);
    // Inline images so they preview in-thread, but never SVG (script vector); everything else downloads.
    const inline = att.mimeType.startsWith('image/') && att.mimeType !== 'image/svg+xml';
    const safeName = att.filename.replace(/[\r\n"]/g, '');
    return c.body(new Uint8Array(buf), 200, {
      'Content-Type': att.mimeType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
      'Content-Length': String(buf.length),
      'X-Content-Type-Options': 'nosniff',
    });
  });

  app.post('/api/contacts', async (c) => {
    let input: { name?: unknown; email?: unknown; company?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { name, email, company } = input;
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'name is required' }, 400);
    if (typeof email !== 'string' || email.trim() === '') return c.json({ error: 'email is required' }, 400);

    const contact: Contact = {
      id: newId('c_'),
      name: name.trim(),
      email: email.trim(),
      company: typeof company === 'string' && company.trim() !== '' ? company.trim() : null,
      avatarHue: djb2(email.trim()) % 360,
      location: null,
      timezone: null,
      createdAt: new Date().toISOString(),
      mrr: null,
    };
    db.prepare(
      'INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(contact.id, contact.name, contact.email, contact.company, contact.avatarHue, contact.location, contact.timezone, contact.createdAt, contact.mrr);
    return c.json(contact);
  });

  app.post('/api/canned', async (c) => {
    let input: { title?: unknown; body?: unknown; actions?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { title, body } = input;
    if (typeof title !== 'string' || title.trim() === '') return c.json({ error: 'title is required' }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'body is required' }, 400);
    const actions = normalizeMacroActions(input.actions);
    const canned: CannedReply = { id: newId('cr_'), title, body, actions };
    db.prepare('INSERT INTO canned_replies (id, title, body, actions) VALUES (?, ?, ?, ?)').run(
      canned.id, canned.title, canned.body, actions === null ? null : JSON.stringify(actions),
    );
    return c.json(canned);
  });

  app.put('/api/canned/:id', async (c) => {
    const id = c.req.param('id');
    const existing = db.prepare('SELECT id FROM canned_replies WHERE id = ?').get(id) as { id: string } | undefined;
    if (existing === undefined) return c.json({ error: `canned reply not found: ${id}` }, 404);
    let input: { title?: unknown; body?: unknown; actions?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { title, body } = input;
    if (typeof title !== 'string' || title.trim() === '') return c.json({ error: 'title is required' }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'body is required' }, 400);
    const actions = normalizeMacroActions(input.actions);
    db.prepare('UPDATE canned_replies SET title = ?, body = ?, actions = ? WHERE id = ?').run(
      title, body, actions === null ? null : JSON.stringify(actions), id,
    );
    return c.json({ id, title, body, actions } satisfies CannedReply);
  });

  app.delete('/api/canned/:id', (c) => {
    const id = c.req.param('id');
    db.prepare('DELETE FROM canned_replies WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  // --- Ticket templates: reusable starting points for the New Ticket dialog ---
  const parseTemplateInput = (input: Record<string, unknown>): Omit<TicketTemplate, 'id'> | null => {
    if (typeof input.name !== 'string' || input.name.trim() === '') return null;
    const priority = typeof input.priority === 'string' && PRIORITIES.includes(input.priority as TicketPriority) ? (input.priority as TicketPriority) : 'medium';
    const category = typeof input.category === 'string' && input.category.trim() !== '' ? input.category.trim() : null;
    const tags = Array.isArray(input.tags)
      ? [...new Set(input.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter((t) => t !== ''))]
      : [];
    return {
      name: input.name.trim(),
      subject: typeof input.subject === 'string' ? input.subject : '',
      body: typeof input.body === 'string' ? input.body : '',
      priority,
      category,
      tags,
    };
  };

  app.post('/api/templates', async (c) => {
    let input: Record<string, unknown>;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const shaped = parseTemplateInput(input);
    if (shaped === null) return c.json({ error: 'name is required' }, 400);
    const template: TicketTemplate = { id: newId('tpl_'), ...shaped };
    db.prepare('INSERT INTO ticket_templates (id, name, subject, body, priority, category, tags) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(template.id, template.name, template.subject, template.body, template.priority, template.category, JSON.stringify(template.tags));
    return c.json(template);
  });

  app.put('/api/templates/:id', async (c) => {
    const id = c.req.param('id');
    const existing = db.prepare('SELECT id FROM ticket_templates WHERE id = ?').get(id) as { id: string } | undefined;
    if (existing === undefined) return c.json({ error: `template not found: ${id}` }, 404);
    let input: Record<string, unknown>;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const shaped = parseTemplateInput(input);
    if (shaped === null) return c.json({ error: 'name is required' }, 400);
    db.prepare('UPDATE ticket_templates SET name = ?, subject = ?, body = ?, priority = ?, category = ?, tags = ? WHERE id = ?')
      .run(shaped.name, shaped.subject, shaped.body, shaped.priority, shaped.category, JSON.stringify(shaped.tags), id);
    return c.json({ id, ...shaped } satisfies TicketTemplate);
  });

  app.delete('/api/templates/:id', (c) => {
    db.prepare('DELETE FROM ticket_templates WHERE id = ?').run(c.req.param('id'));
    return c.json({ ok: true });
  });

  // --- Custom reports: saved metric-by-dimension analytics configs ---
  const REPORT_METRICS = ['volume', 'solved', 'resolution', 'csat'];
  const REPORT_DIMENSIONS = ['day', 'agent', 'priority', 'status', 'category', 'tag'];
  const REPORT_RANGES = ['last_7', 'last_14', 'last_30', 'all'];
  const parseReportInput = (input: Record<string, unknown>): Omit<CustomReport, 'id'> | null => {
    if (typeof input.name !== 'string' || input.name.trim() === '') return null;
    if (typeof input.metric !== 'string' || !REPORT_METRICS.includes(input.metric)) return null;
    if (typeof input.dimension !== 'string' || !REPORT_DIMENSIONS.includes(input.dimension)) return null;
    if (typeof input.range !== 'string' || !REPORT_RANGES.includes(input.range)) return null;
    return {
      name: input.name.trim(),
      metric: input.metric as CustomReport['metric'],
      dimension: input.dimension as CustomReport['dimension'],
      range: input.range as CustomReport['range'],
    };
  };
  app.post('/api/reports', async (c) => {
    let input: Record<string, unknown>;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const shaped = parseReportInput(input);
    if (shaped === null) return c.json({ error: 'name, metric, dimension and range are required' }, 400);
    const report: CustomReport = { id: newId('rep_'), ...shaped };
    db.prepare('INSERT INTO custom_reports (id, name, metric, dimension, range) VALUES (?, ?, ?, ?, ?)')
      .run(report.id, report.name, report.metric, report.dimension, report.range);
    return c.json(report);
  });
  app.put('/api/reports/:id', async (c) => {
    const id = c.req.param('id');
    const existing = db.prepare('SELECT id FROM custom_reports WHERE id = ?').get(id) as { id: string } | undefined;
    if (existing === undefined) return c.json({ error: `report not found: ${id}` }, 404);
    let input: Record<string, unknown>;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const shaped = parseReportInput(input);
    if (shaped === null) return c.json({ error: 'name, metric, dimension and range are required' }, 400);
    db.prepare('UPDATE custom_reports SET name = ?, metric = ?, dimension = ?, range = ? WHERE id = ?')
      .run(shaped.name, shaped.metric, shaped.dimension, shaped.range, id);
    return c.json({ id, ...shaped } satisfies CustomReport);
  });
  app.delete('/api/reports/:id', (c) => {
    db.prepare('DELETE FROM custom_reports WHERE id = ?').run(c.req.param('id'));
    return c.json({ ok: true });
  });

  // --- Status page: PUBLIC read, admin-managed components + incidents ---
  const COMPONENT_STATUSES: ComponentStatus[] = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'];
  const INCIDENT_STATUSES: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved'];
  const INCIDENT_IMPACTS: IncidentImpact[] = ['minor', 'major', 'critical', 'maintenance'];

  // Public: anyone (incl. the un-authed portal) can read the status page.
  app.get('/api/status', (c) => c.json({ components: getStatusComponents(db), incidents: getStatusIncidents(db) }));

  app.post('/api/status/components', async (c) => {
    let body: { name?: unknown; status?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof body.name !== 'string' || body.name.trim() === '') return c.json({ error: 'name is required' }, 400);
    const status = typeof body.status === 'string' && COMPONENT_STATUSES.includes(body.status as ComponentStatus) ? (body.status as ComponentStatus) : 'operational';
    const component: StatusComponent = { id: newId('sc_'), name: body.name.trim(), status, position: maxComponentPosition(db) + 1 };
    insertStatusComponent(db, component);
    return c.json(getStatusComponents(db));
  });
  app.put('/api/status/components/:id', async (c) => {
    const id = c.req.param('id');
    if (!getStatusComponents(db).some((x) => x.id === id)) return c.json({ error: 'component not found' }, 404);
    let body: { name?: unknown; status?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof body.name !== 'string' || body.name.trim() === '') return c.json({ error: 'name is required' }, 400);
    if (typeof body.status !== 'string' || !COMPONENT_STATUSES.includes(body.status as ComponentStatus)) return c.json({ error: 'invalid status' }, 400);
    updateStatusComponent(db, { id, name: body.name.trim(), status: body.status });
    return c.json(getStatusComponents(db));
  });
  app.delete('/api/status/components/:id', (c) => {
    deleteStatusComponent(db, c.req.param('id'));
    return c.json(getStatusComponents(db));
  });

  app.post('/api/status/incidents', async (c) => {
    let body: { title?: unknown; impact?: unknown; body?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof body.title !== 'string' || body.title.trim() === '') return c.json({ error: 'title is required' }, 400);
    const impact = typeof body.impact === 'string' && INCIDENT_IMPACTS.includes(body.impact as IncidentImpact) ? (body.impact as IncidentImpact) : 'minor';
    const message = typeof body.body === 'string' ? body.body.trim() : '';
    const now = new Date().toISOString();
    const incident: StatusIncident = {
      id: newId('si_'),
      title: body.title.trim(),
      impact,
      status: 'investigating',
      createdAt: now,
      resolvedAt: null,
      updates: [{ at: now, status: 'investigating', body: message !== '' ? message : 'We are investigating this incident.' }],
    };
    insertStatusIncident(db, incident);
    return c.json(getStatusIncidents(db));
  });
  app.post('/api/status/incidents/:id/updates', async (c) => {
    const id = c.req.param('id');
    const incident = getStatusIncident(db, id);
    if (incident === null) return c.json({ error: 'incident not found' }, 404);
    let body: { status?: unknown; body?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof body.status !== 'string' || !INCIDENT_STATUSES.includes(body.status as IncidentStatus)) return c.json({ error: 'invalid status' }, 400);
    const message = typeof body.body === 'string' ? body.body.trim() : '';
    if (message === '') return c.json({ error: 'an update message is required' }, 400);
    const now = new Date().toISOString();
    const status = body.status as IncidentStatus;
    const update: IncidentUpdate = { at: now, status, body: message };
    const updates = [...incident.updates, update];
    const resolvedAt = status === 'resolved' ? now : null;
    updateStatusIncident(db, { id, status, resolvedAt, updates });
    return c.json(getStatusIncidents(db));
  });
  app.delete('/api/status/incidents/:id', (c) => {
    deleteStatusIncident(db, c.req.param('id'));
    return c.json(getStatusIncidents(db));
  });

  // --- Announcements: PUBLIC read (active only), admin-managed ---
  const ANNOUNCEMENT_LEVELS: AnnouncementLevel[] = ['info', 'warning', 'critical'];
  // Public: the portal shows active announcements as a banner.
  app.get('/api/portal/announcements', (c) => c.json(getAnnouncements(db, true)));

  app.post('/api/announcements', async (c) => {
    let body: { body?: unknown; level?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof body.body !== 'string' || body.body.trim() === '') return c.json({ error: 'a message is required' }, 400);
    const level = typeof body.level === 'string' && ANNOUNCEMENT_LEVELS.includes(body.level as AnnouncementLevel) ? (body.level as AnnouncementLevel) : 'info';
    const announcement: Announcement = { id: newId('ann_'), body: body.body.trim(), level, active: true, createdAt: new Date().toISOString() };
    insertAnnouncement(db, announcement);
    return c.json(getAnnouncements(db));
  });
  app.put('/api/announcements/:id', async (c) => {
    const id = c.req.param('id');
    if (!announcementExists(db, id)) return c.json({ error: 'announcement not found' }, 404);
    let body: { body?: unknown; level?: unknown; active?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof body.body !== 'string' || body.body.trim() === '') return c.json({ error: 'a message is required' }, 400);
    const level = typeof body.level === 'string' && ANNOUNCEMENT_LEVELS.includes(body.level as AnnouncementLevel) ? (body.level as AnnouncementLevel) : 'info';
    updateAnnouncement(db, { id, body: body.body.trim(), level, active: body.active !== false });
    return c.json(getAnnouncements(db));
  });
  app.delete('/api/announcements/:id', (c) => {
    deleteAnnouncement(db, c.req.param('id'));
    return c.json(getAnnouncements(db));
  });

  // --- White-label branding: PUBLIC read, admin-managed ---
  app.get('/api/portal/branding', (c) => c.json(branding()));
  app.put('/api/settings/branding', async (c) => {
    let input: { productName?: unknown; accentColor?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const productName = typeof input.productName === 'string' && input.productName.trim() !== '' ? input.productName.trim().slice(0, 40) : DEFAULT_BRANDING.productName;
    const accentColor = typeof input.accentColor === 'string' && HEX_RE.test(input.accentColor) ? input.accentColor : '';
    const value: Branding = { productName, accentColor };
    setSetting(db, 'branding', JSON.stringify(value));
    return c.json(value);
  });

  app.get('/api/notifications', (c) => c.json(getNotifications(db, currentAgentId())));

  // Mark one notification read ({ id }), or all of the current agent's (no body).
  // Returns the refreshed list so the client can resync in a single round-trip.
  app.post('/api/notifications/read', async (c) => {
    let input: { id?: unknown } = {};
    try {
      input = await c.req.json();
    } catch {
      /* empty body → mark all read */
    }
    const id = typeof input.id === 'string' ? input.id : undefined;
    markNotificationsRead(db, currentAgentId(), new Date().toISOString(), id);
    return c.json(getNotifications(db, currentAgentId()));
  });

  // Import contacts or tickets from CSV. With dryRun, nothing is written — it
  // returns the resolved column mapping and a per-row preview of what would
  // happen, so the UI can confirm before committing.
  // Export contacts or tickets as a downloadable CSV.
  app.get('/api/export', (c) => {
    const type = c.req.query('type');
    if (type !== 'contacts' && type !== 'tickets') return c.json({ error: "type must be 'contacts' or 'tickets'" }, 400);

    let csv: string;
    if (type === 'contacts') {
      const rows = (db.prepare('SELECT * FROM contacts ORDER BY rowid').all() as unknown as Contact[]).map((ct) => [
        ct.name, ct.email, ct.company, ct.mrr, ct.location, ct.createdAt,
      ]);
      csv = toCsv(['name', 'email', 'company', 'mrr', 'location', 'createdAt'], rows);
    } else {
      const tickets = (db.prepare('SELECT * FROM tickets ORDER BY number').all() as unknown as TicketRow[]).map(rowToTicket);
      const rows = tickets.map((t) => {
        const requester = getContact(db, t.requesterId);
        const assignee = t.assigneeId !== null ? agentName(t.assigneeId) : '';
        return [
          t.number, t.subject, t.status, t.priority, requester?.email ?? '', assignee,
          t.tags.join(', '), t.channel, t.createdAt, t.updatedAt, t.resolvedAt,
        ];
      });
      csv = toCsv(
        ['number', 'subject', 'status', 'priority', 'requesterEmail', 'assignee', 'tags', 'channel', 'createdAt', 'updatedAt', 'resolvedAt'],
        rows,
      );
    }
    return c.body(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="basedesk-${type}.csv"`,
    });
  });

  app.post('/api/import', async (c) => {
    let input: { type?: unknown; csv?: unknown; mapping?: unknown; dryRun?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const type: ImportType | null = input.type === 'contacts' || input.type === 'tickets' ? input.type : null;
    if (type === null) return c.json({ error: "type must be 'contacts' or 'tickets'" }, 400);
    if (typeof input.csv !== 'string' || input.csv.trim() === '') return c.json({ error: 'csv is required' }, 400);

    const { headers, rows } = parseCsv(input.csv);
    if (headers.length === 0) return c.json({ error: 'no columns found in the CSV' }, 400);

    // Start from the auto-mapping, then apply any valid client overrides.
    const mapping = autoMapColumns(type, headers);
    if (input.mapping !== null && typeof input.mapping === 'object') {
      const fieldKeys = new Set(IMPORT_FIELDS[type].map((f) => f.key));
      for (const [k, v] of Object.entries(input.mapping as Record<string, unknown>)) {
        if (fieldKeys.has(k) && typeof v === 'string' && headers.includes(v)) mapping[k] = v;
        else if (fieldKeys.has(k) && v === '') delete mapping[k]; // explicit "don't map"
      }
    }

    const meta = { type, headers, mapping, fields: IMPORT_FIELDS[type], rowCount: rows.length };
    const missing = IMPORT_FIELDS[type].filter((f) => f.required && mapping[f.key] === undefined).map((f) => f.label);
    if (missing.length > 0) return c.json({ error: `Map a column for: ${missing.join(', ')}`, ...meta }, 400);

    const dryRun = input.dryRun === true;
    const val = (row: Record<string, string>, key: string): string => (mapping[key] !== undefined ? (row[mapping[key]] ?? '').trim() : '');
    const now = new Date().toISOString();
    const seenEmails = new Set<string>();
    let created = 0;
    const skipped: { row: number; reason: string }[] = [];
    const errors: { row: number; reason: string }[] = [];

    const run = () => {
      rows.forEach((row, idx) => {
        const line = idx + 2; // 1-based, plus the header row
        if (type === 'contacts') {
          const name = val(row, 'name');
          const email = val(row, 'email').toLowerCase();
          if (name === '' || email === '') return void errors.push({ row: line, reason: 'missing name or email' });
          if (!IMPORT_EMAIL_RE.test(email)) return void errors.push({ row: line, reason: `invalid email "${email}"` });
          if (seenEmails.has(email) || getContactByEmail(db, email) !== null) return void skipped.push({ row: line, reason: `${email} already exists` });
          seenEmails.add(email);
          if (!dryRun) {
            db.prepare('INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .run(newId('c_'), name, email, val(row, 'company') || null, djb2(email) % 360, null, null, now, null);
          }
          created += 1;
        } else {
          const subject = val(row, 'subject');
          const email = val(row, 'requesterEmail').toLowerCase();
          if (subject === '' || email === '') return void errors.push({ row: line, reason: 'missing subject or requester email' });
          if (!IMPORT_EMAIL_RE.test(email)) return void errors.push({ row: line, reason: `invalid email "${email}"` });
          const rawPriority = val(row, 'priority').toLowerCase();
          const priority = PRIORITIES.includes(rawPriority as TicketPriority) ? (rawPriority as TicketPriority) : 'medium';
          const rawStatus = val(row, 'status').toLowerCase().replace(/\s+/g, '_');
          const status = STATUSES.includes(rawStatus) ? (rawStatus as TicketStatus) : 'open';
          const tags = val(row, 'tags').split(/[,;]/).map((t) => t.trim()).filter((t) => t !== '');
          const bodyText = val(row, 'body') || subject;
          if (!dryRun) {
            let contact = getContactByEmail(db, email);
            if (contact === null) {
              const cid = newId('c_');
              db.prepare('INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(cid, email.split('@')[0], email, null, djb2(email) % 360, null, null, now, null);
              contact = getContactByEmail(db, email);
            }
            const maxRow = db.prepare('SELECT COALESCE(MAX(number), 0) AS maxNumber FROM tickets').get() as { maxNumber: number };
            const resolved = status === 'solved' || status === 'closed';
            const ticket: Ticket = {
              id: newId('t_'), number: maxRow.maxNumber + 1, subject, status, priority, bucket: 'inbox',
              requesterId: contact!.id, assigneeId: null, tags, channel: 'web', createdAt: now, updatedAt: now,
              snoozedUntil: null, lastMessageAt: now, lastMessagePreview: preview(bodyText),
              firstRespondedAt: null, resolvedAt: resolved ? now : null, channelId: null, mergedIntoId: null, awaitingReply: !resolved, customFields: {}, category: null,
            };
            insertTicketRow(db, ticket);
            db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(newId('m_'), ticket.id, 'contact', contact!.id, 'reply', bodyText, now);
          }
          created += 1;
        }
      });
    };

    if (dryRun) {
      run();
    } else {
      db.exec('BEGIN');
      try {
        run();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }

    return c.json({
      ...meta, dryRun, created,
      skippedCount: skipped.length, errorCount: errors.length,
      skipped: skipped.slice(0, 100), errors: errors.slice(0, 100),
    });
  });

  app.get('/api/deals', (c) => {
    const stage = c.req.query('stage');
    const type = c.req.query('type');
    const contactId = c.req.query('contactId');
    const clauses: string[] = [];
    const params: string[] = [];
    if (stage !== undefined && stage !== '') {
      if (!DEAL_STAGES.includes(stage as DealStage)) return c.json({ error: `unknown stage: ${stage}` }, 400);
      clauses.push('stage = ?');
      params.push(stage);
    }
    if (type !== undefined && type !== '') {
      if (!DEAL_TYPES.includes(type as DealType)) return c.json({ error: `unknown type: ${type}` }, 400);
      clauses.push('type = ?');
      params.push(type);
    }
    if (contactId !== undefined && contactId !== '') {
      clauses.push('contactId = ?');
      params.push(contactId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM deals ${where} ORDER BY updatedAt DESC`).all(...params) as unknown as Deal[];
    return c.json(rows);
  });

  app.post('/api/deals', async (c) => {
    let input: {
      title?: unknown; type?: unknown; value?: unknown; contactId?: unknown;
      ticketId?: unknown; ownerId?: unknown; note?: unknown;
    };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { title, type, value, contactId, ticketId, ownerId, note } = input;
    if (typeof title !== 'string' || title.trim() === '') return c.json({ error: 'title is required' }, 400);
    if (typeof type !== 'string' || !DEAL_TYPES.includes(type as DealType)) return c.json({ error: 'invalid type' }, 400);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return c.json({ error: 'value must be a non-negative integer (cents)' }, 400);
    }
    if (typeof contactId !== 'string' || getContact(db, contactId) === null) {
      return c.json({ error: 'unknown contactId' }, 400);
    }
    let linkedTicketId: string | null = null;
    if (ticketId !== undefined && ticketId !== null) {
      if (typeof ticketId !== 'string' || getTicket(db, ticketId) === null) {
        return c.json({ error: 'unknown ticketId' }, 400);
      }
      linkedTicketId = ticketId;
    }
    let owner = currentAgentId();
    if (ownerId !== undefined) {
      if (typeof ownerId !== 'string') return c.json({ error: 'invalid ownerId' }, 400);
      owner = ownerId;
    }
    const now = new Date().toISOString();
    const deal: Deal = {
      id: newId('d_'),
      title: title.trim(),
      type: type as DealType,
      stage: 'open',
      value,
      currency: 'USD',
      contactId,
      ticketId: linkedTicketId,
      ownerId: owner,
      note: typeof note === 'string' ? note : '',
      createdAt: now,
      closedAt: null,
      updatedAt: now,
    };
    db.prepare(
      `INSERT INTO deals (
        id, title, type, stage, value, currency, contactId, ticketId, ownerId, note, createdAt, closedAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      deal.id, deal.title, deal.type, deal.stage, deal.value, deal.currency, deal.contactId,
      deal.ticketId, deal.ownerId, deal.note, deal.createdAt, deal.closedAt, deal.updatedAt,
    );
    return c.json(deal);
  });

  app.patch('/api/deals/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getDeal(db, id);
    if (existing === null) return c.json({ error: `deal not found: ${id}` }, 404);

    let patch: { title?: unknown; type?: unknown; stage?: unknown; value?: unknown; ownerId?: unknown; note?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if ('title' in patch) {
      if (typeof patch.title !== 'string' || patch.title.trim() === '') return c.json({ error: 'invalid title' }, 400);
      sets.push('title = ?');
      params.push(patch.title.trim());
    }
    if ('type' in patch) {
      if (typeof patch.type !== 'string' || !DEAL_TYPES.includes(patch.type as DealType)) return c.json({ error: 'invalid type' }, 400);
      sets.push('type = ?');
      params.push(patch.type);
    }
    if ('value' in patch) {
      if (typeof patch.value !== 'number' || !Number.isInteger(patch.value) || patch.value < 0) return c.json({ error: 'invalid value' }, 400);
      sets.push('value = ?');
      params.push(patch.value);
    }
    if ('ownerId' in patch) {
      if (typeof patch.ownerId !== 'string') return c.json({ error: 'invalid ownerId' }, 400);
      sets.push('ownerId = ?');
      params.push(patch.ownerId);
    }
    if ('note' in patch) {
      if (typeof patch.note !== 'string') return c.json({ error: 'invalid note' }, 400);
      sets.push('note = ?');
      params.push(patch.note);
    }
    const now = new Date().toISOString();
    if ('stage' in patch) {
      if (typeof patch.stage !== 'string' || !DEAL_STAGES.includes(patch.stage as DealStage)) return c.json({ error: 'invalid stage' }, 400);
      const stage = patch.stage as DealStage;
      sets.push('stage = ?');
      params.push(stage);
      if (stage === 'won' || stage === 'lost') {
        if (existing.closedAt === null) {
          sets.push('closedAt = ?');
          params.push(now);
        }
      } else {
        sets.push('closedAt = ?');
        params.push(null);
      }
    }
    sets.push('updatedAt = ?');
    params.push(now);
    db.prepare(`UPDATE deals SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(getDeal(db, id));
  });

  app.delete('/api/deals/:id', (c) => {
    const id = c.req.param('id');
    if (getDeal(db, id) === null) return c.json({ error: `deal not found: ${id}` }, 404);
    db.prepare('DELETE FROM deals WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  app.put('/api/settings/sla', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input !== 'object' || input === null) return c.json({ error: 'invalid SLA targets' }, 400);
    for (const p of PRIORITIES) {
      const t = (input as Record<string, unknown>)[p] as { firstResponseMins?: unknown; resolutionMins?: unknown } | undefined;
      if (
        t === undefined ||
        typeof t.firstResponseMins !== 'number' || t.firstResponseMins < 0 ||
        typeof t.resolutionMins !== 'number' || t.resolutionMins < 0
      ) {
        return c.json({ error: `invalid target for ${p}` }, 400);
      }
    }
    setSetting(db, 'sla', JSON.stringify(input));
    return c.json(input);
  });

  app.put('/api/settings/automation', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (!Array.isArray(input)) return c.json({ error: 'automation must be an array' }, 400);
    const CONDITIONS = ['subject_contains', 'body_contains', 'priority_is', 'channel_is', 'from_contains'];
    const ACTIONS = ['set_priority', 'add_tag', 'assign', 'set_status', 'set_category'];
    for (const r of input as AutomationRule[]) {
      if (
        typeof r?.id !== 'string' || typeof r?.name !== 'string' || typeof r?.enabled !== 'boolean' ||
        (r?.match !== 'all' && r?.match !== 'any') ||
        (r?.runOn !== 'create' && r?.runOn !== 'create_update') ||
        !Array.isArray(r?.conditions) || !Array.isArray(r?.actions)
      ) {
        return c.json({ error: 'invalid automation rule' }, 400);
      }
      for (const cnd of r.conditions) {
        if (!CONDITIONS.includes(cnd?.type) || typeof cnd?.value !== 'string') return c.json({ error: 'invalid condition' }, 400);
      }
      for (const act of r.actions) {
        if (!ACTIONS.includes(act?.type) || typeof act?.value !== 'string') return c.json({ error: 'invalid action' }, 400);
      }
    }
    setSetting(db, 'automation', JSON.stringify(input));
    return c.json(input);
  });

  app.put('/api/settings/assignment', async (c) => {
    let input: { enabled?: unknown; strategy?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.enabled !== 'boolean') return c.json({ error: 'enabled must be a boolean' }, 400);
    if (input.strategy !== 'round_robin' && input.strategy !== 'least_busy') return c.json({ error: 'invalid strategy' }, 400);
    const settings: AssignmentSettings = { enabled: input.enabled, strategy: input.strategy };
    setSetting(db, 'assignment', JSON.stringify(settings));
    return c.json(settings);
  });

  app.put('/api/settings/sla-hours', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const h = input as Record<string, unknown>;
    if (
      typeof h?.enabled !== 'boolean' || typeof h?.timezone !== 'string' ||
      !Array.isArray(h?.days) || !h.days.every((d) => typeof d === 'number' && d >= 0 && d <= 6) ||
      typeof h?.start !== 'string' || !/^\d{2}:\d{2}$/.test(h.start) ||
      typeof h?.end !== 'string' || !/^\d{2}:\d{2}$/.test(h.end)
    ) {
      return c.json({ error: 'invalid business hours' }, 400);
    }
    setSetting(db, 'sla_hours', JSON.stringify(input));
    return c.json(input);
  });

  app.put('/api/settings/auto-ack', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const a = input as Record<string, unknown>;
    if (typeof a?.enabled !== 'boolean' || typeof a?.message !== 'string') {
      return c.json({ error: 'invalid auto-acknowledgement settings' }, 400);
    }
    const value: AutoAck = { enabled: a.enabled, message: a.message };
    setSetting(db, 'auto_ack', JSON.stringify(value));
    return c.json(value);
  });

  app.put('/api/settings/business-hours', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const value = normalizeBusinessHours(input, DEFAULT_BUSINESS_HOURS);
    setSetting(db, 'business_hours', JSON.stringify(value));
    return c.json(value);
  });

  app.put('/api/settings/ai-automation', async (c) => {
    let input: Record<string, unknown>;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const value: AiAutomation = {
      autoSuggest: input.autoSuggest === true,
      autoResolve: input.autoResolve === true,
      autoTriage: input.autoTriage === true,
    };
    setSetting(db, 'ai_automation', JSON.stringify(value));
    return c.json(value);
  });

  app.put('/api/settings/on-call', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const o = input as Record<string, unknown>;
    if (typeof o?.enabled !== 'boolean' || (o.cadence !== 'daily' && o.cadence !== 'weekly') || typeof o.startDate !== 'string') {
      return c.json({ error: 'invalid on-call settings' }, 400);
    }
    // Keep only ids that map to a real agent, preserving order.
    const rotation = Array.isArray(o.rotation)
      ? o.rotation.filter((id): id is string => typeof id === 'string' && getAgent(db, id) !== null)
      : [];
    const value: OnCallConfig = { enabled: o.enabled, cadence: o.cadence, startDate: o.startDate, rotation };
    setSetting(db, 'on_call', JSON.stringify(value));
    return c.json(value);
  });

  app.put('/api/settings/time-rules', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (!Array.isArray(input)) return c.json({ error: 'time rules must be an array' }, 400);
    const TRIGGERS = ['awaiting_first_response', 'awaiting_reply', 'awaiting_customer'];
    const ACTIONS = ['set_priority', 'add_tag', 'assign', 'set_status', 'set_category'];
    for (const r of input as TimeRule[]) {
      if (
        typeof r?.id !== 'string' || typeof r?.name !== 'string' || typeof r?.enabled !== 'boolean' ||
        !TRIGGERS.includes(r?.trigger) || typeof r?.hours !== 'number' || !(r.hours > 0) || !Array.isArray(r?.actions)
      ) {
        return c.json({ error: 'invalid time rule' }, 400);
      }
      for (const a of r.actions) {
        if (typeof a?.type !== 'string' || !ACTIONS.includes(a.type) || typeof a?.value !== 'string') {
          return c.json({ error: 'invalid time-rule action' }, 400);
        }
      }
    }
    setSetting(db, 'time_rules', JSON.stringify(input));
    return c.json(input);
  });

  // Run the time-based rules now (also runs on a background interval).
  app.post('/api/settings/time-rules/run', (c) => c.json({ fired: evaluateTimeRules(Date.now()) }));

  app.post('/api/agents', async (c) => {
    let input: { name?: unknown; email?: unknown; role?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { name, email, role } = input;
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'name is required' }, 400);
    if (typeof email !== 'string' || email.trim() === '') return c.json({ error: 'email is required' }, 400);
    const agent: Agent = {
      id: newId('a_'), name: name.trim(), email: email.trim(), avatarHue: djb2(email.trim()) % 360,
      role: role === 'admin' ? 'admin' : 'agent', status: 'invited',
      inviteToken: `inv_${randomUUID().replace(/-/g, '').slice(0, 16)}`, signature: '', categories: [], languages: [],
    };
    db.prepare('INSERT INTO agents (id, name, email, avatarHue, role, status, inviteToken, signature, categories, languages) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(agent.id, agent.name, agent.email, agent.avatarHue, agent.role, agent.status, agent.inviteToken, agent.signature, JSON.stringify(agent.categories), JSON.stringify(agent.languages));
    return c.json(agent);
  });

  app.patch('/api/agents/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getAgent(db, id);
    if (existing === null) return c.json({ error: `agent not found: ${id}` }, 404);
    let patch: { name?: unknown; role?: unknown; signature?: unknown; categories?: unknown; languages?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: string[] = [];
    if ('name' in patch) {
      if (typeof patch.name !== 'string' || patch.name.trim() === '') return c.json({ error: 'invalid name' }, 400);
      sets.push('name = ?');
      params.push(patch.name.trim());
    }
    if ('role' in patch) {
      if (patch.role !== 'admin' && patch.role !== 'agent') return c.json({ error: 'invalid role' }, 400);
      sets.push('role = ?');
      params.push(patch.role);
    }
    if ('signature' in patch) {
      if (typeof patch.signature !== 'string') return c.json({ error: 'invalid signature' }, 400);
      sets.push('signature = ?');
      params.push(patch.signature);
    }
    if ('categories' in patch) {
      if (!Array.isArray(patch.categories)) return c.json({ error: 'invalid categories' }, 400);
      sets.push('categories = ?');
      params.push(JSON.stringify(patch.categories.filter((x): x is string => typeof x === 'string')));
    }
    if ('languages' in patch) {
      if (!Array.isArray(patch.languages)) return c.json({ error: 'invalid languages' }, 400);
      sets.push('languages = ?');
      params.push(JSON.stringify(patch.languages.filter((x): x is string => typeof x === 'string')));
    }
    if (sets.length === 0) return c.json(existing);
    db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(getAgent(db, id));
  });

  app.delete('/api/agents/:id', (c) => {
    const id = c.req.param('id');
    const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
    if (existing === undefined) return c.json({ error: `agent not found: ${id}` }, 404);
    const admins = db.prepare("SELECT COUNT(*) AS n FROM agents WHERE role = 'admin' AND status = 'active'").get() as { n: number };
    if (existing.role === 'admin' && existing.status === 'active' && admins.n <= 1) {
      return c.json({ error: 'cannot remove the last admin' }, 400);
    }
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  app.get('/api/kb', (c) => {
    const rows = db.prepare('SELECT * FROM kb_articles ORDER BY category, title').all() as unknown as KbArticle[];
    return c.json(rows);
  });

  app.post('/api/kb', async (c) => {
    let input: { title?: unknown; category?: unknown; body?: unknown; status?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { title, category, body, status } = input;
    if (typeof title !== 'string' || title.trim() === '') return c.json({ error: 'title is required' }, 400);
    if (typeof category !== 'string' || category.trim() === '') return c.json({ error: 'category is required' }, 400);
    if (typeof body !== 'string') return c.json({ error: 'body is required' }, 400);
    const st: ArticleStatus = status === 'published' ? 'published' : 'draft';
    const now = new Date().toISOString();
    const article: KbArticle = {
      id: newId('kb_'),
      title: title.trim(),
      slug: slugify(title),
      category: category.trim(),
      body,
      status: st,
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(
      'INSERT INTO kb_articles (id, title, slug, category, body, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(article.id, article.title, article.slug, article.category, article.body, article.status, article.createdAt, article.updatedAt);
    return c.json(article);
  });

  app.patch('/api/kb/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getKbArticle(db, id);
    if (existing === null) return c.json({ error: `article not found: ${id}` }, 404);
    let patch: { title?: unknown; category?: unknown; body?: unknown; status?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: string[] = [];
    if ('title' in patch) {
      if (typeof patch.title !== 'string' || patch.title.trim() === '') return c.json({ error: 'invalid title' }, 400);
      sets.push('title = ?', 'slug = ?');
      params.push(patch.title.trim(), slugify(patch.title));
    }
    if ('category' in patch) {
      if (typeof patch.category !== 'string' || patch.category.trim() === '') return c.json({ error: 'invalid category' }, 400);
      sets.push('category = ?');
      params.push(patch.category.trim());
    }
    if ('body' in patch) {
      if (typeof patch.body !== 'string') return c.json({ error: 'invalid body' }, 400);
      sets.push('body = ?');
      params.push(patch.body);
    }
    if ('status' in patch) {
      if (patch.status !== 'draft' && patch.status !== 'published') return c.json({ error: 'invalid status' }, 400);
      sets.push('status = ?');
      params.push(patch.status);
    }
    sets.push('updatedAt = ?');
    params.push(new Date().toISOString());
    db.prepare(`UPDATE kb_articles SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(getKbArticle(db, id));
  });

  app.delete('/api/kb/:id', (c) => {
    const id = c.req.param('id');
    if (getKbArticle(db, id) === null) return c.json({ error: `article not found: ${id}` }, 404);
    db.prepare('DELETE FROM kb_articles WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  app.post('/api/ai/agents', async (c) => {
    let input: { name?: unknown; autonomy?: unknown; scopeTags?: unknown; scopePriorities?: unknown; scopeCategories?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { name, autonomy, scopeTags, scopePriorities, scopeCategories } = input;
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'name is required' }, 400);
    if (typeof autonomy !== 'string' || !AUTONOMIES.includes(autonomy as Autonomy)) return c.json({ error: 'invalid autonomy' }, 400);
    const tags = Array.isArray(scopeTags) ? scopeTags.filter((x): x is string => typeof x === 'string') : [];
    const prios = Array.isArray(scopePriorities) ? scopePriorities.filter((p): p is TicketPriority => PRIORITIES.includes(p as TicketPriority)) : [];
    const cats = Array.isArray(scopeCategories) ? scopeCategories.filter((x): x is string => typeof x === 'string') : [];
    const agent = {
      id: newId('ai_'), name: name.trim(), avatarHue: djb2(name.trim()) % 360, enabled: true,
      autonomy: autonomy as Autonomy, scopeTags: tags, scopePriorities: prios, scopeCategories: cats, createdAt: new Date().toISOString(),
    };
    db.prepare(
      'INSERT INTO ai_agents (id, name, avatarHue, enabled, autonomy, scopeTags, scopePriorities, scopeCategories, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(agent.id, agent.name, agent.avatarHue, 1, agent.autonomy, JSON.stringify(agent.scopeTags), JSON.stringify(agent.scopePriorities), JSON.stringify(agent.scopeCategories), agent.createdAt);
    return c.json(agent);
  });

  app.patch('/api/ai/agents/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getAiAgent(db, id);
    if (existing === null) return c.json({ error: `agent not found: ${id}` }, 404);
    let patch: { name?: unknown; enabled?: unknown; autonomy?: unknown; scopeTags?: unknown; scopePriorities?: unknown; scopeCategories?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if ('name' in patch) {
      if (typeof patch.name !== 'string' || patch.name.trim() === '') return c.json({ error: 'invalid name' }, 400);
      sets.push('name = ?');
      params.push(patch.name.trim());
    }
    if ('enabled' in patch) {
      if (typeof patch.enabled !== 'boolean') return c.json({ error: 'invalid enabled' }, 400);
      sets.push('enabled = ?');
      params.push(patch.enabled ? 1 : 0);
    }
    if ('autonomy' in patch) {
      if (typeof patch.autonomy !== 'string' || !AUTONOMIES.includes(patch.autonomy as Autonomy)) return c.json({ error: 'invalid autonomy' }, 400);
      sets.push('autonomy = ?');
      params.push(patch.autonomy);
    }
    if ('scopeTags' in patch) {
      if (!Array.isArray(patch.scopeTags)) return c.json({ error: 'invalid scopeTags' }, 400);
      sets.push('scopeTags = ?');
      params.push(JSON.stringify(patch.scopeTags.filter((x): x is string => typeof x === 'string')));
    }
    if ('scopePriorities' in patch) {
      if (!Array.isArray(patch.scopePriorities)) return c.json({ error: 'invalid scopePriorities' }, 400);
      sets.push('scopePriorities = ?');
      params.push(JSON.stringify(patch.scopePriorities.filter((p): p is TicketPriority => PRIORITIES.includes(p as TicketPriority))));
    }
    if ('scopeCategories' in patch) {
      if (!Array.isArray(patch.scopeCategories)) return c.json({ error: 'invalid scopeCategories' }, 400);
      sets.push('scopeCategories = ?');
      params.push(JSON.stringify(patch.scopeCategories.filter((x): x is string => typeof x === 'string')));
    }
    if (sets.length === 0) return c.json(existing);
    db.prepare(`UPDATE ai_agents SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(getAiAgent(db, id));
  });

  app.delete('/api/ai/agents/:id', (c) => {
    const id = c.req.param('id');
    if (getAiAgent(db, id) === null) return c.json({ error: `agent not found: ${id}` }, 404);
    db.prepare('DELETE FROM ai_agents WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  // Manual: run the agents on demand — over the whole backlog, or one ticket when
  // `ticketId` is given (the per-ticket "Suggest a reply" button). Bypasses the
  // auto-suggest gate (it's an explicit click) but still honors auto-resolve.
  app.post('/api/ai/run', async (c) => {
    let body: { ticketId?: unknown } = {};
    try {
      body = await c.req.json();
    } catch {
      /* no body — backlog run */
    }
    if (typeof body.ticketId === 'string') {
      const ticket = getTicket(db, body.ticketId);
      if (ticket === null) return c.json({ error: 'ticket not found' }, 404);
      const firstContact = getMessages(db, ticket.id).find((m) => m.authorKind === 'contact');
      const action = await runAgentsOnTicket(ticket, firstContact?.body ?? '', { manual: true });
      return c.json({ created: action !== null ? 1 : 0 });
    }
    const actioned = new Set(
      (db.prepare('SELECT DISTINCT ticketId FROM ai_actions').all() as { ticketId: string }[]).map((r) => r.ticketId),
    );
    const rows = db
      .prepare("SELECT * FROM tickets WHERE bucket = 'inbox' AND status IN ('open', 'pending')")
      .all() as unknown as TicketRow[];
    let created = 0;
    for (const row of rows) {
      const ticket = rowToTicket(row);
      if (actioned.has(ticket.id)) continue;
      const firstContact = getMessages(db, ticket.id).find((m) => m.authorKind === 'contact');
      if ((await runAgentsOnTicket(ticket, firstContact?.body ?? '', { manual: true })) !== null) created += 1;
    }
    return c.json({ created });
  });

  // --- SMTP / email notifications (the password never leaves the server) ---

  app.get('/api/settings/smtp', (c) => c.json(toPublicSmtp(getSmtpConfig(db))));

  app.put('/api/settings/smtp', async (c) => {
    let input: Record<string, unknown>;
    try {
      input = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const current = getSmtpConfig(db);
    const str = (k: string, fallback: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : fallback);
    const cfg = {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
      host: str('host', current.host),
      port: typeof input.port === 'number' && input.port > 0 && input.port <= 65535 ? input.port : current.port,
      secure: typeof input.secure === 'boolean' ? input.secure : current.secure,
      user: str('user', current.user),
      fromName: str('fromName', current.fromName) || 'Support',
      fromEmail: str('fromEmail', current.fromEmail),
      publicUrl: (str('publicUrl', current.publicUrl) || current.publicUrl).replace(/\/+$/, ''),
      // pass absent → keep the stored password; a string (even empty) replaces it.
      pass: typeof input.pass === 'string' ? input.pass : current.pass,
    };
    setSmtpConfig(db, cfg);
    return c.json(toPublicSmtp(cfg));
  });

  app.post('/api/settings/smtp/test', async (c) => {
    let input: { to?: unknown };
    try {
      input = (await c.req.json()) as { to?: unknown };
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const cfg = getSmtpConfig(db);
    const to = typeof input.to === 'string' && input.to.trim() !== '' ? input.to.trim() : cfg.fromEmail;
    if (cfg.host.trim() === '' || cfg.fromEmail.trim() === '') return c.json({ ok: false, error: 'Set the SMTP host and From address first' }, 400);
    if (to === '') return c.json({ ok: false, error: 'No recipient — set a From address or pass one' }, 400);
    try {
      await sendTestEmail(cfg, to);
      return c.json({ ok: true, to });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'send failed' });
    }
  });

  // --- Model provider config (the API key never leaves the server) ---

  app.get('/api/ai/provider', (c) => c.json(toPublicProvider(getAiProviderConfig(db))));

  app.put('/api/ai/provider', async (c) => {
    let input: Record<string, unknown>;
    try {
      input = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const current = getAiProviderConfig(db);
    const temp = typeof input.temperature === 'number' ? input.temperature : current.temperature;
    const cfg: AiProviderConfig = {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
      baseUrl: typeof input.baseUrl === 'string' && input.baseUrl.trim() !== '' ? input.baseUrl.trim() : current.baseUrl,
      model: typeof input.model === 'string' && input.model.trim() !== '' ? input.model.trim() : current.model,
      temperature: Math.min(2, Math.max(0, temp)),
      reasoning: typeof input.reasoning === 'boolean' ? input.reasoning : current.reasoning,
      kbOnly: typeof input.kbOnly === 'boolean' ? input.kbOnly : current.kbOnly,
      // Never lose the key by accident: only a non-empty key replaces it, and only
      // an explicit removeKey clears it. A blank/absent apiKey keeps what's stored.
      apiKey: input.removeKey === true
        ? ''
        : typeof input.apiKey === 'string' && input.apiKey.trim() !== ''
          ? input.apiKey.trim()
          : current.apiKey,
    };
    setAiProviderConfig(db, cfg);
    return c.json(toPublicProvider(cfg));
  });

  app.post('/api/ai/provider/test', async (c) => {
    let override: Record<string, unknown> = {};
    try {
      override = (await c.req.json()) as Record<string, unknown>;
    } catch {
      // no body — test the stored config
    }
    const stored = getAiProviderConfig(db);
    const cfg: LlmConfig = {
      baseUrl: typeof override.baseUrl === 'string' && override.baseUrl.trim() !== '' ? override.baseUrl.trim() : stored.baseUrl,
      model: typeof override.model === 'string' && override.model.trim() !== '' ? override.model.trim() : stored.model,
      apiKey: typeof override.apiKey === 'string' && override.apiKey.trim() !== '' ? override.apiKey.trim() : stored.apiKey,
      temperature: 0,
    };
    if (cfg.apiKey === '') return c.json({ ok: false, error: 'Add an API key first' }, 400);
    const started = Date.now();
    try {
      const { reply } = await ping(cfg);
      return c.json({ ok: true, model: cfg.model, latencyMs: Date.now() - started, empty: reply.trim() === '' });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'request failed' });
    }
  });

  // List the models the provider currently offers (OpenAI-compatible GET /models),
  // so the picker shows everything available right now instead of a static list.
  // Uses the request's baseUrl/apiKey if given (the unsaved form values), else the
  // stored config. Returns { models } or { error } — always 200 so the UI reads it.
  app.post('/api/ai/models', async (c) => {
    let override: Record<string, unknown> = {};
    try {
      override = (await c.req.json()) as Record<string, unknown>;
    } catch {
      /* no body — use the stored config */
    }
    const stored = getAiProviderConfig(db);
    const baseUrl = (typeof override.baseUrl === 'string' && override.baseUrl.trim() !== '' ? override.baseUrl : stored.baseUrl).trim();
    const apiKey = (typeof override.apiKey === 'string' && override.apiKey.trim() !== '' ? override.apiKey : stored.apiKey).trim();
    if (baseUrl === '') return c.json({ error: 'Enter a base URL first.' });
    // Most providers require auth for /models — a keyless request just 401s.
    const isLocal = /localhost|127\.0\.0\.1|::1/.test(baseUrl);
    if (apiKey === '' && !isLocal) return c.json({ error: 'Add your API key first, then load models.' });
    try {
      const models = await fetchModelIds(baseUrl, apiKey);
      setModelCache(db, { baseUrl, models, fetchedAt: new Date().toISOString() }); // a manual fetch also refreshes the cache
      return c.json({ models });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not reach the provider.' });
    }
  });

  // --- Copilot: model-backed with a rule-based fallback ---

  app.post('/api/ai/draft', async (c) => {
    let input: { ticketId?: unknown };
    try {
      input = (await c.req.json()) as { ticketId?: unknown };
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.ticketId !== 'string') return c.json({ error: 'ticketId is required' }, 400);
    const ticket = getTicket(db, input.ticketId);
    if (ticket === null) return c.json({ error: 'ticket not found' }, 404);
    const contact = getContact(db, ticket.requesterId);
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(currentAgentId()) as Agent | undefined;
    const canned = getCannedReplies(db);
    const allKb = db.prepare("SELECT * FROM kb_articles WHERE status = 'published'").all() as unknown as KbArticle[];
    const thread = threadOf(ticket.id);
    const contactName = contact?.name ?? 'there';
    const agentName = agent?.name ?? 'there';
    const lastCustomer = [...thread].reverse().find((m) => m.role === 'customer')?.body ?? '';
    // Give the model only the articles relevant to this ticket — it answers from these alone.
    const kb = rankKb(`${ticket.subject} ${lastCustomer}`, allKb, 5);
    const fallback = draftReply({ subject: ticket.subject, contactName, agentName, lastCustomerMessage: lastCustomer, canned });
    const result = await draftReplyAI(
      getAiProviderConfig(db),
      { subject: ticket.subject, contactName, agentName, signature: agent?.signature ?? '', thread, canned, kb },
      fallback,
    );
    recordUsage('draft', result.usage);
    return c.json(result);
  });

  app.post('/api/ai/triage', async (c) => {
    let input: { ticketId?: unknown };
    try {
      input = (await c.req.json()) as { ticketId?: unknown };
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.ticketId !== 'string') return c.json({ error: 'ticketId is required' }, 400);
    const ticket = getTicket(db, input.ticketId);
    if (ticket === null) return c.json({ error: 'ticket not found' }, 404);
    const thread = threadOf(ticket.id);
    const bodyText = thread.filter((m) => m.role === 'customer').map((m) => m.body).join('\n') || ticket.lastMessagePreview;
    const triageCtx = { subject: ticket.subject, bodyText, currentPriority: ticket.priority, currentTags: ticket.tags };
    const fallback = suggestTriage(triageCtx);
    const result = await suggestTriageAI(getAiProviderConfig(db), triageCtx, fallback);
    recordUsage('triage', result.usage);
    return c.json(result);
  });

  app.post('/api/ai/summarize', async (c) => {
    let input: { ticketId?: unknown };
    try {
      input = (await c.req.json()) as { ticketId?: unknown };
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.ticketId !== 'string') return c.json({ error: 'ticketId is required' }, 400);
    const ticket = getTicket(db, input.ticketId);
    if (ticket === null) return c.json({ error: 'ticket not found' }, 404);
    const contact = getContact(db, ticket.requesterId);
    const contactName = contact?.name ?? 'there';
    const fallback = summarizeThread({ contactName, messages: getMessages(db, ticket.id) });
    const result = await summarizeThreadAI(getAiProviderConfig(db), { contactName, thread: threadOf(ticket.id) }, fallback);
    recordUsage('summary', result.usage);
    return c.json(result);
  });

  app.post('/api/ai/translate', async (c) => {
    let input: { text?: unknown; targetLang?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.text !== 'string' || input.text.trim() === '') return c.json({ error: 'text is required' }, 400);
    const targetLang = typeof input.targetLang === 'string' && input.targetLang.trim() !== '' ? input.targetLang.trim() : 'English';
    const result = await translateAI(getAiProviderConfig(db), input.text.slice(0, 8000), targetLang);
    recordUsage('summary', result.usage);
    return c.json(result);
  });

  app.post('/api/ai/actions/:id/approve', (c) => {
    const id = c.req.param('id');
    const action = getAiAction(db, id);
    if (action === null) return c.json({ error: `action not found: ${id}` }, 404);
    if (action.kind !== 'draft' || action.status !== 'pending') return c.json({ error: 'not an approvable draft' }, 400);
    const ticket = getTicket(db, action.ticketId);
    if (ticket === null) return c.json({ error: 'ticket not found' }, 404);
    if (ticket.status === 'closed') return c.json({ error: 'ticket is closed — reopen it to reply' }, 409);
    const now = new Date().toISOString();
    const body = action.draftBody ?? '';
    const message: Message = {
      id: newId('m_'), ticketId: ticket.id, authorKind: 'agent', authorId: currentAgentId(),
      kind: 'reply', body, at: now,
    };
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      const nextStatus = ticket.status === 'open' ? 'pending' : ticket.status;
      const nextFirstResponded = ticket.firstRespondedAt ?? now;
      db.prepare('UPDATE tickets SET status = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?')
        .run(nextStatus, now, now, preview(body), nextFirstResponded, ticket.id);
      db.prepare("UPDATE ai_actions SET status = 'approved', resolvedAt = ? WHERE id = ?").run(now, id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    deliverReply(ticket, body);
    return c.json({ action: getAiAction(db, id), ticket: getTicket(db, ticket.id), message });
  });

  app.post('/api/ai/actions/:id/dismiss', (c) => {
    const id = c.req.param('id');
    if (getAiAction(db, id) === null) return c.json({ error: `action not found: ${id}` }, 404);
    db.prepare("UPDATE ai_actions SET status = 'dismissed', resolvedAt = ? WHERE id = ?").run(new Date().toISOString(), id);
    return c.json({ action: getAiAction(db, id) });
  });

  // --- Customer portal (email + password auth, everything scoped to one contact) ---

  const psecret = () => portalSecret(db, () => randomUUID().replace(/-/g, ''));
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  /** Resolves the signed-in customer from the Bearer token, or null. */
  const contactFromAuth = (header: string | undefined): Contact | null => {
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token === '') return null;
    const id = verifySession(psecret(), token);
    return id === null ? null : getContact(db, id);
  };

  /** Agent display name for portal message attribution (falls back to "Support"). */
  const agentName = (id: string): string => {
    const row = db.prepare('SELECT name FROM agents WHERE id = ?').get(id) as { name: string } | undefined;
    return row?.name ?? 'Support';
  };

  app.post('/api/portal/register', async (c) => {
    let input: { name?: unknown; email?: unknown; password?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { name, email, password } = input;
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'Name is required' }, 400);
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return c.json({ error: 'Enter a valid email' }, 400);
    if (typeof password !== 'string' || password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);

    const now = new Date().toISOString();
    let contact = getContactByEmail(db, email);
    if (contact !== null) {
      if (getPortalAuth(db, contact.id) !== null) return c.json({ error: 'An account with this email already exists — please sign in.' }, 409);
      // Claim an existing agent/inbound-created contact by setting its first password.
    } else {
      contact = {
        id: newId('c_'), name: name.trim(), email: email.trim(), company: null, avatarHue: djb2(email.trim()) % 360,
        location: null, timezone: null, createdAt: now, mrr: null,
      };
      db.prepare('INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(contact.id, contact.name, contact.email, contact.company, contact.avatarHue, contact.location, contact.timezone, contact.createdAt, contact.mrr);
    }
    setPortalAuth(db, contact.id, hashPassword(password));
    return c.json({ token: signSession(psecret(), contact.id), contact });
  });

  app.post('/api/portal/login', async (c) => {
    let input: { email?: unknown; password?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { email, password } = input;
    if (typeof email !== 'string' || typeof password !== 'string') return c.json({ error: 'Email and password are required' }, 400);
    const contact = getContactByEmail(db, email);
    const hash = contact !== null ? getPortalAuth(db, contact.id) : null;
    if (contact === null || hash === null || !verifyPassword(password, hash)) {
      return c.json({ error: 'Wrong email or password' }, 401);
    }
    return c.json({ token: signSession(psecret(), contact.id), contact });
  });

  app.get('/api/portal/me', (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    return contact === null ? c.json({ error: 'not signed in' }, 401) : c.json(contact);
  });

  app.patch('/api/portal/me', async (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    let patch: { name?: unknown; company?: unknown; location?: unknown; timezone?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: (string | null)[] = [];
    if ('name' in patch) {
      if (typeof patch.name !== 'string' || patch.name.trim() === '') return c.json({ error: 'invalid name' }, 400);
      sets.push('name = ?');
      params.push(patch.name.trim());
    }
    for (const field of ['company', 'location', 'timezone'] as const) {
      if (field in patch) {
        const v = patch[field];
        if (v !== null && typeof v !== 'string') return c.json({ error: `invalid ${field}` }, 400);
        sets.push(`${field} = ?`);
        params.push(v === null || (v as string).trim() === '' ? null : (v as string).trim());
      }
    }
    if (sets.length > 0) db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...params, contact.id);
    return c.json(getContact(db, contact.id));
  });

  app.post('/api/portal/password', async (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    let input: { current?: unknown; next?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { current, next } = input;
    if (typeof next !== 'string' || next.length < 8) return c.json({ error: 'New password must be at least 8 characters' }, 400);
    const hash = getPortalAuth(db, contact.id);
    if (hash === null || typeof current !== 'string' || !verifyPassword(current, hash)) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }
    setPortalAuth(db, contact.id, hashPassword(next));
    return c.json({ ok: true });
  });

  app.get('/api/portal/tickets', (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    const rows = db
      .prepare("SELECT * FROM tickets WHERE requesterId = ? AND bucket = 'inbox' ORDER BY lastMessageAt DESC")
      .all(contact.id) as unknown as TicketRow[];
    return c.json(rows.map(rowToTicket));
  });

  app.get('/api/portal/tickets/:id', (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    const ticket = getTicket(db, c.req.param('id'));
    if (ticket === null || ticket.requesterId !== contact.id) return c.json({ error: 'ticket not found' }, 404);
    recordSeen(db, ticket.id, contact.id, 'contact', new Date().toISOString()); // customer viewed the thread
    // Customers see public replies only — never internal notes, and never soft-deleted ones
    // (which would otherwise render as an empty "ghost" bubble).
    const messages = getMessages(db, ticket.id)
      .filter((m) => m.kind === 'reply' && !m.deletedAt)
      .map((m) => ({
        id: m.id,
        authorKind: m.authorKind,
        authorName: m.authorKind === 'contact' ? contact.name : agentName(m.authorId),
        avatarHue: m.authorKind === 'contact' ? contact.avatarHue : getAgent(db, m.authorId)?.avatarHue ?? 0,
        body: m.body,
        at: m.at,
        attachments: m.attachments ?? [],
        embeds: m.embeds ?? [],
      }));
    // Customer-facing "support team": agents who've replied (or are assigned),
    // with when they last viewed the thread — a read receipt for the customer.
    const seenByAgent = new Map(getTicketSeen(db, ticket.id).filter((s) => s.viewerKind === 'agent').map((s) => [s.viewerId, s.at]));
    const agentIds = new Set<string>();
    for (const m of getMessages(db, ticket.id)) if (m.authorKind === 'agent' && m.kind === 'reply') agentIds.add(m.authorId);
    if (ticket.assigneeId !== null) agentIds.add(ticket.assigneeId);
    const support = [...agentIds].map((aid) => {
      const a = getAgent(db, aid);
      return { name: a?.name ?? 'Support', avatarHue: a?.avatarHue ?? 0, seenAt: seenByAgent.get(aid) ?? null };
    });
    return c.json({ ticket, messages, support, expectedFirstReplyAt: expectedFirstReplyAt(ticket, slaTargets(), slaHours() as SlaHours) });
  });

  app.post('/api/portal/tickets', async (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    let input: { subject?: unknown; body?: unknown; priority?: unknown; attachmentIds?: unknown; category?: unknown; tags?: unknown; answers?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { subject, body, priority } = input;
    if (typeof subject !== 'string' || subject.trim() === '') return c.json({ error: 'Subject is required' }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'Message is required' }, 400);
    const attachmentIds = Array.isArray(input.attachmentIds)
      ? input.attachmentIds.filter((x): x is string => typeof x === 'string')
      : [];
    // Intake-form results: the picked category + accumulated tags, plus the full
    // question/answer path (prepended to the opening message so agents see context).
    const category = typeof input.category === 'string' && input.category.trim() !== '' ? input.category.trim() : null;
    const intakeTags = Array.isArray(input.tags) ? input.tags.filter((x): x is string => typeof x === 'string') : [];
    const answers = Array.isArray(input.answers)
      ? input.answers.filter(
          (a): a is { prompt: string; label: string } =>
            typeof a === 'object' && a !== null && typeof (a as { prompt?: unknown }).prompt === 'string' && typeof (a as { label?: unknown }).label === 'string',
        )
      : [];
    const now = new Date().toISOString();
    const maxRow = db.prepare('SELECT COALESCE(MAX(number), 0) AS maxNumber FROM tickets').get() as { maxNumber: number };
    const ticket: Ticket = {
      id: newId('t_'), number: maxRow.maxNumber + 1, subject: subject.trim(), status: 'open',
      priority: PRIORITIES.includes(priority as TicketPriority) ? (priority as TicketPriority) : 'medium',
      bucket: 'inbox', requesterId: contact.id, assigneeId: null, tags: intakeTags, channel: 'web',
      createdAt: now, updatedAt: now, snoozedUntil: null, lastMessageAt: now, lastMessagePreview: preview(body),
      firstRespondedAt: null, resolvedAt: null, channelId: null, mergedIntoId: null, awaitingReply: true, customFields: {}, category,
    };
    // The opening message is just what the customer wrote; the question/answer path
    // is stored as structured ticket metadata (not dumped into the conversation).
    const message: Message = {
      id: newId('m_'), ticketId: ticket.id, authorKind: 'contact', authorId: contact.id, kind: 'reply', body, at: now,
    };
    db.exec('BEGIN');
    try {
      insertTicketRow(db, ticket);
      setTicketIntake(db, ticket.id, answers);
      db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      if (attachmentIds.length > 0) linkAttachments(db, attachmentIds, message.id, ticket.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    await runAgentsOnTicket(ticket, body);
    autoAssign(ticket.id, null, ticket.category);
    sendAutoAck(ticket.id, contact.name);
    sendOutsideHours(ticket.id, contact.name);
    return c.json({ ticket: getTicket(db, ticket.id) });
  });

  app.post('/api/portal/tickets/:id/messages', async (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    const ticket = getTicket(db, c.req.param('id'));
    if (ticket === null || ticket.requesterId !== contact.id) return c.json({ error: 'ticket not found' }, 404);
    let input: { body?: unknown; attachmentIds?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const body = typeof input.body === 'string' ? input.body : '';
    const attachmentIds = Array.isArray(input.attachmentIds)
      ? input.attachmentIds.filter((x): x is string => typeof x === 'string')
      : [];
    if (body.trim() === '' && attachmentIds.length === 0) return c.json({ error: 'a message or attachment is required' }, 400);
    const now = new Date().toISOString();
    const message: Message = {
      id: newId('m_'), ticketId: ticket.id, authorKind: 'contact', authorId: contact.id, kind: 'reply', body, at: now,
    };
    const previewText = body.trim() !== '' ? preview(body) : 'Sent an attachment';
    // A customer reply reopens a solved ticket and clears its resolution stamp.
    const nextStatus = ticket.status === 'solved' || ticket.status === 'closed' ? 'open' : ticket.status;
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      if (attachmentIds.length > 0) linkAttachments(db, attachmentIds, message.id, ticket.id);
      db.prepare('UPDATE tickets SET status = ?, resolvedAt = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ? WHERE id = ?')
        .run(nextStatus, nextStatus === 'open' ? null : ticket.resolvedAt, now, now, previewText, ticket.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    notifyCustomerReply({ ticket, message, contactName: contact.name });
    return c.json({ ticket: getTicket(db, ticket.id) });
  });

  // The customer answers a choice prompt: lock the prompt with their pick and post it as a reply.
  app.post('/api/portal/tickets/:id/messages/:mid/answer', async (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    const ticket = getTicket(db, c.req.param('id'));
    if (ticket === null || ticket.requesterId !== contact.id) return c.json({ error: 'ticket not found' }, 404);
    const mid = c.req.param('mid');
    let input: { embedIndex?: unknown; optionIds?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    // Read the prompt AFTER awaiting the body, and don't await again before the write, so the
    // read → already-answered check → write runs atomically — two tabs can't both record an answer.
    const msg = getMessage(db, mid);
    if (msg === null || msg.ticketId !== ticket.id || msg.authorKind !== 'agent' || msg.kind !== 'reply' || msg.deletedAt) {
      return c.json({ error: 'prompt not found' }, 404);
    }
    const embeds = msg.embeds ?? [];
    const embedIndex = typeof input.embedIndex === 'number' ? input.embedIndex : embeds.findIndex((e) => e.type === 'choice_prompt');
    const prompt = embeds[embedIndex];
    if (prompt === undefined || prompt.type !== 'choice_prompt') return c.json({ error: 'no such choice prompt' }, 404);
    if (prompt.answer) return c.json({ error: 'this question was already answered' }, 409);
    const optionIds = Array.isArray(input.optionIds) ? input.optionIds.filter((x): x is string => typeof x === 'string') : [];
    // Single-select: keep the first valid pick.
    const chosen = optionIds.filter((oid) => prompt.options.some((o) => o.id === oid)).slice(0, 1);
    if (chosen.length === 0) return c.json({ error: 'pick a valid option' }, 400);

    const now = new Date().toISOString();
    const nextEmbeds = embeds.map((e, i) =>
      i === embedIndex && e.type === 'choice_prompt' ? { ...e, answer: { optionIds: chosen, at: now } } : e,
    );
    const replyBody = chosen.map((oid) => prompt.options.find((o) => o.id === oid)?.label ?? '').filter((s) => s !== '').join(', ');
    const reply: Message = { id: newId('m_'), ticketId: ticket.id, authorKind: 'contact', authorId: contact.id, kind: 'reply', body: replyBody, at: now };
    const nextStatus = ticket.status === 'solved' || ticket.status === 'closed' ? 'open' : ticket.status;

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE messages SET embeds = ? WHERE id = ?').run(JSON.stringify(nextEmbeds), mid);
      db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(reply.id, reply.ticketId, reply.authorKind, reply.authorId, reply.kind, reply.body, reply.at);
      db.prepare('UPDATE tickets SET status = ?, resolvedAt = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ? WHERE id = ?')
        .run(nextStatus, nextStatus === 'open' ? null : ticket.resolvedAt, now, now, preview(replyBody), ticket.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    notifyCustomerReply({ ticket, message: reply, contactName: contact.name });
    return c.json({ ok: true });
  });

  // A customer rates their support once the ticket is solved or closed (CSAT).
  app.post('/api/portal/tickets/:id/rating', async (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    const ticket = getTicket(db, c.req.param('id'));
    if (ticket === null || ticket.requesterId !== contact.id) return c.json({ error: 'ticket not found' }, 404);
    if (ticket.status !== 'solved' && ticket.status !== 'closed') {
      return c.json({ error: 'You can rate your support once the ticket is solved.' }, 409);
    }
    let input: { score?: unknown; comment?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { score } = input;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
      return c.json({ error: 'Score must be a whole number from 1 to 5' }, 400);
    }
    const comment = typeof input.comment === 'string' && input.comment.trim() !== '' ? input.comment.trim().slice(0, 1000) : null;
    db.prepare('UPDATE tickets SET satisfactionScore = ?, satisfactionComment = ?, satisfactionAt = ? WHERE id = ?')
      .run(score, comment, new Date().toISOString(), ticket.id);
    return c.json({ ticket: getTicket(db, ticket.id) });
  });

  app.get('/api/portal/kb', (c) => {
    const rows = db.prepare("SELECT * FROM kb_articles WHERE status = 'published' ORDER BY category, title").all() as unknown as KbArticle[];
    // With `?q=…`, return only the most relevant articles (empty = nothing matched),
    // used to deflect a ticket at the end of the intake form.
    const q = c.req.query('q');
    return c.json(q !== undefined && q.trim() !== '' ? rankKb(q, rows, 4) : rows);
  });

  app.post('/api/channels', async (c) => {
    let input: { type?: unknown; name?: unknown; address?: unknown; outboundUrl?: unknown; outboundSecret?: unknown; inboundSecret?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { type, name, address } = input;
    if (typeof type !== 'string' || !CHANNEL_TYPES.includes(type as ChannelType)) return c.json({ error: 'invalid channel type' }, 400);
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'name is required' }, 400);
    const cleanStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    const channel: ChannelConn = {
      id: newId('ch_'), type: type as ChannelType, name: name.trim(), enabled: true,
      inboundToken: `tok_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      address: cleanStr(address),
      createdAt: new Date().toISOString(),
      outboundUrl: cleanStr(input.outboundUrl),
      outboundSecret: cleanStr(input.outboundSecret),
      inboundSecret: cleanStr(input.inboundSecret),
    };
    db.prepare('INSERT INTO channels (id, type, name, enabled, inboundToken, address, createdAt, outboundUrl, outboundSecret, inboundSecret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(channel.id, channel.type, channel.name, 1, channel.inboundToken, channel.address, channel.createdAt, channel.outboundUrl, channel.outboundSecret, channel.inboundSecret);
    return c.json(toPublicChannel(channel));
  });

  app.patch('/api/channels/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getChannel(db, id);
    if (existing === null) return c.json({ error: `channel not found: ${id}` }, 404);
    let patch: { name?: unknown; enabled?: unknown; address?: unknown; outboundUrl?: unknown; outboundSecret?: unknown; inboundSecret?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const cleanStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    if ('name' in patch) {
      if (typeof patch.name !== 'string' || patch.name.trim() === '') return c.json({ error: 'invalid name' }, 400);
      sets.push('name = ?');
      params.push(patch.name.trim());
    }
    if ('enabled' in patch) {
      if (typeof patch.enabled !== 'boolean') return c.json({ error: 'invalid enabled' }, 400);
      sets.push('enabled = ?');
      params.push(patch.enabled ? 1 : 0);
    }
    if ('address' in patch) {
      sets.push('address = ?');
      params.push(cleanStr(patch.address));
    }
    if ('outboundUrl' in patch) {
      sets.push('outboundUrl = ?');
      params.push(cleanStr(patch.outboundUrl));
    }
    // Write-only: only touch a secret when its key is present (blank clears it).
    if ('outboundSecret' in patch) {
      sets.push('outboundSecret = ?');
      params.push(cleanStr(patch.outboundSecret));
    }
    if ('inboundSecret' in patch) {
      sets.push('inboundSecret = ?');
      params.push(cleanStr(patch.inboundSecret));
    }
    if (sets.length === 0) return c.json(toPublicChannel(existing));
    db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    const updated = getChannel(db, id);
    return c.json(toPublicChannel(updated ?? existing));
  });

  app.delete('/api/channels/:id', (c) => {
    const id = c.req.param('id');
    if (getChannel(db, id) === null) return c.json({ error: `channel not found: ${id}` }, 404);
    db.prepare('DELETE FROM channels WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  // Send a canned test message to the channel's outbound endpoint, so an admin
  // can confirm Discord/Slack/relay delivery works before a customer relies on it.
  app.post('/api/channels/:id/test', async (c) => {
    const id = c.req.param('id');
    const channel = getChannel(db, id);
    if (channel === null) return c.json({ error: `channel not found: ${id}` }, 404);
    if ((channel.outboundUrl?.trim() ?? '') === '') return c.json({ ok: false, error: 'Add an outbound URL first, then test.' });
    const fromName = getSmtpConfig(db).fromName.trim() || 'Support';
    const result = await sendToChannel(channel, {
      ticketNumber: 0,
      subject: 'BaseDesk test',
      body: 'This is a test from BaseDesk. If you can read this, outbound delivery to this channel is working.',
      toName: null,
      fromName,
    });
    return c.json(result);
  });

  // Verify a channel's inbound token (query) and, if set, an HMAC signature over
  // the raw body. Returns an error Response to short-circuit, or null when valid.
  const checkInbound = (c: Context, channel: ChannelConn, raw: string): Response | null => {
    if (!channel.enabled) return c.json({ error: 'channel disabled' }, 403);
    if (c.req.query('token') !== channel.inboundToken) return c.json({ error: 'invalid token' }, 401);
    const secret = channel.inboundSecret?.trim();
    if (secret) {
      const sig =
        c.req.header('x-basedesk-signature') ?? c.req.header('x-hub-signature-256') ?? c.req.header('x-signature-256');
      if (!verifyHmac(secret, raw, sig)) return c.json({ error: 'invalid signature' }, 401);
    }
    return null;
  };

  const insertMessageRow = (m: Message): void => {
    db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, m.ticketId, m.authorKind, m.authorId, m.kind, m.body, m.at);
  };

  // Public inbound: a forwarder / bot / widget POSTs a customer message here. A
  // sender (by email or externalId) threads into their one open ticket on this
  // channel — a running conversation, not a new ticket per message.
  app.post('/api/channels/:id/inbound', async (c) => {
    const id = c.req.param('id');
    const channel = getChannel(db, id);
    if (channel === null) return c.json({ error: 'channel not found' }, 404);
    const raw = await c.req.text();
    const bad = checkInbound(c, channel, raw);
    if (bad !== null) return bad;

    let input: { from?: { name?: unknown; email?: unknown; externalId?: unknown }; subject?: unknown; body?: unknown; attachmentIds?: unknown };
    try {
      input = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const attachmentIds = Array.isArray(input.attachmentIds)
      ? input.attachmentIds.filter((x): x is string => typeof x === 'string')
      : [];
    const body = typeof input.body === 'string' ? input.body : '';
    if (body.trim() === '' && attachmentIds.length === 0) return c.json({ error: 'body or an attachment is required' }, 400);
    const previewText = body.trim() !== '' ? preview(body) : 'Sent an attachment';
    const email = typeof input.from?.email === 'string' ? input.from.email.trim() : '';
    const externalId = typeof input.from?.externalId === 'string' ? input.from.externalId.trim() : '';
    if (email === '' && externalId === '') return c.json({ error: 'from.email or from.externalId is required' }, 400);

    // A stable identity so the same sender maps to one contact + threads together.
    const identity = email !== '' ? email : `ext_${channel.type}_${externalId}@basedesk.local`;
    const displayName =
      typeof input.from?.name === 'string' && input.from.name.trim() !== ''
        ? input.from.name.trim()
        : email !== '' ? email : `${channel.name} user`;
    const now = new Date().toISOString();

    let contact = db.prepare('SELECT * FROM contacts WHERE email = ?').get(identity) as Contact | undefined;
    if (contact === undefined) {
      contact = {
        id: newId('c_'), name: displayName, email: identity, company: null, avatarHue: djb2(identity) % 360,
        location: null, timezone: null, createdAt: now, mrr: null,
      };
      db.prepare('INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(contact.id, contact.name, contact.email, contact.company, contact.avatarHue, contact.location, contact.timezone, contact.createdAt, contact.mrr);
    }

    // Thread into this sender's most recent still-open ticket on this channel.
    const openRow = db
      .prepare(
        "SELECT * FROM tickets WHERE channelId = ? AND requesterId = ? AND bucket = 'inbox' AND status NOT IN ('solved', 'closed') ORDER BY lastMessageAt DESC LIMIT 1",
      )
      .get(channel.id, contact.id) as TicketRow | undefined;

    if (openRow !== undefined) {
      const existing = rowToTicket(openRow);
      const message: Message = { id: newId('m_'), ticketId: existing.id, authorKind: 'contact', authorId: contact.id, kind: 'reply', body, at: now };
      db.exec('BEGIN');
      try {
        insertMessageRow(message);
        if (attachmentIds.length > 0) linkAttachments(db, attachmentIds, message.id, existing.id);
        db.prepare('UPDATE tickets SET updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ? WHERE id = ?')
          .run(now, now, previewText, existing.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      notifyCustomerReply({ ticket: existing, message, contactName: contact.name });
      return c.json({ ticketId: existing.id, ticketNumber: existing.number, threaded: true });
    }

    const maxRow = db.prepare('SELECT COALESCE(MAX(number), 0) AS maxNumber FROM tickets').get() as { maxNumber: number };
    const subject = typeof input.subject === 'string' && input.subject.trim() !== '' ? input.subject.trim() : preview(body);
    const ticket: Ticket = {
      id: newId('t_'), number: maxRow.maxNumber + 1, subject, status: 'open', priority: 'medium', bucket: 'inbox',
      requesterId: contact.id, assigneeId: null, tags: [], channel: CHANNEL_TO_TICKET[channel.type],
      createdAt: now, updatedAt: now, snoozedUntil: null, lastMessageAt: now, lastMessagePreview: previewText,
      firstRespondedAt: null, resolvedAt: null, channelId: channel.id, mergedIntoId: null, awaitingReply: true, customFields: {}, category: null,
    };
    const message: Message = { id: newId('m_'), ticketId: ticket.id, authorKind: 'contact', authorId: contact.id, kind: 'reply', body, at: now };
    db.exec('BEGIN');
    try {
      insertTicketRow(db, ticket);
      insertMessageRow(message);
      if (attachmentIds.length > 0) linkAttachments(db, attachmentIds, message.id, ticket.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    await runAgentsOnTicket(ticket, body);
    autoAssign(ticket.id, null, ticket.category);
    sendAutoAck(ticket.id, getContact(db, ticket.requesterId)?.name ?? '');
    sendOutsideHours(ticket.id, getContact(db, ticket.requesterId)?.name ?? '');
    return c.json({ ticketId: ticket.id, ticketNumber: ticket.number, threaded: false });
  });

  // Manage a ticket from the channel side (e.g. a Discord slash command relayed
  // by a bot): reply, solve/close, reopen, or read status. Same token + optional
  // signature auth as inbound. A reply is delivered back out to the channel too.
  app.post('/api/channels/:id/command', async (c) => {
    const id = c.req.param('id');
    const channel = getChannel(db, id);
    if (channel === null) return c.json({ error: 'channel not found' }, 404);
    const raw = await c.req.text();
    const bad = checkInbound(c, channel, raw);
    if (bad !== null) return bad;

    let input: { action?: unknown; ticket?: unknown; text?: unknown };
    try {
      input = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const action = input.action;
    if (typeof action !== 'string') return c.json({ error: 'action is required' }, 400);

    // Resolve the ticket by number or id — and only if it belongs to this channel.
    let ticket: Ticket | null = null;
    if (typeof input.ticket === 'number') {
      const row = db.prepare('SELECT * FROM tickets WHERE number = ? AND channelId = ?').get(input.ticket, channel.id) as TicketRow | undefined;
      ticket = row ? rowToTicket(row) : null;
    } else if (typeof input.ticket === 'string') {
      const t = getTicket(db, input.ticket);
      ticket = t !== null && t.channelId === channel.id ? t : null;
    }
    if (ticket === null) return c.json({ error: 'ticket not found on this channel' }, 404);

    const now = new Date().toISOString();
    if (action === 'reply') {
      const text = input.text;
      if (typeof text !== 'string' || text.trim() === '') return c.json({ error: 'text is required for a reply' }, 400);
      if (ticket.status === 'closed') return c.json({ error: 'ticket is closed — reopen it first' }, 409);
      const message: Message = { id: newId('m_'), ticketId: ticket.id, authorKind: 'agent', authorId: currentAgentId(), kind: 'reply', body: text, at: now };
      const nextStatus = ticket.status === 'open' ? 'pending' : ticket.status;
      db.exec('BEGIN');
      try {
        insertMessageRow(message);
        db.prepare('UPDATE tickets SET status = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?')
          .run(nextStatus, now, now, preview(text), ticket.firstRespondedAt ?? now, ticket.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      deliverReply(ticket, text);
    } else if (action === 'solve' || action === 'close') {
      const status = action === 'close' ? 'closed' : 'solved';
      db.prepare('UPDATE tickets SET status = ?, resolvedAt = ?, updatedAt = ? WHERE id = ?').run(status, ticket.resolvedAt ?? now, now, ticket.id);
    } else if (action === 'reopen') {
      db.prepare('UPDATE tickets SET status = ?, resolvedAt = ?, updatedAt = ? WHERE id = ?').run('open', null, now, ticket.id);
    } else if (action !== 'status') {
      return c.json({ error: `unknown action: ${action}` }, 400);
    }

    const updated = getTicket(db, ticket.id) ?? ticket;
    return c.json({ ok: true, ticket: { id: updated.id, number: updated.number, subject: updated.subject, status: updated.status, assigneeId: updated.assigneeId } });
  });

  // ── Custom fields ────────────────────────────────────────────────────────
  const CUSTOM_FIELD_TYPES: CustomFieldType[] = ['text', 'textarea', 'number', 'select', 'checkbox', 'date'];
  const CUSTOM_FIELD_ENTITIES: CustomFieldEntity[] = ['ticket', 'contact'];
  const cleanOptions = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((o): o is string => typeof o === 'string' && o.trim() !== '').map((o) => o.trim()) : [];

  app.post('/api/custom-fields', async (c) => {
    let input: { entity?: unknown; label?: unknown; type?: unknown; options?: unknown; required?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { entity, label, type } = input;
    if (typeof entity !== 'string' || !CUSTOM_FIELD_ENTITIES.includes(entity as CustomFieldEntity)) return c.json({ error: 'invalid entity' }, 400);
    if (typeof label !== 'string' || label.trim() === '') return c.json({ error: 'label is required' }, 400);
    if (typeof type !== 'string' || !CUSTOM_FIELD_TYPES.includes(type as CustomFieldType)) return c.json({ error: 'invalid type' }, 400);
    const options = cleanOptions(input.options);
    if (type === 'select' && options.length === 0) return c.json({ error: 'a select field needs at least one option' }, 400);
    const position = getCustomFields(db).filter((f) => f.entity === entity).length;
    const field: CustomFieldDef = {
      id: newId('cf_'), entity: entity as CustomFieldEntity, label: label.trim(), type: type as CustomFieldType,
      options, required: input.required === true, position, createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO custom_fields (id, entity, label, type, options, required, position, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(field.id, field.entity, field.label, field.type, JSON.stringify(field.options), field.required ? 1 : 0, field.position, field.createdAt);
    return c.json(field);
  });

  app.patch('/api/custom-fields/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getCustomField(db, id);
    if (existing === null) return c.json({ error: `custom field not found: ${id}` }, 404);
    let patch: { label?: unknown; type?: unknown; options?: unknown; required?: unknown; position?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if ('label' in patch) {
      if (typeof patch.label !== 'string' || patch.label.trim() === '') return c.json({ error: 'invalid label' }, 400);
      sets.push('label = ?');
      params.push(patch.label.trim());
    }
    if ('type' in patch) {
      if (typeof patch.type !== 'string' || !CUSTOM_FIELD_TYPES.includes(patch.type as CustomFieldType)) return c.json({ error: 'invalid type' }, 400);
      sets.push('type = ?');
      params.push(patch.type);
    }
    if ('options' in patch) {
      sets.push('options = ?');
      params.push(JSON.stringify(cleanOptions(patch.options)));
    }
    if ('required' in patch) {
      sets.push('required = ?');
      params.push(patch.required === true ? 1 : 0);
    }
    if ('position' in patch && typeof patch.position === 'number' && Number.isFinite(patch.position)) {
      sets.push('position = ?');
      params.push(patch.position);
    }
    if (sets.length === 0) return c.json(existing);
    db.prepare(`UPDATE custom_fields SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(getCustomField(db, id));
  });

  app.delete('/api/custom-fields/:id', (c) => {
    const id = c.req.param('id');
    if (getCustomField(db, id) === null) return c.json({ error: `custom field not found: ${id}` }, 404);
    db.prepare('DELETE FROM custom_fields WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  // ── Saved views ───────────────────────────────────────────────────────────
  app.post('/api/saved-views', async (c) => {
    let input: { name?: unknown; view?: unknown; priority?: unknown; assigneeId?: unknown; tag?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.name !== 'string' || input.name.trim() === '') return c.json({ error: 'name is required' }, 400);
    if (typeof input.view !== 'string' || input.view.trim() === '') return c.json({ error: 'view is required' }, 400);
    const view: SavedView = {
      id: newId('sv_'),
      name: input.name.trim().slice(0, 60),
      view: input.view as ViewId,
      priority: PRIORITIES.includes(input.priority as TicketPriority) ? (input.priority as TicketPriority) : null,
      assigneeId: typeof input.assigneeId === 'string' && input.assigneeId.trim() !== '' ? input.assigneeId.trim() : null,
      tag: typeof input.tag === 'string' && input.tag.trim() !== '' ? input.tag.trim() : null,
    };
    setSavedViews(db, [...getSavedViews(db), view]);
    return c.json(view);
  });

  app.delete('/api/saved-views/:id', (c) => {
    const id = c.req.param('id');
    const views = getSavedViews(db);
    if (!views.some((v) => v.id === id)) return c.json({ error: `saved view not found: ${id}` }, 404);
    setSavedViews(db, views.filter((v) => v.id !== id));
    return c.json({ ok: true });
  });

  // Public thread read for the web widget: latest ticket for this contact on this channel.
  app.get('/api/channels/:id/thread', (c) => {
    const id = c.req.param('id');
    const channel = getChannel(db, id);
    if (channel === null) return c.json({ error: 'channel not found' }, 404);
    if (c.req.query('token') !== channel.inboundToken) return c.json({ error: 'invalid token' }, 401);
    const email = c.req.query('contact');
    if (email === undefined || email === '') return c.json([]);
    const contact = db.prepare('SELECT * FROM contacts WHERE email = ?').get(email) as Contact | undefined;
    if (contact === undefined) return c.json([]);
    const ticket = db
      .prepare('SELECT * FROM tickets WHERE channelId = ? AND requesterId = ? ORDER BY createdAt DESC LIMIT 1')
      .get(channel.id, contact.id) as TicketRow | undefined;
    if (ticket === undefined) return c.json([]);
    // Customers see public replies only — never internal notes — and get a
    // trimmed shape (no authorId) plus each reply's attachments.
    const messages = getMessages(db, ticket.id)
      .filter((m) => m.kind === 'reply' && !m.deletedAt)
      .map((m) => ({ id: m.id, authorKind: m.authorKind, body: m.body, at: m.at, attachments: m.attachments ?? [] }));
    return c.json(messages);
  });

  app.get('/api/stats', (c) => c.json(computeStats(db, new Date())));

  app.get('/api/search', (c) => {
    const q = c.req.query('q');
    if (q === undefined || q.trim() === '') return c.json({ ticketIds: [] });
    const like = `%${q.trim()}%`;
    const rows = db
      .prepare(
        `SELECT DISTINCT t.id, t.lastMessageAt FROM tickets t
         LEFT JOIN messages m ON m.ticketId = t.id
         LEFT JOIN contacts c ON c.id = t.requesterId
         WHERE t.subject LIKE ? OR m.body LIKE ? OR c.name LIKE ? OR c.email LIKE ?
         ORDER BY t.lastMessageAt DESC
         LIMIT 30`,
      )
      .all(like, like, like, like) as { id: string }[];
    return c.json({ ticketIds: rows.map((r) => r.id) });
  });

  // Evaluate time-based rules on a background interval. Unref'd so it never keeps
  // the process (or a test harness) alive; wrapped so a bad rule can't crash it.
  const timeRuleTimer = setInterval(() => {
    try {
      evaluateTimeRules(Date.now());
    } catch (err) {
      console.error('[time-rules]', err instanceof Error ? err.message : err);
    }
  }, 5 * 60_000);
  if (typeof timeRuleTimer.unref === 'function') timeRuleTimer.unref();

  return { app, db, flushScheduled };
}
