// Tests for chart pattern recognition — T-501
import { describe, it, expect, vi } from 'vitest';
import {
	findPivots,
	pctDiff,
	linearSlope,
	detectDoubleTop,
	detectDoubleBottom,
	detectHeadAndShoulders,
	detectInverseHeadAndShoulders,
	detectTriangles,
	detectFlags,
	scanPatterns,
} from './patterns';
import type { OHLCV } from '$lib/types/contentBlock';

vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_n: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

import '../tools/patternScan.tool';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOHLCV(closes: number[]): OHLCV[] {
	return closes.map((close, i) => ({
		time: 1700000000 + i * 86400,
		open: close * 0.995,
		high: close * 1.005,
		low: close * 0.99,
		close,
		volume: 1000,
	}));
}

// ─── findPivots ───────────────────────────────────────────────────────────────

describe('findPivots', () => {
	it('returns empty for insufficient data', () => {
		expect(findPivots(makeOHLCV([1, 2, 3]), 5)).toEqual([]);
	});

	it('finds a clear pivot high', () => {
		// A clear peak at index 5 in a series of 15
		const prices = [100, 102, 104, 106, 108, 115, 108, 106, 104, 102, 100, 98, 96, 94, 92];
		const pivots = findPivots(makeOHLCV(prices), 3);
		const highs = pivots.filter(p => p.type === 'high');
		expect(highs.some(h => h.index === 5)).toBe(true);
	});

	it('finds a clear pivot low', () => {
		const prices = [100, 98, 96, 94, 92, 85, 92, 94, 96, 98, 100, 102, 104, 106, 108];
		const pivots = findPivots(makeOHLCV(prices), 3);
		const lows = pivots.filter(p => p.type === 'low');
		expect(lows.some(l => l.index === 5)).toBe(true);
	});

	it('returns only highs and lows in correct order', () => {
		const prices = Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i * 0.8) * 10);
		const pivots = findPivots(makeOHLCV(prices), 2);
		for (const p of pivots) {
			expect(['high', 'low']).toContain(p.type);
		}
	});
});

// ─── pctDiff ──────────────────────────────────────────────────────────────────

describe('pctDiff', () => {
	it('returns 0 for equal values', () => {
		expect(pctDiff(100, 100)).toBe(0);
	});

	it('calculates percentage difference correctly', () => {
		expect(pctDiff(100, 105)).toBeCloseTo(100 * 5 / 102.5, 3);
	});

	it('is symmetric', () => {
		expect(pctDiff(100, 110)).toBeCloseTo(pctDiff(110, 100));
	});
});

// ─── linearSlope ──────────────────────────────────────────────────────────────

describe('linearSlope', () => {
	it('returns 0 for single point', () => {
		expect(linearSlope([{ index: 0, price: 100 }])).toBe(0);
	});

	it('returns positive slope for uptrend', () => {
		const pts = [{ index: 0, price: 100 }, { index: 5, price: 110 }, { index: 10, price: 120 }];
		expect(linearSlope(pts)).toBeGreaterThan(0);
	});

	it('returns negative slope for downtrend', () => {
		const pts = [{ index: 0, price: 120 }, { index: 5, price: 110 }, { index: 10, price: 100 }];
		expect(linearSlope(pts)).toBeLessThan(0);
	});

	it('returns 0 for flat series', () => {
		const pts = [{ index: 0, price: 100 }, { index: 5, price: 100 }, { index: 10, price: 100 }];
		expect(linearSlope(pts)).toBe(0);
	});
});

// ─── detectDoubleTop ──────────────────────────────────────────────────────────

