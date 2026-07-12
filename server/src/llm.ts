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
  allowEmpty?: boolean; // return '' instead of throwing when the model emits no text
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

  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
  };
  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    throw new LlmError('provider did not return a chat completion — check the base URL and model id');
  }
  // Some reasoning models (DeepSeek reasoner-style) put the answer in `content`
  // and chain-of-thought in `reasoning_content`; fall back to the latter only if
  // `content` is empty so a short/low-budget response still yields text.
  const message = data.choices[0]?.message;
  const content = (message?.content ?? '').trim() || (message?.reasoning_content ?? '').trim();
  if (content === '' && opts.allowEmpty !== true) {
    throw new LlmError('the model returned an empty completion — check the model id or raise max tokens');
  }
  return content;
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

/**
 * A tiny round-trip used by the "Test connection" button. Uses a comfortable
 * token budget (reasoning models burn tokens before emitting visible text) and
 * tolerates an empty reply so connectivity still verifies — the caller decides
 * how to present an empty completion.
 */
export async function ping(cfg: LlmConfig): Promise<{ ok: true; reply: string }> {
  const reply = await chat(
    cfg,
    [
      { role: 'system', content: 'You are a connectivity check for a support tool.' },
      { role: 'user', content: 'Reply with the single word: ok' },
    ],
    { maxTokens: 64, timeoutMs: 15_000, temperature: 0, allowEmpty: true },
  );
  return { ok: true, reply };
}
