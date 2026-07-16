// Ticket sub-categories, derived from the subject line so the knowledge graph
// has a real hierarchy (category → sub-category → ticket) without a schema
// change. Rules are ordered; the first match wins, otherwise "Other".

export interface SubRule {
  name: string;
  match: RegExp;
}

export const TAXONOMY: Record<string, SubRule[]> = {
  Billing: [
    { name: 'Refunds', match: /refund|money back|reimburse/i },
    { name: 'Double charges', match: /double charg|charged twice|duplicate charge|charged again/i },
    { name: 'Invoices & receipts', match: /invoice|receipt|vat|tax/i },
    { name: 'Subscriptions & plans', match: /subscription|plan|renew|seat|upgrade|downgrade/i },
    { name: 'Payment methods', match: /card|payment|declined|pay(ing|ment)?|coupon|discount/i },
  ],
  Shipping: [
    { name: 'Delivery delays', match: /delay|late|window passed|not arrived|hasn.?t arrived|where is|still waiting|stuck/i },
    { name: 'Damaged items', match: /damage|broken|crack|dented|defect/i },
    { name: 'Wrong item', match: /wrong|incorrect|mismatch|not what/i },
    { name: 'Tracking', match: /track|tracking|status of (my )?order/i },
    { name: 'Returns & exchanges', match: /return|exchange|send back/i },
  ],
  API: [
    { name: 'Authentication', match: /auth|token|api key|401|unauthorized|credential/i },
    { name: 'Rate limits', match: /rate limit|429|throttl|too many request/i },
    { name: 'Webhooks', match: /webhook|callback|event/i },
    { name: 'Errors & failures', match: /error|500|fail|exception|timeout|broke/i },
    { name: 'Documentation', match: /doc|documentation|example|how do i|endpoint/i },
  ],
  Account: [
    { name: 'Login & password', match: /login|log ?in|sign ?in|password|2fa|reset|can.?t access|locked out/i },
    { name: 'Roles & permissions', match: /role|permission|access|admin|invite|member/i },
    { name: 'Profile & settings', match: /profile|change email|email change|settings|preference|notification/i },
    { name: 'Account deletion', match: /delete account|close account|cancel account|gdpr|remove my/i },
  ],
  Bug: [
    { name: 'UI & display', match: /ui|display|render|layout|css|button|screen|dark mode|mobile/i },
    { name: 'Crashes & errors', match: /crash|error|500|not working|down|broke|blank/i },
    { name: 'Data & sync', match: /data|sync|missing|lost|duplicate|export|import/i },
    { name: 'Performance', match: /slow|timeout|lag|freeze|performance|hang/i },
  ],
  Uncategorized: [
    { name: 'Feature requests', match: /feature|request|plans for|would love|suggestion|add (a|support|an)|wish/i },
    { name: 'Sales & upgrades', match: /interested in|upgrad|pricing|quote|seats|team plan|enterprise|demo/i },
    { name: 'Getting started', match: /getting started|set ?up|onboard|new to|first time|how do i|how to/i },
    { name: 'General questions', match: /question|help|support|wondering|clarif/i },
  ],
};

/** Sub-category for a ticket. Falls back to "Other" (or "General" for unknown categories). */
export function classifySub(category: string, subject: string): string {
  const rules = TAXONOMY[category];
  if (rules === undefined) return 'General';
  for (const rule of rules) if (rule.match.test(subject)) return rule.name;
  return 'Other';
}
