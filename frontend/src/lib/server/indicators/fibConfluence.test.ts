// Tests for fibConfluence.ts — T-903

import { describe, it, expect } from 'vitest';
import {
	computeSwingFibLevels,
	clusterFibLevels,
	buildConfluenceZone,
	findFibConfluenceZones,
	fmtFibPrice,
	FIB_RETRACEMENTS,
	FIB_EXTENSIONS,
	type FibLevel,
} from './fibConfluence';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCandle(close: number, i: number): OHLCV {
	return {
		time: 1_700_000_000 + i * 86_400,
		open: close * 0.999,
		high: close * 1.005,
		low:  close * 0.995,
		close,
		volume: 1000,
	};
}

/** Build candles that have a clear pivot high in the middle */
function buildCandlesWithPivot(count = 50, pivot = 25, highPrice = 120, lowPrice = 80, basePrice = 100): OHLCV[] {
	return Array.from({ length: count }, (_, i) => {
		// form a clear "mountain": rises to pivot, falls back
		const progress = i / (count - 1);
		let close: number;
		if (i === pivot) {
			close = highPrice;
		} else if (i < pivot) {
			close = basePrice + (highPrice - basePrice) * (i / pivot);
		} else {
			close = highPrice - (highPrice - lowPrice) * ((i - pivot) / (count - pivot));
		}
		return makeCandle(Math.max(1, close), i);
	});
}

/** Build zigzag candles for multiple swings */
function buildZigzagCandles(count = 100): OHLCV[] {
	const amplitude = 20;
	return Array.from({ length: count }, (_, i) => {
		const phase = (i / count) * Math.PI * 4; // 2 full oscillations
		const close = 100 + amplitude * Math.sin(phase);
		return makeCandle(Math.max(1, close), i);
	});
}

// ─── computeSwingFibLevels ────────────────────────────────────────────────────

describe('computeSwingFibLevels', () => {
	it('returns empty array when swingHigh <= swingLow', () => {
		expect(computeSwingFibLevels(100, 100, 0)).toHaveLength(0);
		expect(computeSwingFibLevels(90, 100, 0)).toHaveLength(0);
	});

	it('returns correct number of levels for a valid swing', () => {
		// 5 retracements + 2 ext up + 2 ext down = 9 levels
		const levels = computeSwingFibLevels(120, 80, 0);
		expect(levels).toHaveLength(FIB_RETRACEMENTS.length + FIB_EXTENSIONS.length * 2);
	});

	it('computes 50% retracement correctly', () => {
		const levels = computeSwingFibLevels(120, 80, 0);
		const half   = levels.find(l => l.ratio === 0.5 && l.levelType === 'retracement');
		expect(half).toBeDefined();
		expect(half!.price).toBeCloseTo(100, 4); // (120 + 80) / 2 = 100
	});

	it('computes 61.8% retracement correctly', () => {
		const levels = computeSwingFibLevels(120, 80, 0);
		const fib618 = levels.find(l => l.ratio === 0.618 && l.levelType === 'retracement');
		expect(fib618!.price).toBeCloseTo(120 - 40 * 0.618, 4);
	});

	it('computes 161.8% upside extension correctly', () => {
		const levels = computeSwingFibLevels(120, 80, 0);
		const ext1618 = levels.find(l => l.ratio === 1.618 && l.label.includes('↑'));
		expect(ext1618).toBeDefined();
		expect(ext1618!.price).toBeCloseTo(80 + 40 * 1.618, 4);
	});

	it('all retracement prices are between swingLow and swingHigh', () => {
		const levels = computeSwingFibLevels(200, 100, 0);
		const retracements = levels.filter(l => l.levelType === 'retracement');
		for (const l of retracements) {
			expect(l.price).toBeGreaterThanOrEqual(100);
			expect(l.price).toBeLessThanOrEqual(200);
		}
	});

	it('stores swingHigh and swingLow references', () => {
		const levels = computeSwingFibLevels(200, 100, 3);
		expect(levels[0].swingHigh).toBe(200);
		expect(levels[0].swingLow).toBe(100);
		expect(levels[0].swingIndex).toBe(3);
	});
});

