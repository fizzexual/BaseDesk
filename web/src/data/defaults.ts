import type { AiProvider, AutomationRule, SlaHours, SlaTargets } from './types';

/** Client-facing default provider status: no model configured, DeepSeek prefilled. */
export const DEFAULT_AI_PROVIDER: AiProvider = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  temperature: 0.4,
  hasKey: false,
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
