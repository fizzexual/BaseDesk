import type { AiProviderConfig, AutoAck, AutomationRule, IntakeForm, SlaHours, SlaTargets, SmtpConfig } from './types.js';

/**
 * A ready-to-use branching intake form. Admins can edit or disable it; it ships
 * enabled with a small gaming-community tree so the flow is visible out of the box:
 * "What do you need help with?" → Bug/Abuse ask which server; Technical branches again.
 */
export const DEFAULT_INTAKE_FORM: IntakeForm = {
  enabled: true,
  rootId: 'n_type',
  nodes: {
    n_type: {
      id: 'n_type',
      prompt: 'What do you need help with?',
      options: [
        { id: 'o_tech', label: 'Technical issue', next: 'n_tech', category: 'Technical', tags: [] },
        { id: 'o_bug', label: 'Report a bug', next: 'n_server', category: 'Bug', tags: [] },
        { id: 'o_abuse', label: 'Report a player', next: 'n_server', category: 'Abuse', tags: [] },
        { id: 'o_billing', label: 'Billing & purchases', next: null, category: 'Billing', tags: [] },
      ],
    },
    n_tech: {
      id: 'n_tech',
      prompt: 'What kind of technical issue?',
      options: [
        { id: 'o_login', label: "Can't log in", next: null, category: null, tags: ['login'] },
        { id: 'o_lag', label: 'Lag or disconnects', next: 'n_server', category: null, tags: ['performance'] },
        { id: 'o_other', label: 'Something else', next: null, category: null, tags: [] },
      ],
    },
    n_server: {
      id: 'n_server',
      prompt: 'Which server is it on?',
      options: [
        { id: 'o_sky', label: 'Skyblock', next: null, category: null, tags: ['skyblock'] },
        { id: 'o_surv', label: 'Survival', next: null, category: null, tags: ['survival'] },
        { id: 'o_creative', label: 'Creative', next: null, category: null, tags: ['creative'] },
      ],
    },
  },
};

/** No email configured by default — notifications are off until SMTP is set up. */
export const DEFAULT_SMTP: SmtpConfig = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,
  user: '',
  pass: '',
  fromName: 'Support',
  fromEmail: '',
  publicUrl: 'http://localhost:4011',
};

/** No model provider configured by default — the copilot runs rule-based and
 *  offline until a key is added. Base URL/model prefill for DeepSeek. */
export const DEFAULT_AI_PROVIDER: AiProviderConfig = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  temperature: 0.4,
  reasoning: false,
  kbOnly: true,
  apiKey: '',
};

/** Default SLA targets (minutes) by priority. Editable in Settings → SLA. */
export const DEFAULT_SLA_TARGETS: SlaTargets = {
  urgent: { firstResponseMins: 30, resolutionMins: 240 },
  high: { firstResponseMins: 60, resolutionMins: 480 },
  medium: { firstResponseMins: 240, resolutionMins: 1440 },
  low: { firstResponseMins: 480, resolutionMins: 2880 },
};

/** Business-hours SLA is off by default (SLA clocks run wall-clock). */
export const DEFAULT_SLA_HOURS: SlaHours = {
  enabled: false,
  timezone: 'UTC',
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '17:00',
};

/** Auto-acknowledgement is off by default; agents opt in and tune the wording. */
export const DEFAULT_AUTO_ACK: AutoAck = {
  enabled: false,
  message:
    "Thanks for reaching out! We've received your request (ticket #{{number}}) and a member of our team will get back to you shortly.",
};

/** Sample automation rules so the feature demos immediately; users edit or remove them. */
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

/**
 * Upgrades v0.3 single-condition rules `{condition, action}` to the v0.4
 * multi-condition shape on read, so stored settings migrate transparently.
 */
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
    // v0.3 shape
    return {
      id: String(rule.id), name: String(rule.name), enabled: Boolean(rule.enabled),
      match: 'all',
      conditions: rule.condition ? [rule.condition as AutomationRule['conditions'][number]] : [],
      actions: rule.action ? [rule.action as AutomationRule['actions'][number]] : [],
      runOn: 'create',
    };
  });
}