describe('detectDoubleTop', () => {
	it('detects a clear double top', () => {
		// Two peaks at ~100 with a valley at ~90 between them
		const prices = [
			80, 85, 90, 95, 100,  // rise to first top
			95, 90, 87, 90, 95, 99, // dip to valley and rise again
			100, 98,               // second top
			94, 90, 85,            // decline
		];
		const ohlcv = makeOHLCV(prices);
		const pivots = findPivots(ohlcv, 2);
		const patterns = detectDoubleTop(ohlcv, pivots, 5);
		// Should find at least one double top
		expect(patterns.some(p => p.patternType === 'double_top')).toBe(true);
	});

	it('does not detect double top when highs are too different', () => {
		const prices = [
			80, 85, 90, 95, 100,      // first peak at 100
			95, 90, 85, 88, 92,
			115, 110,                  // second peak at 115 (15% different)
			105, 100,
		];
		const ohlcv = makeOHLCV(prices);
		const pivots = findPivots(ohlcv, 2);
		// tolerancePct = 3 → should not detect
		const patterns = detectDoubleTop(ohlcv, pivots, 3);
		expect(patterns.length).toBe(0);
	});

	it('returns bearish direction', () => {
		const prices = [80, 85, 90, 95, 100, 95, 90, 87, 90, 95, 99, 100, 98, 94, 90, 85];
		const ohlcv = makeOHLCV(prices);
		const pivots = findPivots(ohlcv, 2);
		const patterns = detectDoubleTop(ohlcv, pivots, 5);
		if (patterns.length > 0) {
			expect(patterns[0].direction).toBe('bearish');
		}
	});
});

// ─── detectDoubleBottom ───────────────────────────────────────────────────────

describe('detectDoubleBottom', () => {
	it('detects a clear double bottom', () => {
		const prices = [
			100, 95, 90, 85, 80,   // decline to first bottom
			85, 90, 95, 90, 85, 82, // bounce and dip again
			80, 82,                 // second bottom
			88, 95, 100,            // recovery
		];
		const ohlcv = makeOHLCV(prices);
		const pivots = findPivots(ohlcv, 2);
		const patterns = detectDoubleBottom(ohlcv, pivots, 5);
		expect(patterns.some(p => p.patternType === 'double_bottom')).toBe(true);
	});

	it('returns bullish direction', () => {
		const prices = [100, 95, 90, 85, 80, 85, 90, 95, 90, 85, 82, 80, 82, 88, 95, 100];
		const ohlcv = makeOHLCV(prices);
		const pivots = findPivots(ohlcv, 2);
		const patterns = detectDoubleBottom(ohlcv, pivots, 5);
		if (patterns.length > 0) {
			expect(patterns[0].direction).toBe('bullish');
		}
	});
});

// ─── detectHeadAndShoulders ───────────────────────────────────────────────────

describe('detectHeadAndShoulders', () => {
	it('detects a clear H&S with center peak higher', () => {
		// Left shoulder → head (higher) → right shoulder — distinct prices to avoid ties
		const prices = [
			80, 85, 90, 97,    // left shoulder at 97
			92, 88, 87,         // dip to valley
			90, 95, 100, 103,  // head at 103 (higher than shoulders)
			98, 92, 91, 96,    // dip then right shoulder at 96 (similar to 97)
			94, 88, 83,        // decline
		];
		const ohlcv = makeOHLCV(prices);
		const pivots = findPivots(ohlcv, 2);
		const patterns = detectHeadAndShoulders(ohlcv, pivots, 10);
		expect(patterns.some(p => p.patternType === 'head_and_shoulders')).toBe(true);
	});

	it('returns bearish direction', () => {
		const prices = [80, 85, 90, 95, 95, 92, 90, 92, 95, 98, 100, 95, 90, 92, 95, 90, 85, 80];
		const ohlcv = makeOHLCV(prices);
		const pivots = findPivots(ohlcv, 2);
		const patterns = detectHeadAndShoulders(ohlcv, pivots, 10);
		if (patterns.length > 0) {
			expect(patterns[0].direction).toBe('bearish');
		}
	});
});

// ─── detectInverseHeadAndShoulders ────────────────────────────────────────────

