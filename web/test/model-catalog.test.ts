import { describe, expect, it } from 'vitest';
import {
  formatContext, formatPrice, looksLikeReasoningModel, modelInfo, PROVIDERS, providerForBaseUrl,
} from '../src/data/model-catalog';

describe('model catalog', () => {
  it('every model has coherent metadata', () => {
    for (const p of PROVIDERS) {
      expect(p.models.length).toBeGreaterThan(0);
      for (const m of p.models) {
        expect(m.id).not.toBe('');
        expect(m.inputPer1M).toBeGreaterThanOrEqual(0);
        expect(m.outputPer1M).toBeGreaterThanOrEqual(0);
        expect(m.contextK).toBeGreaterThan(0);
      }
    }
  });

  it('matches a provider by base URL, ignoring a trailing slash', () => {
    expect(providerForBaseUrl('https://api.deepseek.com/v1')?.key).toBe('deepseek');
    expect(providerForBaseUrl('https://api.deepseek.com/v1/')?.key).toBe('deepseek');
    expect(providerForBaseUrl('https://unknown.example/v1')).toBeUndefined();
  });

  it('looks up a model within its provider', () => {
    const m = modelInfo('https://api.deepseek.com/v1', 'deepseek-reasoner');
    expect(m?.reasoning).toBe(true);
    expect(modelInfo('https://api.deepseek.com/v1', 'nope')).toBeUndefined();
  });

  it('flags reasoning-model ids so the budget warning can fire', () => {
    for (const id of ['deepseek-reasoner', 'o1', 'o1-mini', 'o3-mini', 'gpt-o4', 'deepseek-r1', 'Qwen/QwQ-32B', 'my-reasoning-model', 'phi-4-thinking']) {
      expect(looksLikeReasoningModel(id)).toBe(true);
    }
    for (const id of ['deepseek-chat', 'gpt-4o', 'claude-sonnet', 'llama-3.1-70b', 'mixtral-8x7b']) {
      expect(looksLikeReasoningModel(id)).toBe(false);
    }
  });

  it('formats price and context for display', () => {
    expect(formatPrice(0)).toBe('Free');
    expect(formatPrice(0.27)).toBe('$0.27');
    expect(formatPrice(10)).toBe('$10');
    expect(formatContext(128)).toBe('128K');
    expect(formatContext(1000)).toBe('1M');
  });
});
