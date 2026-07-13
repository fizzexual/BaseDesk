// BaseDesk AI copilot — a local, deterministic, rule-based engine that runs with
// no API key. It produces genuinely useful drafts, triage suggestions, and thread
// summaries offline. `getApiKey`/`aiEnabled` are the hooks a future model provider
// plugs into; the heuristics remain the zero-config default.

import type { CannedReply, KbArticle, Message, TicketPriority } from '../../data/types';

const KEY_STORAGE = 'basedesk-ai-key';
const ENABLED_STORAGE = 'basedesk-ai-enabled';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function getApiKey(): string | null {
  const v = read(KEY_STORAGE);
  return v !== null && v.trim() !== '' ? v : null;
}
export function setApiKey(key: string | null): void {
  write(KEY_STORAGE, key === null || key.trim() === '' ? null : key.trim());
}
export function aiEnabled(): boolean {
  return read(ENABLED_STORAGE) !== '0';
}

/** Turn a server fallback `reason` into a message that tells the user what to do.
 *  'off' (or none) means no provider is set up; anything else is a provider error. */
export function aiFallbackMessage(reason: string | undefined): string {
  if (reason === undefined || reason === 'off') {
    return 'AI isn’t set up yet — add your provider key under Settings → AI to get real model-written replies.';
  }
  // Empty completions are almost always a reasoning model with too small a budget.
  if (/empty/i.test(reason)) {
    return 'The model returned no text — if it’s a reasoning model, turn on “Reasoning model” in Settings → AI so it has room to think. Showing a rule-based draft for now.';
  }
  return `AI provider error: ${reason} — showing a rule-based draft. Check Settings → AI.`;
}
export function setAiEnabled(on: boolean): void {
  write(ENABLED_STORAGE, on ? '1' : '0');
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;
const words = (s: string): string => s.toLowerCase();

/** Keyword → tag rules, checked against subject + body text. */
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

export interface TriageSuggestion {
  priority: TicketPriority | null; // null when the current priority already fits
  tags: string[]; // only tags not already on the ticket
  reason: string;
}

export function suggestTriage(input: {
  subject: string;
  bodyText: string;
  currentPriority: TicketPriority;
  currentTags: string[];
}): TriageSuggestion {
  const text = words(`${input.subject} ${input.bodyText}`);
  const order: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];
  const rank = (p: TicketPriority): number => order.indexOf(p);

  let detected: TicketPriority = 'medium';
  if (URGENT_RE.test(text)) detected = 'urgent';
  else if (HIGH_RE.test(text)) detected = 'high';

  // Only suggest raising priority, never lowering an agent's deliberate choice.
  const priority = rank(detected) > rank(input.currentPriority) ? detected : null;

  const have = new Set(input.currentTags);
  const tags: string[] = [];
  for (const { tag, re } of TAG_RULES) {
    if (re.test(text) && !have.has(tag) && !tags.includes(tag)) tags.push(tag);
  }

  const bits: string[] = [];
  if (priority !== null) bits.push(`priority looks ${priority}`);
  if (tags.length > 0) bits.push(`topics: ${tags.join(', ')}`);
  const reason = bits.length > 0 ? bits.join(' · ') : 'no changes suggested';
  return { priority, tags: tags.slice(0, 4), reason };
}

/** Picks the canned reply whose title/body best overlaps the conversation. */
function bestCanned(text: string, canned: CannedReply[]): CannedReply | null {
  let best: CannedReply | null = null;
  let bestScore = 0;
  for (const c of canned) {
    const terms = words(`${c.title} ${c.body}`).match(/[a-z]{4,}/g) ?? [];
    let score = 0;
    for (const t of new Set(terms)) if (text.includes(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 3 ? best : null;
}

export function draftReply(input: {
  subject: string;
  contactName: string;
  agentName: string;
  lastCustomerMessage: string;
  canned: CannedReply[];
}): string {
  const first = firstName(input.contactName);
  const agent = firstName(input.agentName);
  const text = words(`${input.subject} ${input.lastCustomerMessage}`);
  const match = bestCanned(text, input.canned);

  const opener = `Hi ${first},`;
  const closer = `Best,\n${agent}`;

  if (match !== null) {
    return `${opener}\n\n${match.body}\n\n${closer}`;
  }

  // No strong canned match — assemble a grounded, non-generic acknowledgement.
  const topic = input.subject.replace(/[.!?]+$/, '').toLowerCase();
  const body =
    `Thanks for reaching out about ${topic}. I've looked into it and I'm on it now — ` +
    `I'll follow up here shortly with the next step. If anything else is affected in the meantime, ` +
    `just reply and it stays on this thread.`;
  return `${opener}\n\n${body}\n\n${closer}`;
}

export function summarizeThread(input: {
  contactName: string;
  messages: Pick<Message, 'authorKind' | 'kind' | 'body'>[];
}): string {
  const replies = input.messages.filter((m) => m.kind === 'reply');
  if (replies.length === 0) return 'No customer-facing messages yet.';

  const first = firstName(input.contactName);
  const firstAsk = replies.find((m) => m.authorKind === 'contact');
  const last = replies[replies.length - 1]!;
  const clip = (s: string, n = 140): string => {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };

  const parts: string[] = [];
  if (firstAsk !== undefined) parts.push(`${first} wrote in: "${clip(firstAsk.body)}"`);
  parts.push(`${replies.length} message${replies.length === 1 ? '' : 's'} so far.`);
  const who = last.authorKind === 'agent' ? 'Latest from your team' : `Latest from ${first}`;
  parts.push(`${who}: "${clip(last.body)}"`);
  return parts.join(' ');
}

// Exported for the AI overview page copy.
export const AI_MODULES: { key: string; title: string; body: string }[] = [
  {
    key: 'draft',
    title: 'Reply drafts',
    body: 'Grounded in the conversation and your canned replies. You review and edit before anything sends.',
  },
  {
    key: 'triage',
    title: 'Triage suggestions',
    body: 'Priority and topic tags proposed from the ticket content — applied only when you click.',
  },
  {
    key: 'summary',
    title: 'Thread summaries',
    body: 'One-line context on handoff, so a teammate picks up without rereading the whole thread.',
  },
];

// --- Autonomous agent decisions (mirrors server/src/ai-engine.ts) ---

/** Scores the ticket against KB articles; returns the best confident match. */
export function deflect(text: string, kb: KbArticle[]): { articleId: string; score: number } | null {
  const hay = text.toLowerCase();
  let best: { articleId: string; score: number } | null = null;
  for (const a of kb) {
    if (a.status !== 'published') continue;
    const terms = new Set((`${a.title} ${a.title} ${a.body}`.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []));
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

  const triage = suggestTriage({
    subject: ctx.subject, bodyText: ctx.bodyText, currentPriority: ctx.currentPriority, currentTags: ctx.currentTags,
  });
  const first = firstName(ctx.contactName);
  const agentFirst = firstName(ctx.agentName);
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

  const hit = deflect(`${ctx.subject} ${ctx.bodyText}`, ctx.kb);
  if (hit === null) return draft();
  const article = ctx.kb.find((a) => a.id === hit.articleId);
  const answer = article
    ? `Hi ${first},\n\n${article.body}\n\nIf that does not fully cover it, reply here and a teammate will take a look.\n\nBest,\n${agentFirst}`
    : draft().draftBody;
  return { kind: 'resolve', draftBody: answer, suggestedPriority: triage.priority, suggestedTags: triage.tags, kbArticleId: hit.articleId };
}
