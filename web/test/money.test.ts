import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from '../src/data/money';

describe('formatMoney', () => {
  it('formats grouped dollars', () => {
    expect(formatMoney(120000)).toBe('$1,200');
    expect(formatMoney(120050)).toBe('$1,200.50');
    expect(formatMoney(0)).toBe('$0');
  });
  it('formats compact', () => {
    expect(formatMoney(1250000, { compact: true })).toBe('$12.5k');
    expect(formatMoney(98000, { compact: true })).toBe('$980');
    expect(formatMoney(0, { compact: true })).toBe('$0');
    expect(formatMoney(2400000, { compact: true })).toBe('$24k');
  });
});

describe('parseMoney', () => {
  it('parses to cents', () => {
    expect(parseMoney('1,200.50')).toBe(120050);
    expect(parseMoney('$980')).toBe(98000);
    expect(parseMoney('1200')).toBe(120000);
  });
  it('rejects invalid input', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('$')).toBeNull();
  });
});
