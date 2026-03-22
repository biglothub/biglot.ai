// Volume Profile Tests — T-801
import { describe, it, expect } from 'vitest';
import { buildVolumeProfile, detectVPOCShift, fmtPrice } from './volumeProfile';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCandle(low: number, high: number, volume: number, time = 0): OHLCV {
	const mid = (low + high) / 2;
	return { time, open: mid, high, low, close: mid, volume };
}

/** Build N candles with uniform price range and equal volume. */
function uniformCandles(n: number, low: number, high: number, vol = 100): OHLCV[] {
	return Array.from({ length: n }, (_, i) => makeCandle(low, high, vol, i));
}

// ─── buildVolumeProfile ────────────────────────────────────────────────────────

describe('buildVolumeProfile', () => {
	it('returns null for empty array', () => {
		expect(buildVolumeProfile([])).toBeNull();
	});

	it('returns null for single candle with zero volume', () => {
		const c = makeCandle(100, 200, 0);
		expect(buildVolumeProfile([c])).toBeNull();
	});

	it('returns a profile for a single candle', () => {
		const c = makeCandle(100, 200, 1000);
		const p = buildVolumeProfile([c], 10);
		expect(p).not.toBeNull();
		expect(p!.priceRangeLow).toBeCloseTo(100);
		expect(p!.priceRangeHigh).toBeCloseTo(200);
		expect(p!.totalVolume).toBeCloseTo(1000);
	});

	it('POC is at the highest-volume bin', () => {
		// Two candles: one spanning 100–110 with vol=1000, one spanning 150–160 with vol=100
		const candles: OHLCV[] = [
			makeCandle(100, 110, 1000),
			makeCandle(150, 160, 100),
		];
		const p = buildVolumeProfile(candles, 20);
		expect(p).not.toBeNull();
		// POC should be in the lower price range where volume is concentrated
		expect(p!.poc).toBeGreaterThanOrEqual(100);
		expect(p!.poc).toBeLessThan(130);
	});

	it('VAH >= POC >= VAL', () => {
		const candles = uniformCandles(10, 100, 200, 500);
		const p = buildVolumeProfile(candles, 20);
		expect(p).not.toBeNull();
		expect(p!.vah).toBeGreaterThanOrEqual(p!.poc);
		expect(p!.poc).toBeGreaterThanOrEqual(p!.val);
	});

	it('value area contains approximately 70% of volume', () => {
		// Many candles across wide range — uniform distribution
		const candles = uniformCandles(100, 100, 200, 100);
		const p = buildVolumeProfile(candles, 20);
		expect(p).not.toBeNull();
		// Count volume within VAL–VAH
		const vaVolume = p!.bins
			.filter(b => b.priceLevel >= p!.val && b.priceLevel <= p!.vah)
			.reduce((s, b) => s + b.volume, 0);
		const vaPct = vaVolume / p!.totalVolume;
		expect(vaPct).toBeGreaterThanOrEqual(0.65);
		expect(vaPct).toBeLessThanOrEqual(1.0);
	});

	it('bin count matches requested bins', () => {
		const candles = uniformCandles(5, 100, 200, 100);
		const p = buildVolumeProfile(candles, 24);
		expect(p!.binCount).toBe(24);
		expect(p!.bins.length).toBe(24);
	});

	it('clamps bins to min 5 and max 200', () => {
		const candles = uniformCandles(5, 100, 200, 100);
		expect(buildVolumeProfile(candles, 1)!.binCount).toBe(5);
		expect(buildVolumeProfile(candles, 999)!.binCount).toBe(200);
	});

	it('all bin volumes sum to total volume', () => {
		const candles = uniformCandles(20, 50, 150, 200);
		const p = buildVolumeProfile(candles, 12);
		expect(p).not.toBeNull();
		const binSum = p!.bins.reduce((s, b) => s + b.volume, 0);
		expect(binSum).toBeCloseTo(p!.totalVolume, 0);
	});

	it('all pct values sum to approximately 100', () => {
		const candles = uniformCandles(10, 100, 200, 100);
		const p = buildVolumeProfile(candles, 10);
		expect(p).not.toBeNull();
		const pctSum = p!.bins.reduce((s, b) => s + b.pct, 0);
		expect(pctSum).toBeCloseTo(100, 1);
	});

	it('each bin priceLow < priceHigh', () => {
		const candles = uniformCandles(5, 100, 200, 100);
		const p = buildVolumeProfile(candles, 10);
		for (const b of p!.bins) {
			expect(b.priceLow).toBeLessThan(b.priceHigh);
		}
	});

	it('priceLevel is midpoint of bin', () => {
		const candles = uniformCandles(5, 100, 200, 100);
		const p = buildVolumeProfile(candles, 10);
		for (const b of p!.bins) {
			expect(b.priceLevel).toBeCloseTo((b.priceLow + b.priceHigh) / 2, 5);
		}
	});

	it('handles high-volume narrow spike correctly (concentrated POC)', () => {
		const candles: OHLCV[] = [
			...uniformCandles(10, 100, 200, 50),    // spread volume
			makeCandle(140, 160, 100000),            // massive spike in middle
		];
		const p = buildVolumeProfile(candles, 20);
		expect(p).not.toBeNull();
		// POC must be near 140–160
		expect(p!.poc).toBeGreaterThanOrEqual(130);
		expect(p!.poc).toBeLessThanOrEqual(170);
	});

	it('valueAreaPct is between 0 and 100', () => {
		const candles = uniformCandles(20, 50, 500, 100);
		const p = buildVolumeProfile(candles, 24);
		expect(p!.valueAreaPct).toBeGreaterThan(0);
		expect(p!.valueAreaPct).toBeLessThanOrEqual(100);
	});

	it('POC bin has the highest volume', () => {
		const candles = uniformCandles(20, 50, 500, 100);
		const p = buildVolumeProfile(candles, 24);
		expect(p).not.toBeNull();
		const pocBin = p!.bins.find(b => Math.abs(b.priceLevel - p!.poc) < 1);
		if (pocBin) {
			for (const b of p!.bins) {
				expect(pocBin.volume).toBeGreaterThanOrEqual(b.volume - 0.001);
			}
		}
	});
});

