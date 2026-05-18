import { describe, expect, it } from 'vitest';
import { computeCost, getPricing } from '../src/pricing.js';

describe('pricing', () => {
  it('prices the two shipped models per the published rate sheet', () => {
    expect(computeCost('claude-sonnet-4-6', { inputTokens: 1_000_000 })).toBeCloseTo(3.0);
    expect(computeCost('claude-sonnet-4-6', { outputTokens: 1_000_000 })).toBeCloseTo(15.0);
    expect(computeCost('claude-sonnet-4-6', { cacheReadTokens: 1_000_000 })).toBeCloseTo(0.3);
    expect(computeCost('claude-opus-4-7', { inputTokens: 1_000_000 })).toBeCloseTo(15.0);
    expect(computeCost('claude-opus-4-7', { outputTokens: 1_000_000 })).toBeCloseTo(75.0);
    expect(computeCost('claude-opus-4-7', { cacheReadTokens: 1_000_000 })).toBeCloseTo(1.5);
  });

  it('sums the three token classes', () => {
    const usd = computeCost('claude-sonnet-4-6', {
      inputTokens: 200_000,
      outputTokens: 50_000,
      cacheReadTokens: 1_000_000,
    });
    // 0.2*3 + 0.05*15 + 1*0.3 = 0.6 + 0.75 + 0.3
    expect(usd).toBeCloseTo(1.65);
  });

  it('falls back by family for unknown point releases', () => {
    expect(getPricing('claude-opus-4-9')).toEqual(getPricing('claude-opus-4-7'));
    expect(getPricing('claude-sonnet-4-99')).toEqual(getPricing('claude-sonnet-4-6'));
    expect(getPricing('claude-haiku-4-5')).toBeDefined();
  });

  it('returns 0 for an unknown model and for zero usage', () => {
    expect(computeCost('gpt-4o', { inputTokens: 1_000_000 })).toBe(0);
    expect(getPricing('gpt-4o')).toBeUndefined();
    expect(computeCost('claude-opus-4-7', {})).toBe(0);
  });
});
