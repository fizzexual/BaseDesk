// Prompt builders for the model-backed copilot and autonomous agents. These are
// the heart of output quality: every prompt pins the model to the conversation,
// the knowledge base, and the team's canned replies, and forbids inventing facts.
// Keeping them in one place makes them easy to tune.

import type { ChatMessage } from './llm.js';

export interface ThreadMsg {
  role: 'customer' | 'agent';
  body: string;
}

export interface DraftCtx {
  subject: string;
  contactName: string;
  agentName: string;
  signature: string;
  thread: ThreadMsg[];
  canned: { title: string; body: string }[];
  kb: { title: string; body: string }[];
}

export interface TriageCtx {
  subject: string;
  bodyText: string;
  currentPriority: string;
  currentTags: string[];
}

export interface SummaryCtx {
  contactName: string;
  thread: ThreadMsg[];
}

/** Topic tags the model may apply — kept in lockstep with the rule-based engine
 *  and the automation conditions so suggestions stay consistent across the app. */
export const TAG_VOCABULARY = [
  'refund', 'billing', 'api', 'bug', 'account', 'shipping', 'onboarding', 'feature-request',
] as const;

const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const firstName = (name: string): string => {
  const f = name.trim().split(/\s+/)[0];
  return f && f !== '' ? f : 'there';
};

/** Renders the recent conversation as a compact, labelled transcript. */
function renderThread(thread: ThreadMsg[], limit = 12): string {
  const recent = thread.slice(-limit);
  if (recent.length === 0) return '(no messages yet)';
  return recent.map((m) => `${m.role === 'customer' ? 'Customer' : 'Agent'}: ${clip(m.body, 900)}`).join('\n');
}

/**
 * A reply the agent can send as-is. In the default `kbOnly` mode the model may
 * only use the knowledge base as its source of facts and must not guess; in the
 * relaxed mode it may add general product knowledge but still invents no specifics.
 */
