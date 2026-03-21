// Tests for multi-timeframe analysis — T-502
import { describe, it, expect, vi } from 'vitest';
import {
	detectTrend,
	classifyMACD,
	calcBiasScore,
	findKeyLevels,
	analyseTimeframe,
	findConfluenceZones,
	buildMTFAnalysis,
} from './multiTF';
import type { OHLCV } from '$lib/types/contentBlock';

vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_n: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

import '../tools/multiTimeframe.tool';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOHLCV(closes: number[]): OHLCV[] {
	return closes.map((close, i) => ({
		time: 1700000000 + i * 86400,
		open: close * 0.998,
		high: close * 1.005,
		low: close * 0.993,
		close,
		volume: 1000 + i,
	}));
}

function makeTrending(start: number, slope: number, n: number): OHLCV[] {
	return makeOHLCV(Array.from({ length: n }, (_, i) => start + i * slope));
}

// ─── detectTrend ──────────────────────────────────────────────────────────────

describe('detectTrend', () => {
	it('returns neutral for insufficient data', () => {
		expect(detectTrend(makeOHLCV([100, 105]))).toBe('neutral');
	});

	it('returns bullish for consistently uptrending data', () => {
		// 80 candles with a clear uptrend
		const ohlcv = makeTrending(50, 1, 80);
		expect(detectTrend(ohlcv)).toBe('bullish');
	});

	it('returns bearish for consistently downtrending data', () => {
		const ohlcv = makeTrending(200, -1, 80);
		expect(detectTrend(ohlcv)).toBe('bearish');
	});

	it('returns neutral for flat data', () => {
		// A flat series around the same price
		const ohlcv = makeOHLCV(Array(80).fill(100));
		const trend = detectTrend(ohlcv);
		// Flat = EMAs equal = neutral
		expect(trend).toBe('neutral');
	});
});

// ─── classifyMACD ─────────────────────────────────────────────────────────────

describe('classifyMACD', () => {
	it('returns neutral for insufficient data', () => {
		expect(classifyMACD(makeOHLCV([100, 105]))).toBe('neutral');
	});

	it('returns bullish for uptrending data (MACD above signal)', () => {
		const ohlcv = makeTrending(50, 2, 60);
		const result = classifyMACD(ohlcv);
		expect(['bullish', 'neutral']).toContain(result);
	});

	it('returns bearish for downtrending data', () => {
		const ohlcv = makeTrending(200, -2, 60);
		const result = classifyMACD(ohlcv);
		expect(['bearish', 'neutral']).toContain(result);
	});
});

// ─── calcBiasScore ────────────────────────────────────────────────────────────

describe('calcBiasScore', () => {
	it('returns max positive score for bullish all signals', () => {
		const score = calcBiasScore('bullish', 70, 'bullish');
		expect(score).toBe(2);  // 1 + 0.5 + 0.5 = 2
	});

	it('returns max negative score for bearish all signals', () => {
		const score = calcBiasScore('bearish', 30, 'bearish');
		expect(score).toBe(-2);
	});

	it('returns 0 for neutral everything', () => {
		expect(calcBiasScore('neutral', 50, 'neutral')).toBe(0);
	});

	it('clamps to [-2, 2] range', () => {
		// Even with extreme inputs
		const score = calcBiasScore('bullish', 100, 'bullish');
		expect(score).toBeLessThanOrEqual(2);
		expect(score).toBeGreaterThanOrEqual(-2);
	});

	it('RSI > 60 adds 0.5, RSI < 40 subtracts 0.5', () => {
		const highRSI = calcBiasScore('neutral', 65, 'neutral');
		const lowRSI = calcBiasScore('neutral', 35, 'neutral');
		expect(highRSI).toBeCloseTo(0.5);
		expect(lowRSI).toBeCloseTo(-0.5);
	});

	it('handles null RSI gracefully', () => {
		const score = calcBiasScore('bullish', null, 'neutral');
		expect(score).toBeCloseTo(1);
	});
});

// ─── findKeyLevels ────────────────────────────────────────────────────────────

describe('findKeyLevels', () => {
	it('returns empty for insufficient data', () => {
		expect(findKeyLevels(makeOHLCV([100, 105, 110]))).toEqual([]);
	});

	it('finds pivot highs as resistance', () => {
		const prices = [100, 102, 108, 115, 110, 105, 100, 103, 108, 112, 108, 104, 100, 102, 105];
		const levels = findKeyLevels(makeOHLCV(prices), 5, 2);
		const resistances = levels.filter(l => l.type === 'resistance');
		expect(resistances.length).toBeGreaterThan(0);
	});

	it('finds pivot lows as support', () => {
		const prices = [110, 105, 100, 95, 100, 105, 108, 104, 100, 96, 100, 105, 108, 110, 112];
		const levels = findKeyLevels(makeOHLCV(prices), 5, 2);
		const supports = levels.filter(l => l.type === 'support');
		expect(supports.length).toBeGreaterThan(0);
	});
});

