// Minimal OpenAI-compatible chat client. Works with any provider that exposes
// the `/chat/completions` shape — DeepSeek, OpenAI, OpenRouter, Together, a local
// Ollama, etc. — so the model is chosen entirely by base URL + model id. No SDK,
// no dependencies: a single fetch with a timeout and one retry.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
}

export interface ChatOptions {
  json?: boolean; // request a strict JSON object back (response_format)
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'LlmError';
  }
}

/** `https://api.deepseek.com/v1/` + `chat/completions` without doubled slashes. */
function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

async function once(url: string, cfg: LlmConfig, messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts.temperature ?? cfg.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 800,
      stream: false,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? '';
    } catch {
      detail = res.statusText;
    }
    throw new LlmError(`provider returned ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new LlmError('provider returned an empty completion');
  }
  return content.trim();
}

/**
 * One chat completion. Retries once on a network error or 5xx (never on a 4xx —
 * a bad key or model won't fix itself). Throws LlmError on failure so callers can
 * fall back to the rule-based engine.
 */
export async function chat(cfg: LlmConfig, messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const url = endpoint(cfg.baseUrl);
  try {
    return await once(url, cfg, messages, opts);
  } catch (err) {
    const retryable = !(err instanceof LlmError) || err.status === undefined || err.status >= 500;
    if (!retryable) throw err;
    return once(url, cfg, messages, opts);
  }
}

/** A tiny round-trip used by the "Test connection" button. */
export async function ping(cfg: LlmConfig): Promise<{ ok: true; reply: string }> {
  const reply = await chat(
    cfg,
    [
      { role: 'system', content: 'You are a connectivity check. Reply with the single word: pong.' },
      { role: 'user', content: 'ping' },
    ],
    { maxTokens: 8, timeoutMs: 12_000, temperature: 0 },
  );
  return { ok: true, reply };
}
