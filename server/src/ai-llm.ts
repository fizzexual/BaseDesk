// Orchestration between the model and the rule-based engine. Every function here
// tries the configured provider first and falls back to the deterministic
// heuristics on any failure, so the copilot always returns something useful — a
// missing key, a provider outage, or a malformed completion degrades gracefully.

import { chat, type LlmConfig, type TokenUsage } from './llm.js';
import { draftMessages, resolveMessages, summaryMessages, triageMessages, type DraftCtx, type SummaryCtx, type TriageCtx } from './ai-prompts.js';
import type { AiProviderConfig, TicketPriority } from './types.js';

export type AiSource = 'model' | 'rules';

/** No tokens spent — the rule-based path is free. */
const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0 };

const PRIORITY_ORDER: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];
const rank = (p: TicketPriority): number => PRIORITY_ORDER.indexOf(p);

/** True when the provider is switched on and has the minimum config to call out. */
export function providerReady(cfg: AiProviderConfig): boolean {
  return cfg.enabled && cfg.apiKey.trim() !== '' && cfg.baseUrl.trim() !== '' && cfg.model.trim() !== '';
}

function toLlm(cfg: AiProviderConfig): LlmConfig {
  return { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, temperature: cfg.temperature };
}

/** Output token budget per task. Reasoning models spend tokens on hidden
 *  chain-of-thought before the visible answer, so they get a much larger cap. */
function budget(cfg: AiProviderConfig, task: 'draft' | 'triage' | 'summary' | 'resolve'): number {
  const base = { draft: 800, triage: 220, summary: 150, resolve: 900 };
  const reason = { draft: 2400, triage: 1200, summary: 900, resolve: 2600 };
  return (cfg.reasoning ? reason : base)[task];
}

/** Pulls a JSON object out of a completion, tolerating ```json fences or prose. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in completion');
  return JSON.parse(candidate.slice(start, end + 1));
}

export interface TriageResult {
  priority: TicketPriority | null;
  tags: string[];
  reason: string;
  source: AiSource;
  usage: TokenUsage;
}

function reasonFor(priority: TicketPriority | null, tags: string[]): string {
  const bits: string[] = [];
  if (priority !== null) bits.push(`priority looks ${priority}`);
  if (tags.length > 0) bits.push(`topics: ${tags.join(', ')}`);
  return bits.length > 0 ? bits.join(' · ') : 'no changes suggested';
}

/** Model-backed triage, validated and clamped to the app's rules (raise-only,
 *  no duplicate tags, max 4). Falls back to the rule-based suggestion. */
export async function suggestTriageAI(
  cfg: AiProviderConfig,
  ctx: TriageCtx,
  fallback: { priority: TicketPriority | null; tags: string[] },
): Promise<TriageResult> {
  const fb: TriageResult = { ...fallback, reason: reasonFor(fallback.priority, fallback.tags), source: 'rules', usage: ZERO_USAGE };
  if (!providerReady(cfg)) return fb;
  try {
    const { text: raw, usage } = await chat(toLlm(cfg), triageMessages(ctx), { json: true, maxTokens: budget(cfg, 'triage'), temperature: 0 });
    const obj = extractJson(raw) as { priority?: unknown; tags?: unknown; reason?: unknown };

    let priority: TicketPriority | null = null;
    if (typeof obj.priority === 'string' && PRIORITY_ORDER.includes(obj.priority as TicketPriority)) {
      const p = obj.priority as TicketPriority;
      // Only ever raise priority above what the agent already set.
      if (rank(p) > rank(ctx.currentPriority as TicketPriority)) priority = p;
    }
    const have = new Set(ctx.currentTags.map((t) => t.toLowerCase()));
    const tags: string[] = [];
    if (Array.isArray(obj.tags)) {
      for (const t of obj.tags) {
        const tag = String(t).trim().toLowerCase();
        if (tag !== '' && !have.has(tag) && !tags.includes(tag)) tags.push(tag);
        if (tags.length === 4) break;
      }
    }
    const reason = typeof obj.reason === 'string' && obj.reason.trim() !== '' ? obj.reason.trim() : reasonFor(priority, tags);
    return { priority, tags, reason, source: 'model', usage };
  } catch {
    return fb;
  }
}

/** Model-backed reply draft; falls back to the rule-based draft string. */
export async function draftReplyAI(cfg: AiProviderConfig, ctx: DraftCtx, fallback: string): Promise<{ body: string; source: AiSource; usage: TokenUsage }> {
  if (!providerReady(cfg)) return { body: fallback, source: 'rules', usage: ZERO_USAGE };
  try {
    const { text: body, usage } = await chat(toLlm(cfg), draftMessages(ctx, cfg.kbOnly), { maxTokens: budget(cfg, 'draft') });
    return { body, source: 'model', usage };
  } catch {
    return { body: fallback, source: 'rules', usage: ZERO_USAGE };
  }
}

/** Model-backed one-line summary; falls back to the rule-based summary. */
export async function summarizeThreadAI(cfg: AiProviderConfig, ctx: SummaryCtx, fallback: string): Promise<{ summary: string; source: AiSource; usage: TokenUsage }> {
  if (!providerReady(cfg)) return { summary: fallback, source: 'rules', usage: ZERO_USAGE };
  try {
    const { text: summary, usage } = await chat(toLlm(cfg), summaryMessages(ctx), { maxTokens: budget(cfg, 'summary'), temperature: 0.2 });
    return { summary, source: 'model', usage };
  } catch {
    return { summary: fallback, source: 'rules', usage: ZERO_USAGE };
  }
}

/**
 * Autonomous resolve decision. Returns the model's reply (with token usage) only
 * when it is confident the KB resolves the ticket; returns null to signal "let the
 * rule-based agent decide" (provider off, model abstained, or an error).
 */
export async function resolveAI(cfg: AiProviderConfig, ctx: DraftCtx): Promise<{ reply: string; usage: TokenUsage } | null> {
  if (!providerReady(cfg)) return null;
  try {
    const { text: raw, usage } = await chat(toLlm(cfg), resolveMessages(ctx), { json: true, maxTokens: budget(cfg, 'resolve'), temperature: 0.2 });
    const obj = extractJson(raw) as { canResolve?: unknown; reply?: unknown };
    if (obj.canResolve === true && typeof obj.reply === 'string' && obj.reply.trim() !== '') {
      return { reply: obj.reply.trim(), usage };
    }
    return null;
  } catch {
    return null;
  }
}