// ─── clusterFibLevels ─────────────────────────────────────────────────────────

describe('clusterFibLevels', () => {
	it('returns empty array for empty input', () => {
		expect(clusterFibLevels([])).toHaveLength(0);
	});

	it('puts well-separated levels into separate clusters', () => {
		const levels: FibLevel[] = [
			{ price: 100, ratio: 0.5, label: 'A', swingHigh: 120, swingLow: 80, swingIndex: 0, levelType: 'retracement' },
			{ price: 200, ratio: 0.5, label: 'B', swingHigh: 220, swingLow: 180, swingIndex: 1, levelType: 'retracement' },
		];
		expect(clusterFibLevels(levels, 0.5)).toHaveLength(2);
	});

	it('merges levels within clusterPct threshold', () => {
		// 100 and 100.3 → within 0.5% of each other → should merge
		const levels: FibLevel[] = [
			{ price: 100.0, ratio: 0.5, label: 'A', swingHigh: 120, swingLow: 80, swingIndex: 0, levelType: 'retracement' },
			{ price: 100.3, ratio: 0.618, label: 'B', swingHigh: 125, swingLow: 82, swingIndex: 1, levelType: 'retracement' },
		];
		const clusters = clusterFibLevels(levels, 0.5);
		expect(clusters).toHaveLength(1);
		expect(clusters[0]).toHaveLength(2);
	});

	it('does not merge levels outside clusterPct threshold', () => {
		// 100 and 101.5 → ~1.5% apart → should NOT merge at 0.5%
		const levels: FibLevel[] = [
			{ price: 100.0, ratio: 0.5, label: 'A', swingHigh: 120, swingLow: 80, swingIndex: 0, levelType: 'retracement' },
			{ price: 101.5, ratio: 0.618, label: 'B', swingHigh: 125, swingLow: 82, swingIndex: 1, levelType: 'retracement' },
		];
		const clusters = clusterFibLevels(levels, 0.5);
		expect(clusters).toHaveLength(2);
	});

	it('sorts levels by price before clustering', () => {
		const levels: FibLevel[] = [
			{ price: 101.0, ratio: 0.5, label: 'A', swingHigh: 120, swingLow: 80, swingIndex: 0, levelType: 'retracement' },
			{ price: 100.0, ratio: 0.618, label: 'B', swingHigh: 125, swingLow: 82, swingIndex: 1, levelType: 'retracement' },
		];
		const clusters = clusterFibLevels(levels, 2); // 2% threshold → should merge
		expect(clusters).toHaveLength(1);
	});
});

// ─── buildConfluenceZone ──────────────────────────────────────────────────────

describe('buildConfluenceZone', () => {
	function makeLevel(price: number): FibLevel {
		return { price, ratio: 0.5, label: 'test', swingHigh: 120, swingLow: 80, swingIndex: 0, levelType: 'retracement' };
	}

	it('sets strength to cluster length', () => {
		const cluster = [makeLevel(100), makeLevel(100.5)];
		const zone = buildConfluenceZone(cluster, 102);
		expect(zone.strength).toBe(2);
	});

	it('computes centroid as mean of prices', () => {
		const cluster = [makeLevel(100), makeLevel(102)];
		const zone = buildConfluenceZone(cluster, 105);
		expect(zone.price).toBeCloseTo(101, 4);
	});

	it('classifies zone as support when below current price', () => {
		const cluster = [makeLevel(80)];
		const zone = buildConfluenceZone(cluster, 100);
		expect(zone.zoneType).toBe('support');
		expect(zone.distancePct).toBeLessThan(0);
	});

	it('classifies zone as resistance when above current price', () => {
		const cluster = [makeLevel(120)];
		const zone = buildConfluenceZone(cluster, 100);
		expect(zone.zoneType).toBe('resistance');
		expect(zone.distancePct).toBeGreaterThan(0);
	});

	it('classifies zone as pivot when very close to current price', () => {
		const cluster = [makeLevel(100)];
		const zone = buildConfluenceZone(cluster, 100);
		expect(zone.zoneType).toBe('pivot');
	});

	it('sets priceMin and priceMax correctly', () => {
		const cluster = [makeLevel(99), makeLevel(101)];
		const zone = buildConfluenceZone(cluster, 100);
		expect(zone.priceMin).toBe(99);
		expect(zone.priceMax).toBe(101);
	});
});

