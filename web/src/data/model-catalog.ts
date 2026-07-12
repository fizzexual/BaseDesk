// A curated catalog of OpenAI-compatible providers and their models, with the
// details you actually weigh when choosing one: price per 1M tokens (input /
// output), whether it's a reasoning model, and the context window.
//
// Prices are INDICATIVE (USD per 1M tokens) and drift often — each provider
// links to its live pricing page, and any model id can be typed by hand, so the
// catalog is a convenience, never a hard constraint.

export interface ModelInfo {
  id: string; // the exact API model id sent to the provider
  label: string;
  reasoning: boolean;
  contextK: number; // context window, thousands of tokens
  inputPer1M: number; // USD per 1M input tokens (0 = free / local)
  outputPer1M: number; // USD per 1M output tokens
  note?: string;
}

export interface ProviderInfo {
  key: string;
  label: string;
  baseUrl: string;
  pricingUrl: string;
  local?: boolean; // runs on your machine — no key, no cost
  models: ModelInfo[];
}

export const PRICES_NOTE = 'Prices are approximate, per 1M tokens — check the provider’s pricing page for current rates.';

export const PROVIDERS: ProviderInfo[] = [
  {
    key: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat (V3)', reasoning: false, contextK: 64, inputPer1M: 0.27, outputPer1M: 1.1, note: 'Fast general model — best default for support.' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)', reasoning: true, contextK: 64, inputPer1M: 0.55, outputPer1M: 2.19, note: 'Thinks step by step before answering.' },
    ],
  },
  {
    key: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    pricingUrl: 'https://openai.com/api/pricing/',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', reasoning: false, contextK: 128, inputPer1M: 0.15, outputPer1M: 0.6, note: 'Cheap and capable — a strong default.' },
      { id: 'gpt-4o', label: 'GPT-4o', reasoning: false, contextK: 128, inputPer1M: 2.5, outputPer1M: 10 },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano', reasoning: false, contextK: 1000, inputPer1M: 0.1, outputPer1M: 0.4 },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', reasoning: false, contextK: 1000, inputPer1M: 0.4, outputPer1M: 1.6 },
      { id: 'gpt-4.1', label: 'GPT-4.1', reasoning: false, contextK: 1000, inputPer1M: 2, outputPer1M: 8 },
      { id: 'o4-mini', label: 'o4-mini', reasoning: true, contextK: 200, inputPer1M: 1.1, outputPer1M: 4.4, note: 'Reasoning model, budget tier.' },
      { id: 'o3', label: 'o3', reasoning: true, contextK: 200, inputPer1M: 10, outputPer1M: 40, note: 'Top-end reasoning.' },
    ],
  },
  {
    key: 'xai',
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    pricingUrl: 'https://docs.x.ai/docs/models',
    models: [
      { id: 'grok-3-mini', label: 'Grok 3 mini', reasoning: true, contextK: 131, inputPer1M: 0.3, outputPer1M: 0.5, note: 'Reasoning, low cost.' },
      { id: 'grok-3', label: 'Grok 3', reasoning: false, contextK: 131, inputPer1M: 3, outputPer1M: 15 },
      { id: 'grok-2-latest', label: 'Grok 2', reasoning: false, contextK: 131, inputPer1M: 2, outputPer1M: 10 },
    ],
  },
  {
    key: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    pricingUrl: 'https://mistral.ai/technology/#pricing',
    models: [
      { id: 'mistral-small-latest', label: 'Mistral Small', reasoning: false, contextK: 128, inputPer1M: 0.2, outputPer1M: 0.6, note: 'Efficient workhorse.' },
      { id: 'mistral-large-latest', label: 'Mistral Large', reasoning: false, contextK: 128, inputPer1M: 2, outputPer1M: 6 },
      { id: 'open-mistral-nemo', label: 'Mistral Nemo', reasoning: false, contextK: 128, inputPer1M: 0.15, outputPer1M: 0.15 },
    ],
  },
  {
    key: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    pricingUrl: 'https://groq.com/pricing/',
    models: [
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', reasoning: false, contextK: 128, inputPer1M: 0.05, outputPer1M: 0.08, note: 'Extremely fast and cheap.' },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', reasoning: false, contextK: 128, inputPer1M: 0.59, outputPer1M: 0.79 },
      { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill 70B', reasoning: true, contextK: 128, inputPer1M: 0.75, outputPer1M: 0.99, note: 'Reasoning, runs fast on Groq.' },
    ],
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    pricingUrl: 'https://openrouter.ai/models',
    models: [
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', reasoning: false, contextK: 64, inputPer1M: 0.27, outputPer1M: 1.1 },
      { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', reasoning: true, contextK: 64, inputPer1M: 0.55, outputPer1M: 2.19 },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', reasoning: false, contextK: 128, inputPer1M: 0.15, outputPer1M: 0.6 },
      { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', reasoning: false, contextK: 200, inputPer1M: 3, outputPer1M: 15 },
      { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', reasoning: false, contextK: 1000, inputPer1M: 0.1, outputPer1M: 0.4 },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', reasoning: false, contextK: 128, inputPer1M: 0.12, outputPer1M: 0.3 },
    ],
  },
  {
    key: 'together',
    label: 'Together',
    baseUrl: 'https://api.together.xyz/v1',
    pricingUrl: 'https://www.together.ai/pricing',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo', reasoning: false, contextK: 128, inputPer1M: 0.88, outputPer1M: 0.88 },
      { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1', reasoning: true, contextK: 64, inputPer1M: 3, outputPer1M: 7 },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen 2.5 72B Turbo', reasoning: false, contextK: 128, inputPer1M: 1.2, outputPer1M: 1.2 },
    ],
  },
  {
    key: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    pricingUrl: 'https://ollama.com/library',
    local: true,
    models: [
      { id: 'llama3.2', label: 'Llama 3.2', reasoning: false, contextK: 128, inputPer1M: 0, outputPer1M: 0 },
      { id: 'llama3.1', label: 'Llama 3.1', reasoning: false, contextK: 128, inputPer1M: 0, outputPer1M: 0 },
      { id: 'qwen2.5', label: 'Qwen 2.5', reasoning: false, contextK: 128, inputPer1M: 0, outputPer1M: 0 },
      { id: 'deepseek-r1', label: 'DeepSeek R1', reasoning: true, contextK: 128, inputPer1M: 0, outputPer1M: 0, note: 'Local reasoning model.' },
      { id: 'mistral', label: 'Mistral', reasoning: false, contextK: 32, inputPer1M: 0, outputPer1M: 0 },
    ],
  },
];