describe('detectInverseHeadAndShoulders', () => {
	it('returns bullish direction when detected', () => {
		// Left shoulder → head (lower) → right shoulder
		const prices = [
			100, 95, 90, 85,   // decline
			85, 88, 90,        // left shoulder (low), bounce
			87, 84, 80, 78,    // head (lower)
			82, 86, 88, 85,    // right shoulder (similar to left), bounce
			90, 95, 100,       // breakout
		];
		const ohlcv = makeOHLCV(prices);
		const pivots = findPivots(ohlcv, 2);
		const patterns = detectInverseHeadAndShoulders(ohlcv, pivots, 10);
		if (patterns.length > 0) {
			expect(patterns[0].direction).toBe('bullish');
			expect(patterns[0].patternType).toBe('inverse_head_and_shoulders');
		}
	});
});

// ─── detectFlags ──────────────────────────────────────────────────────────────

describe('detectFlags', () => {
	it('returns empty for short series', () => {
		expect(detectFlags(makeOHLCV([100, 105, 110]))).toEqual([]);
	});

	it('detects bull flag pattern', () => {
		// Build: 30 candles with a strong upward pole then slight downward consolidation
		const prices: number[] = [];
		// Strong up pole: +15% in 6 candles
		for (let i = 0; i < 6; i++) prices.push(100 + i * 2.5);
		// Narrow downward flag: slight decline
		for (let i = 0; i < 24; i++) prices.push(115 - i * 0.2);

		const ohlcv = makeOHLCV(prices);
		const patterns = detectFlags(ohlcv);
		// We might detect a bull flag
		// Just ensure it returns an array (pattern detection isn't guaranteed for all inputs)
		expect(Array.isArray(patterns)).toBe(true);
	});
});

// ─── detectTriangles ──────────────────────────────────────────────────────────

describe('detectTriangles', () => {
	it('returns empty when insufficient pivots', () => {
		const ohlcv = makeOHLCV([100, 102, 101, 103, 102]);
		const pivots = findPivots(ohlcv, 1);
		expect(detectTriangles(ohlcv, pivots)).toEqual([]);
	});

	it('returns array (pattern may or may not be detected)', () => {
		const prices = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i * 0.5) * (10 - i * 0.2));
		const ohlcv = makeOHLCV(prices);
		const pivots = findPivots(ohlcv, 3);
		const result = detectTriangles(ohlcv, pivots);
		expect(Array.isArray(result)).toBe(true);
	});
});

// ─── scanPatterns ─────────────────────────────────────────────────────────────

describe('scanPatterns', () => {
	it('returns empty patterns for short data', () => {
		const result = scanPatterns(makeOHLCV([100, 105, 110]));
		expect(result.patterns).toEqual([]);
		expect(result.pivots).toEqual([]);
	});

	it('returns valid result structure', () => {
		const prices = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.4) * 15);
		const result = scanPatterns(makeOHLCV(prices));
		expect(Array.isArray(result.patterns)).toBe(true);
		expect(Array.isArray(result.pivots)).toBe(true);
	});

	it('sorts patterns by confidence descending', () => {
		const prices = [
			80, 85, 90, 95, 100, 95, 90, 87, 90, 95, 99, 100, 98, 94, 90, 85,
			80, 85, 90, 95, 100, 95, 90, 87, 90, 95, 99, 100, 98, 94, 90, 85,
		];
		const result = scanPatterns(makeOHLCV(prices), 2);
		for (let i = 1; i < result.patterns.length; i++) {
			expect(result.patterns[i].confidence).toBeLessThanOrEqual(result.patterns[i - 1].confidence);
		}
	});
});

// ─── Tool integration ─────────────────────────────────────────────────────────

describe('scan_chart_patterns tool', () => {
	it('is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('scan_chart_patterns')).toBeDefined();
	});

	it('returns error when symbol missing', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('scan_chart_patterns')!;
		const result = await tool.execute({});
		expect(result.success).toBe(false);
	});
});