// ─── detectVPOCShift ──────────────────────────────────────────────────────────

describe('detectVPOCShift', () => {
	it('returns null for fewer than 10 candles', () => {
		const c = uniformCandles(5, 100, 200, 100);
		expect(detectVPOCShift(c)).toBeNull();
	});

	it('detects upward shift when recent candles are higher', () => {
		// First half: volume at 100–110, Second half: volume at 190–200
		const first = Array.from({ length: 10 }, () => makeCandle(100, 110, 1000));
		const second = Array.from({ length: 10 }, () => makeCandle(190, 200, 1000));
		const result = detectVPOCShift([...first, ...second], 20);
		expect(result).not.toBeNull();
		expect(result!.direction).toBe('up');
		expect(result!.currentPOC).toBeGreaterThan(result!.previousPOC);
	});

	it('detects downward shift when recent candles are lower', () => {
		const first  = Array.from({ length: 10 }, () => makeCandle(190, 200, 1000));
		const second = Array.from({ length: 10 }, () => makeCandle(100, 110, 1000));
		const result = detectVPOCShift([...first, ...second], 20);
		expect(result).not.toBeNull();
		expect(result!.direction).toBe('down');
		expect(result!.currentPOC).toBeLessThan(result!.previousPOC);
	});

	it('returns stable when both halves have similar POC', () => {
		const candles = uniformCandles(20, 100, 200, 100);
		const result = detectVPOCShift(candles, 10);
		expect(result).not.toBeNull();
		// With uniform distribution, POC should be similar in both halves
		expect(result!.direction).toBe('stable');
	});

	it('shiftPct sign matches direction', () => {
		const first  = Array.from({ length: 10 }, () => makeCandle(100, 110, 1000));
		const second = Array.from({ length: 10 }, () => makeCandle(190, 200, 1000));
		const result = detectVPOCShift([...first, ...second], 20);
		expect(result).not.toBeNull();
		expect(result!.shiftPct).toBeGreaterThan(0);
	});
});

// ─── fmtPrice ─────────────────────────────────────────────────────────────────

describe('fmtPrice', () => {
	it('formats large prices without decimals', () => {
		expect(fmtPrice(65000)).toMatch(/65,000/);
	});

	it('formats mid prices with 2 decimals', () => {
		expect(fmtPrice(1.23)).toBe('1.23');
	});

	it('formats small prices with 6 decimals', () => {
		expect(fmtPrice(0.000123)).toBe('0.000123');
	});
});