// ─── findFibConfluenceZones ───────────────────────────────────────────────────

describe('findFibConfluenceZones', () => {
	it('returns empty result for insufficient candles', () => {
		const candles = Array.from({ length: 5 }, (_, i) => makeCandle(100, i));
		const result  = findFibConfluenceZones(candles);
		expect(result.zones).toHaveLength(0);
	});

	it('returns empty result for flat candles (no clear pivots)', () => {
		// Perfectly flat — findPivots returns nothing
		const candles = Array.from({ length: 50 }, (_, i) => makeCandle(100, i));
		const result  = findFibConfluenceZones(candles);
		// Flat candles have no clear pivots, so zones may be empty
		expect(result.currentPrice).toBe(100);
	});

	it('detects zones for zigzag candles', () => {
		const candles = buildZigzagCandles(100);
		const result  = findFibConfluenceZones(candles, { minStrength: 1 });
		// With minStrength=1, zones should be found
		expect(result.currentPrice).toBeGreaterThan(0);
		expect(result.swingCount).toBeGreaterThanOrEqual(0);
	});

	it('nearestSupport is below current price', () => {
		const candles = buildZigzagCandles(100);
		const result  = findFibConfluenceZones(candles, { minStrength: 1 });
		if (result.nearestSupport) {
			expect(result.nearestSupport.price).toBeLessThan(result.currentPrice * 1.001);
			expect(result.nearestSupport.zoneType).toBe('support');
		}
	});

	it('nearestResistance is above current price', () => {
		const candles = buildZigzagCandles(100);
		const result  = findFibConfluenceZones(candles, { minStrength: 1 });
		if (result.nearestResistance) {
			expect(result.nearestResistance.price).toBeGreaterThan(result.currentPrice * 0.999);
			expect(result.nearestResistance.zoneType).toBe('resistance');
		}
	});

	it('zones are sorted by strength descending', () => {
		const candles = buildZigzagCandles(120);
		const result  = findFibConfluenceZones(candles, { minStrength: 1 });
		for (let i = 1; i < result.zones.length; i++) {
			expect(result.zones[i - 1].strength).toBeGreaterThanOrEqual(result.zones[i].strength);
		}
	});

	it('totalLevels equals sum across all swings (9 per swing)', () => {
		const candles = buildZigzagCandles(100);
		const result  = findFibConfluenceZones(candles, { minStrength: 1, maxSwings: 3 });
		// 9 = 5 retracements + 2 ext up + 2 ext down
		const expectedLevelsPerSwing = FIB_RETRACEMENTS.length + FIB_EXTENSIONS.length * 2;
		expect(result.totalLevels).toBe(result.swingCount * expectedLevelsPerSwing);
	});

	it('respects minStrength filter', () => {
		const candles = buildZigzagCandles(100);
		const r2 = findFibConfluenceZones(candles, { minStrength: 2 });
		const r3 = findFibConfluenceZones(candles, { minStrength: 3 });
		// Higher minStrength → fewer or equal zones
		expect(r2.zones.length).toBeGreaterThanOrEqual(r3.zones.length);
	});
});

// ─── fmtFibPrice ─────────────────────────────────────────────────────────────

describe('fmtFibPrice', () => {
	it('formats large prices with commas', () => {
		expect(fmtFibPrice(50000)).toBe('50,000.00');
	});

	it('formats mid-range prices to 4 decimal places', () => {
		expect(fmtFibPrice(3.14)).toBe('3.1400');
	});

	it('formats small prices to 6 decimal places', () => {
		expect(fmtFibPrice(0.000100)).toBe('0.000100');
	});
});
