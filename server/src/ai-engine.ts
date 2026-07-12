// Server-side rule-based AI decision engine. Pure functions, mirrored from
// web/src/features/ai/engine.ts so the API and the demo client agree on what an
// agent would do. No model calls — deterministic heuristics with a BYO-key hook
// living on the web side.

import type { CannedReply, KbArticle, TicketPriority } from './types.js';

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;
const lc = (s: string): string => s.toLowerCase();

const TAG_RULES: { tag: string; re: RegExp }[] = [
  { tag: 'refund', re: /\b(refund|charged twice|double charge|money back|chargeback)\b/ },
  { tag: 'billing', re: /\b(invoice|vat|receipt|billing|charge|payment|subscription|plan|proration)\b/ },
  { tag: 'api', re: /\b(api|429|rate limit|webhook|sdk|endpoint|token|integration)\b/ },
  { tag: 'bug', re: /\b(bug|error|crash|broken|not working|fails?|exception|traceback|stack)\b/ },
  { tag: 'account', re: /\b(login|log in|2fa|password|locked|account|sign in|authenticat)\b/ },
  { tag: 'shipping', re: /\b(ship|track|deliver|courier|parcel|package|damaged|arrived)\b/ },
  { tag: 'onboarding', re: /\b(import|migrat|get started|set ?up|onboard)\b/ },
  { tag: 'feature-request', re: /\b(feature request|would be great|please add|any plans|roadmap)\b/ },
];
const URGENT_RE = /\b(urgent|asap|immediately|critical|outage|down|cannot access|can't access|blocked|escalat)\b/;
const HIGH_RE = /\b(charged twice|double charge|refund|not working|broken|failing|error|deadline|angry|frustrat)\b/;

export interface Triage {
  priority: TicketPriority | null;
  tags: string[];
}

export function suggestTriage(input: {
  subject: string; bodyText: string; currentPriority: TicketPriority; currentTags: string[];
}): Triage {
  const text = lc(`${input.subject} ${input.bodyText}`);
  const order: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];
  const rank = (p: TicketPriority): number => order.indexOf(p);
  let detected: TicketPriority = 'medium';
  if (URGENT_RE.test(text)) detected = 'urgent';
  else if (HIGH_RE.test(text)) detected = 'high';
  const priority = rank(detected) > rank(input.currentPriority) ? detected : null;
  const have = new Set(input.currentTags);
  const tags: string[] = [];
  for (const { tag, re } of TAG_RULES) if (re.test(text) && !have.has(tag) && !tags.includes(tag)) tags.push(tag);
  return { priority, tags: tags.slice(0, 4) };
}

function bestCanned(text: string, canned: CannedReply[]): CannedReply | null {
  let best: CannedReply | null = null;
  let score = 0;
  for (const c of canned) {
    const terms = lc(`${c.title} ${c.body}`).match(/[a-z]{4,}/g) ?? [];
    let s = 0;
    for (const t of new Set(terms)) if (text.includes(t)) s += 1;
    if (s > score) { score = s; best = c; }
  }
  return score >= 3 ? best : null;
}

export function draftReply(input: {
  subject: string; contactName: string; agentName: string; lastCustomerMessage: string; canned: CannedReply[];
}): string {
  const first = firstName(input.contactName);
  const agent = firstName(input.agentName);
  const text = lc(`${input.subject} ${input.lastCustomerMessage}`);
  const match = bestCanned(text, input.canned);
  const opener = `Hi ${first},`;
  const closer = `Best,\n${agent}`;
  if (match !== null) return `${opener}\n\n${match.body}\n\n${closer}`;
  const topic = input.subject.replace(/[.!?]+$/, '').toLowerCase();
  const body =
    `Thanks for reaching out about ${topic}. I've looked into it and I'm on it now — ` +
    `I'll follow up here shortly with the next step. If anything else is affected in the meantime, just reply and it stays on this thread.`;
  return `${opener}\n\n${body}\n\n${closer}`;
}

/** Scores the ticket against KB articles; returns the best confident match. */
export function deflect(text: string, kb: KbArticle[]): { articleId: string; score: number } | null {
  const hay = lc(text);
  let best: { articleId: string; score: number } | null = null;
  for (const a of kb) {
    if (a.status !== 'published') continue;
    const terms = new Set((lc(`${a.title} ${a.title} ${a.body}`).match(/[a-z0-9]{4,}/g) ?? []));
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score += 1;
    if (best === null || score > best.score) best = { articleId: a.id, score };
  }
  return best !== null && best.score >= 6 ? best : null;
}

export type Autonomy = 'suggest' | 'draft' | 'resolve';

export interface AiDecision {
  kind: 'triage' | 'draft' | 'resolve';
  draftBody: string | null;
  suggestedPriority: TicketPriority | null;
  suggestedTags: string[];
  kbArticleId: string | null;
}

export interface AgentContext {
  subject: string; bodyText: string; contactName: string; agentName: string;
  currentPriority: TicketPriority; currentTags: string[];
  canned: CannedReply[]; kb: KbArticle[];
}

export function runAgent(
  agent: { autonomy: Autonomy; scopeTags: string[]; scopePriorities: TicketPriority[] },
  ctx: AgentContext,
): AiDecision | null {
  if (agent.scopeTags.length > 0 && !ctx.currentTags.some((t) => agent.scopeTags.includes(t))) return null;
  if (agent.scopePriorities.length > 0 && !agent.scopePriorities.includes(ctx.currentPriority)) return null;

  const triage = suggestTriage(ctx);
  const draft = (): AiDecision => ({
    kind: 'draft',
    draftBody: draftReply({
      subject: ctx.subject, contactName: ctx.contactName, agentName: ctx.agentName,
      lastCustomerMessage: ctx.bodyText, canned: ctx.canned,
    }),
    suggestedPriority: triage.priority,
    suggestedTags: triage.tags,
    kbArticleId: null,
  });

  if (agent.autonomy === 'suggest') {
    if (triage.priority === null && triage.tags.length === 0) return null;
    return { kind: 'triage', draftBody: null, suggestedPriority: triage.priority, suggestedTags: triage.tags, kbArticleId: null };
  }
  if (agent.autonomy === 'draft') return draft();

  // resolve: deflect to a KB article when confident, otherwise fall back to a draft.
  const hit = deflect(`${ctx.subject} ${ctx.bodyText}`, ctx.kb);
  if (hit === null) return draft();
  const article = ctx.kb.find((a) => a.id === hit.articleId);
  const first = firstName(ctx.contactName);
  const answer = article
    ? `Hi ${first},\n\n${article.body}\n\nIf that does not fully cover it, reply here and a teammate will take a look.\n\nBest,\n${firstName(ctx.agentName)}`
    : draftReply({ subject: ctx.subject, contactName: ctx.contactName, agentName: ctx.agentName, lastCustomerMessage: ctx.bodyText, canned: ctx.canned });
  return { kind: 'resolve', draftBody: answer, suggestedPriority: triage.priority, suggestedTags: triage.tags, kbArticleId: hit.articleId };
}
