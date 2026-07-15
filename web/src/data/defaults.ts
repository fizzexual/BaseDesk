import type { AiAutomation, AiProvider, AutoAck, AutomationRule, OnCallConfig, SlaHours, SlaTargets, SmtpSettings, TicketTemplate, TimeRule } from './types';

/** Starter ticket templates so the New Ticket dialog is useful out of the box (mirrors the server). */
export const DEFAULT_TICKET_TEMPLATES: TicketTemplate[] = [
  {
    id: 'tpl_bug',
    name: 'Bug report',
    subject: '',
    body: 'Steps to reproduce:\n1. \n2. \n\nExpected result:\n\nActual result:\n\nEnvironment (browser / OS / app version):',
    priority: 'high',
    category: null,
    tags: ['bug'],
  },
  {
    id: 'tpl_refund',
    name: 'Refund request',
    subject: 'Refund request',
    body: 'Order number:\nReason for the refund:\nAmount:\n\nAnything else we should know:',
    priority: 'medium',
    category: null,
    tags: ['refund', 'billing'],
  },
  {
    id: 'tpl_feature',
    name: 'Feature request',
    subject: '',
    body: 'What the customer is asking for:\n\nWhy it matters / their use case:\n\nWorkaround they use today:',
    priority: 'low',
    category: null,
    tags: ['feature-request'],
  },
];

/** Client-facing default SMTP settings: no email configured. */
export const DEFAULT_SMTP: SmtpSettings = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,
  user: '',
  fromName: 'Support',
  fromEmail: '',
  publicUrl: 'http://localhost:4011',
  hasPass: false,
};

/** Client-facing default provider status: no model configured, DeepSeek prefilled. */
export const DEFAULT_AI_PROVIDER: AiProvider = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  temperature: 0.4,
  reasoning: false,
  kbOnly: true,
  hasKey: false,
  keyHint: null,
};

// Mirror of server/src/defaults.ts — used by the local demo repository so
// demo mode and the real server agree on defaults.
export const DEFAULT_SLA_TARGETS: SlaTargets = {
  urgent: { firstResponseMins: 30, resolutionMins: 240 },
  high: { firstResponseMins: 60, resolutionMins: 480 },
  medium: { firstResponseMins: 240, resolutionMins: 1440 },
  low: { firstResponseMins: 480, resolutionMins: 2880 },
};

export const DEFAULT_SLA_HOURS: SlaHours = {
  enabled: false,
  timezone: 'UTC',
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '17:00',
};

/** AI does nothing on its own out of the box — every switch is opt-in. */
export const DEFAULT_AI_AUTOMATION: AiAutomation = { autoSuggest: false, autoResolve: false, autoTriage: false };

export const DEFAULT_AUTO_ACK: AutoAck = {
  enabled: false,
  message:
    "Thanks for reaching out! We've received your request (ticket #{{number}}) and a member of our team will get back to you shortly.",
};

/** On-call rotation, disabled by default (mirrors the server). */
export const DEFAULT_ON_CALL: OnCallConfig = {
  enabled: false,
  cadence: 'weekly',
  startDate: '2024-01-01T00:00:00.000Z',
  rotation: [],
};

export const DEFAULT_TIME_RULES: TimeRule[] = [
  {
    id: 'time_escalate', name: 'Escalate slow first response', enabled: false,
    trigger: 'awaiting_first_response', hours: 4,
    actions: [{ type: 'set_priority', value: 'high' }, { type: 'add_tag', value: 'escalated' }],
  },
  {
    id: 'time_autoclose', name: 'Auto-solve tickets waiting on the customer', enabled: false,
    trigger: 'awaiting_customer', hours: 72,
    actions: [{ type: 'set_status', value: 'solved' }, { type: 'add_tag', value: 'auto-solved' }],
  },
];

export const DEFAULT_AUTOMATION: AutomationRule[] = [
  {
    id: 'auto_outage', name: 'Escalate outages', enabled: true, match: 'all',
    conditions: [{ type: 'subject_contains', value: 'down' }],
    actions: [{ type: 'set_priority', value: 'urgent' }],
    runOn: 'create',
  },
  {
    id: 'auto_refund', name: 'Tag refund requests', enabled: true, match: 'any',
    conditions: [{ type: 'body_contains', value: 'refund' }],
    actions: [{ type: 'add_tag', value: 'refund' }],
    runOn: 'create',
  },
];

/** Upgrades v0.3 single-condition rules to the v0.4 multi-condition shape on read. */
export function normalizeAutomation(raw: unknown): AutomationRule[] {
  if (!Array.isArray(raw)) return DEFAULT_AUTOMATION;
  return raw.map((r): AutomationRule => {
    const rule = r as Record<string, unknown>;
    if (Array.isArray(rule.conditions) && Array.isArray(rule.actions)) {
      return {
        id: String(rule.id), name: String(rule.name), enabled: Boolean(rule.enabled),
        match: rule.match === 'any' ? 'any' : 'all',
        conditions: rule.conditions as AutomationRule['conditions'],
        actions: rule.actions as AutomationRule['actions'],
        runOn: rule.runOn === 'create_update' ? 'create_update' : 'create',
      };
    }
    return {
      id: String(rule.id), name: String(rule.name), enabled: Boolean(rule.enabled),
      match: 'all',
      conditions: rule.condition ? [rule.condition as AutomationRule['conditions'][number]] : [],
      actions: rule.action ? [rule.action as AutomationRule['actions'][number]] : [],
      runOn: 'create',
    };
  });
}