const trimUrl = (u: string): string => u.replace(/\/+$/, '');

export function providerForBaseUrl(baseUrl: string): ProviderInfo | undefined {
  const b = trimUrl(baseUrl.trim());
  return PROVIDERS.find((p) => trimUrl(p.baseUrl) === b);
}

export function modelInfo(baseUrl: string, id: string): ModelInfo | undefined {
  return providerForBaseUrl(baseUrl)?.models.find((m) => m.id === id);
}

/** "$0.27", "$10", or "Free" for local models. */
export function formatPrice(usdPer1M: number): string {
  if (usdPer1M === 0) return 'Free';
  return usdPer1M < 1 ? `$${usdPer1M.toFixed(2)}` : `$${usdPer1M % 1 === 0 ? usdPer1M : usdPer1M.toFixed(2)}`;
}

/** "128K" or "1M" context. */
export function formatContext(contextK: number): string {
  return contextK >= 1000 ? `${contextK / 1000}M` : `${contextK}K`;
}

/** Dollar cost of a generation for the given model, or null if its price is unknown. */
export function estimateCost(promptTokens: number, completionTokens: number, baseUrl: string, model: string): number | null {
  const info = modelInfo(baseUrl, model);
  if (info === undefined) return null;
  return (promptTokens / 1_000_000) * info.inputPer1M + (completionTokens / 1_000_000) * info.outputPer1M;
}

export function formatCost(usd: number): string {
  if (usd === 0) return 'free';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** "480" or "1.2K" tokens. */
export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n);
}