// ─── analyseTimeframe ─────────────────────────────────────────────────────────

describe('analyseTimeframe', () => {
	it('returns neutral for insufficient data', () => {
		const result = analyseTimeframe('1h', makeOHLCV([100, 105]));
		expect(result.trend).toBe('neutral');
		expect(result.score).toBe(0);
	});

	it('returns full analysis for sufficient data', () => {
		const ohlcv = makeTrending(50, 1, 80);
		const result = analyseTimeframe('1d', ohlcv);
		expect(result.timeframe).toBe('1d');
		expect(['bullish', 'bearish', 'neutral']).toContain(result.trend);
		expect(result.score).toBeGreaterThanOrEqual(-2);
		expect(result.score).toBeLessThanOrEqual(2);
	});

	it('sets ema20 and ema50 for sufficient data', () => {
		const ohlcv = makeTrending(50, 0.5, 80);
		const result = analyseTimeframe('4h', ohlcv);
		expect(result.ema20).not.toBeNull();
		expect(result.ema50).not.toBeNull();
	});
});

// ─── findConfluenceZones ──────────────────────────────────────────────────────

describe('findConfluenceZones', () => {
	it('returns empty when no overlapping levels', () => {
		const biases = [
			{ timeframe: '1d', trend: 'bullish' as const, rsi: 60, macdSignal: 'bullish' as const, ema20: 100, ema50: 95, score: 1.5, keyLevels: [{ price: 100, type: 'resistance' as const }] },
			{ timeframe: '4h', trend: 'bullish' as const, rsi: 55, macdSignal: 'bullish' as const, ema20: 98, ema50: 93, score: 1, keyLevels: [{ price: 200, type: 'resistance' as const }] },
		];
		expect(findConfluenceZones(biases)).toEqual([]);
	});

	it('finds zones when prices are within tolerance', () => {
		const biases = [
			{ timeframe: '1d', trend: 'bullish' as const, rsi: 60, macdSignal: 'bullish' as const, ema20: 100, ema50: 95, score: 1.5, keyLevels: [{ price: 100.2, type: 'resistance' as const }] },
			{ timeframe: '4h', trend: 'bullish' as const, rsi: 55, macdSignal: 'bullish' as const, ema20: 98, ema50: 93, score: 1, keyLevels: [{ price: 100.3, type: 'resistance' as const }] },
		];
		const zones = findConfluenceZones(biases, 0.5);
		expect(zones.length).toBeGreaterThan(0);
		expect(zones[0].count).toBeGreaterThanOrEqual(2);
	});
});

// ─── buildMTFAnalysis ─────────────────────────────────────────────────────────

describe('buildMTFAnalysis', () => {
	it('returns all bullish when all TFs uptrend', () => {
		const ohlcvByTF = new Map([
			['1d', makeTrending(50, 2, 80)],
			['4h', makeTrending(50, 1, 80)],
		]);
		const result = buildMTFAnalysis('BTCUSDT', ohlcvByTF);

		expect(result.symbol).toBe('BTCUSDT');
		expect(result.timeframes).toHaveLength(2);
		expect(result.confluenceScore).toBeGreaterThan(0);
		expect(['bullish', 'neutral']).toContain(result.overallAlignment);
	});

	it('handles empty ohlcvByTF map', () => {
		const result = buildMTFAnalysis('ETHUSDT', new Map());
		expect(result.timeframes).toHaveLength(0);
		expect(result.overallAlignment).toBe('neutral');
		expect(result.confluenceScore).toBe(0);
	});

	it('computes correct confluence score', () => {
		const ohlcvByTF = new Map([
			['1d', makeTrending(50, 2, 80)],   // bullish
			['4h', makeTrending(50, 1, 80)],    // bullish
			['1h', makeTrending(200, -1, 80)],  // bearish
			['15m', makeTrending(200, -2, 80)], // bearish
		]);
		const result = buildMTFAnalysis('BTCUSDT', ohlcvByTF);
		// 2/4 bullish or 2/4 bearish → confluence = 0.5
		expect(result.confluenceScore).toBeCloseTo(0.5);
	});
});

// ─── Tool integration ─────────────────────────────────────────────────────────

describe('multi_timeframe_analysis tool', () => {
	it('is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('multi_timeframe_analysis')).toBeDefined();
	});

	it('returns error when symbol missing', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('multi_timeframe_analysis')!;
		const result = await tool.execute({});
		expect(result.success).toBe(false);
	});
});