export function draftMessages(ctx: DraftCtx, kbOnly = true): ChatMessage[] {
  const kb = ctx.kb.length > 0
    ? ctx.kb.slice(0, 5).map((a, i) => `[KB${i + 1}] ${a.title}\n${clip(a.body, 800)}`).join('\n\n')
    : '(no relevant articles found)';
  const canned = ctx.canned.length > 0
    ? '\n\nApproved reply templates you may borrow wording/tone from (do NOT treat as new facts):\n' +
      ctx.canned.slice(0, 4).map((c, i) => `[T${i + 1}] ${c.title}: ${clip(c.body, 300)}`).join('\n')
    : '';
  const rules = kbOnly
    ? [
        'Answer using ONLY the knowledge base articles provided below. Follow these rules exactly:',
        '- Every fact, step, policy, price, or instruction in your reply MUST come from the knowledge base articles. Do not use outside/general knowledge.',
        '- If the articles do not answer the question, do NOT guess or invent anything. Instead write a brief, honest reply saying you will check with the team and follow up, or ask one focused clarifying question.',
      ]
    : [
        'Write the reply using the conversation and the knowledge base below. Follow these rules exactly:',
        '- Prefer facts from the knowledge base; you may add general product/support knowledge to be helpful, but stay accurate.',
        '- If you do not know something specific, say what you will do next or ask a focused question rather than guessing.',
      ];
  const system = [
    `You are ${ctx.agentName}, a customer-support agent replying on behalf of your company.`,
    ...rules,
    '- Never invent order numbers, dates, prices, refund amounts, account details, URLs, or policies that are not in the material.',
    "- Be warm and concise, and match the customer's language.",
    '- Output ONLY the message body — no subject line, no "Draft:", no notes to yourself, no markdown headings.',
    ctx.signature.trim() !== ''
      ? `- End with exactly this signature on its own lines:\n${ctx.signature.trim()}`
      : `- Sign off warmly as ${firstName(ctx.agentName)}.`,
  ].join('\n');

  const user = [
    `Subject: ${ctx.subject}`,
    `Customer name: ${ctx.contactName}`,
    '',
    'Conversation so far:',
    renderThread(ctx.thread),
    '',
    kbOnly ? 'Knowledge base (your only source of facts):' : 'Knowledge base:',
    kb,
    canned,
    '',
    kbOnly ? 'Write the next reply to the customer, using only the knowledge base above.' : 'Write the next reply to the customer.',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Strict-JSON triage. The model returns priority + topic tags + a short reason. */
export function triageMessages(ctx: TriageCtx): ChatMessage[] {
  const system = [
    'You are a support triage assistant. Read the ticket and classify it.',
    'Respond with a single JSON object and nothing else, matching exactly:',
    '{"priority": "urgent"|"high"|"medium"|"low"|null, "tags": string[], "reason": string}',
    `- "priority": the priority the ticket deserves, or null if the current priority (${ctx.currentPriority}) already fits. Only ever suggest RAISING priority, never lowering it.`,
    `- "tags": zero or more topic tags describing the ticket. Prefer these where they fit: ${TAG_VOCABULARY.join(', ')}. Do not repeat tags already on the ticket. At most 4.`,
    '- "reason": one short clause (max ~12 words) explaining the call.',
    'Judge urgency by real customer impact (outage, blocked work, money at risk, churn signals) — not by tone alone.',
  ].join('\n');

  const user = [
    `Subject: ${ctx.subject}`,
    `Message: ${clip(ctx.bodyText, 1500)}`,
    `Current priority: ${ctx.currentPriority}`,
    `Existing tags: ${ctx.currentTags.length ? ctx.currentTags.join(', ') : '(none)'}`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** A one-line internal handoff summary. */
export function summaryMessages(ctx: SummaryCtx): ChatMessage[] {
  const system = [
    'You summarise a support conversation for a teammate who is about to take it over.',
    'Write one or two plain sentences: what the customer needs and where things stand right now.',
    'Be factual and specific. No greeting, no preamble, no bullet points. Do not invent details.',
  ].join('\n');

  const user = `Customer: ${ctx.contactName}\n\nConversation:\n${renderThread(ctx.thread, 16)}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Precise, commentary-free translation into `targetLang`, returned as JSON so we
 *  also get the detected source language. */
export function translateMessages(text: string, targetLang: string): ChatMessage[] {
  const system = [
    `You are a precise translation engine inside a customer-support tool.`,
    `Detect the language of the message and translate it into ${targetLang}.`,
    `Preserve meaning, tone, names, numbers, URLs and line breaks. Add no notes or commentary.`,
    `If the text is already in ${targetLang}, return it unchanged.`,
    `Respond ONLY with a JSON object: {"sourceLanguage": "<detected language, in English>", "translation": "<the translated text>"}.`,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ];
}

/**
 * Autonomous auto-resolve. The model may ONLY answer from the knowledge base; if
 * the KB does not clearly resolve the ticket it must abstain, and we fall back to
 * a human draft. The JSON gate keeps that decision explicit and auditable.
 */
export function resolveMessages(ctx: DraftCtx): ChatMessage[] {
  const kb =
    ctx.kb.length > 0
      ? ctx.kb.slice(0, 5).map((a, i) => `[KB${i + 1}] ${a.title}\n${clip(a.body, 800)}`).join('\n\n')
      : '(no articles)';
  const system = [
    `You are an autonomous first-line support agent named ${ctx.agentName}.`,
    'You may resolve a ticket ONLY when the knowledge base clearly and completely answers it.',
    'Respond with a single JSON object and nothing else:',
    '{"canResolve": boolean, "reply": string}',
    '- "canResolve": true only if the articles fully answer the customer with no guesswork. If it is borderline, partial, account-specific, or needs an action you cannot verify, return false.',
    '- "reply": when canResolve is true, the complete message to send the customer — warm, grounded strictly in the articles, invents nothing. When false, an empty string.',
    ctx.signature.trim() !== '' ? `- End a sent reply with this signature:\n${ctx.signature.trim()}` : `- Sign off as ${firstName(ctx.agentName)}.`,
  ].join('\n');

  const user = [
    `Subject: ${ctx.subject}`,
    `Customer name: ${ctx.contactName}`,
    '',
    'Conversation:',
    renderThread(ctx.thread),
    '',
    'Knowledge base:',
    kb,
    '',
    'Decide whether the knowledge base lets you resolve this now.',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
