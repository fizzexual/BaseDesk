import type { AutomationRule, SlaTargets } from './types';

// Mirror of server/src/defaults.ts — used by the local demo repository so
// demo mode and the real server agree on defaults.
export const DEFAULT_SLA_TARGETS: SlaTargets = {
  urgent: { firstResponseMins: 30, resolutionMins: 240 },
  high: { firstResponseMins: 60, resolutionMins: 480 },
  medium: { firstResponseMins: 240, resolutionMins: 1440 },
  low: { firstResponseMins: 480, resolutionMins: 2880 },
};

export const DEFAULT_AUTOMATION: AutomationRule[] = [
  {
    id: 'auto_outage',
    name: 'Escalate outages',
    enabled: true,
    condition: { type: 'subject_contains', value: 'down' },
    action: { type: 'set_priority', value: 'urgent' },
  },
  {
    id: 'auto_refund',
    name: 'Tag refund requests',
    enabled: true,
    condition: { type: 'body_contains', value: 'refund' },
    action: { type: 'add_tag', value: 'refund' },
  },
];
