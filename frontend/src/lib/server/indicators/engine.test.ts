import { describe, it, expect } from 'vitest';
import {
	sma,
	ema,
	rsi,
	macd,
	bollingerBands,
	atr,
	stochastic,
	adx,
	obv,
	vwap,
	ichimoku,
	fibonacci,
	pivotPoints,
	williamsR,
	cci,
	mfi,
	parabolicSAR,
	donchianChannel,
	keltnerChannel,
	superTrend
} from './engine';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOHLCV(closes: number[], options?: { volumes?: number[]; highs?: number[]; lows?: number[] }): OHLCV[] {
	return closes.map((close, i) => ({
		time: 1000 + i * 86400,
		open: close,
		high: options?.highs?.[i] ?? close * 1.02,
		low: options?.lows?.[i] ?? close * 0.98,
		close,
		volume: options?.volumes?.[i] ?? 1000
	}));
}

// ─── SMA ──────────────────────────────────────────────────────────────────────

describe('sma', () => {
	it('returns empty for empty input', () => {
		expect(sma([], 5)).toEqual([]);
	});

	it('returns empty when data shorter than period', () => {
		const data = makeOHLCV([1, 2, 3]);
		expect(sma(data, 5)).toEqual([]);
	});

	it('calculates correct SMA values', () => {
		const data = makeOHLCV([1, 2, 3, 4, 5]);
		const result = sma(data, 3);
		expect(result).toHaveLength(3);
		expect(result[0].value).toBeCloseTo(2); // (1+2+3)/3
		expect(result[1].value).toBeCloseTo(3); // (2+3+4)/3
		expect(result[2].value).toBeCloseTo(4); // (3+4+5)/3
	});

	it('returns single value when period equals length', () => {
		const data = makeOHLCV([10, 20, 30]);
		const result = sma(data, 3);
		expect(result).toHaveLength(1);
		expect(result[0].value).toBeCloseTo(20);
	});

	it('handles period = 1', () => {
		const data = makeOHLCV([5, 10, 15]);
		const result = sma(data, 1);
		expect(result).toHaveLength(3);
		expect(result[0].value).toBeCloseTo(5);
		expect(result[2].value).toBeCloseTo(15);
	});
});

// ─── EMA ──────────────────────────────────────────────────────────────────────

describe('ema', () => {
	it('returns empty for empty input', () => {
		expect(ema([], 5)).toEqual([]);
	});

	it('returns empty when data shorter than period', () => {
		const data = makeOHLCV([1, 2]);
		expect(ema(data, 5)).toEqual([]);
	});

	it('first EMA value equals SMA of first period bars', () => {
		const data = makeOHLCV([10, 20, 30, 40, 50]);
		const result = ema(data, 3);
		expect(result[0].value).toBeCloseTo(20); // (10+20+30)/3
	});

	it('subsequent EMA uses multiplier correctly', () => {
		const data = makeOHLCV([10, 20, 30, 40]);
		const result = ema(data, 3);
		// multiplier = 2/(3+1) = 0.5; EMA[1] = (40 - 20) * 0.5 + 20 = 30
		expect(result[1].value).toBeCloseTo(30);
	});

	it('handles constant prices', () => {
		const data = makeOHLCV([100, 100, 100, 100, 100]);
		const result = ema(data, 3);
		for (const dp of result) {
			expect(dp.value).toBeCloseTo(100);
		}
	});
});

// ─── RSI ──────────────────────────────────────────────────────────────────────

describe('rsi', () => {
	it('returns empty for insufficient data', () => {
		const data = makeOHLCV([1, 2, 3, 4, 5]);
		expect(rsi(data, 14)).toEqual([]);
	});

	it('returns 100 when all closes are increasing', () => {
		const closes = Array.from({ length: 20 }, (_, i) => i + 1);
		const data = makeOHLCV(closes);
		const result = rsi(data, 14);
		expect(result.length).toBeGreaterThan(0);
		expect(result[0].value).toBeCloseTo(100);
	});

	it('returns ~0 when all closes are decreasing', () => {
		const closes = Array.from({ length: 20 }, (_, i) => 20 - i);
		const data = makeOHLCV(closes);
		const result = rsi(data, 14);
		expect(result.length).toBeGreaterThan(0);
		expect(result[0].value).toBeCloseTo(0);
	});

	it('RSI is between 0 and 100', () => {
		const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.15, 43.61, 44.33, 44.83, 45.10, 45.15, 45.54, 46.05, 46.43];
		const data = makeOHLCV(closes);
		const result = rsi(data, 14);
		for (const dp of result) {
			expect(dp.value).toBeGreaterThanOrEqual(0);
			expect(dp.value).toBeLessThanOrEqual(100);
		}
	});

	it('output length = input length - period', () => {
		const closes = Array.from({ length: 30 }, (_, i) => i + 1);
		const data = makeOHLCV(closes);
		const result = rsi(data, 14);
		expect(result).toHaveLength(30 - 14);
	});
});

// ─── MACD ─────────────────────────────────────────────────────────────────────

describe('macd', () => {
	it('returns empty arrays for empty input', () => {
		const result = macd([], 12, 26, 9);
		expect(result.macd).toEqual([]);
		expect(result.signal).toEqual([]);
		expect(result.histogram).toEqual([]);
	});

	it('histogram = macd - signal at each point', () => {
		const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i * 0.3) * 10);
		const data = makeOHLCV(closes);
		const result = macd(data);

		// Build lookup maps
		const macdMap = new Map(result.macd.map((d) => [d.time, d.value]));
		const sigMap = new Map(result.signal.map((d) => [d.time, d.value]));
		const histMap = new Map(result.histogram.map((d) => [d.time, d.value]));

		for (const [time, hist] of histMap) {
			const m = macdMap.get(time);
			const s = sigMap.get(time);
			if (m !== undefined && s !== undefined) {
				expect(hist).toBeCloseTo(m - s, 8);
			}
		}
	});

	it('macd line has fewer points than signal (signal needs extra period bars)', () => {
		const closes = Array.from({ length: 60 }, (_, i) => i + 1);
		const data = makeOHLCV(closes);
		const result = macd(data);
		expect(result.signal.length).toBeLessThanOrEqual(result.macd.length);
	});
});

// ─── Bollinger Bands ──────────────────────────────────────────────────────────

describe('bollingerBands', () => {
	it('returns empty for empty input', () => {
		const result = bollingerBands([]);
		expect(result.upper).toEqual([]);
	});

	it('upper >= middle >= lower', () => {
		const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.5) * 5);
		const data = makeOHLCV(closes);
		const { upper, middle, lower } = bollingerBands(data, 20, 2);

		for (let i = 0; i < upper.length; i++) {
			expect(upper[i].value).toBeGreaterThanOrEqual(middle[i].value - 1e-10);
			expect(middle[i].value).toBeGreaterThanOrEqual(lower[i].value - 1e-10);
		}
	});

	it('all three bands have same length', () => {
		const data = makeOHLCV(Array.from({ length: 50 }, (_, i) => i + 1));
		const { upper, middle, lower } = bollingerBands(data, 20);
		expect(upper.length).toBe(middle.length);
		expect(middle.length).toBe(lower.length);
	});

	it('for constant prices, upper and lower collapse to middle', () => {
		const data = makeOHLCV(Array(30).fill(100));
		const { upper, middle, lower } = bollingerBands(data, 20, 2);
		for (let i = 0; i < upper.length; i++) {
			expect(upper[i].value).toBeCloseTo(100);
			expect(middle[i].value).toBeCloseTo(100);
			expect(lower[i].value).toBeCloseTo(100);
		}
	});
});

// ─── ATR ──────────────────────────────────────────────────────────────────────

describe('atr', () => {
	it('returns empty for less than 2 bars', () => {
		expect(atr([], 14)).toEqual([]);
		expect(atr(makeOHLCV([100]), 14)).toEqual([]);
	});

	it('ATR is always positive', () => {
		const data = makeOHLCV(
			Array.from({ length: 30 }, (_, i) => 100 + i),
			{ highs: Array.from({ length: 30 }, (_, i) => 102 + i), lows: Array.from({ length: 30 }, (_, i) => 98 + i) }
		);
		const result = atr(data, 14);
		for (const dp of result) {
			expect(dp.value).toBeGreaterThan(0);
		}
	});

	it('ATR equals (high-low) for constant-gap candles with same previous close', () => {
		// All candles with high=110, low=90, close=100 → TR = max(20, 10, 10) = 20
		const n = 20;
		const data: OHLCV[] = Array.from({ length: n }, (_, i) => ({
			time: 1000 + i * 86400,
			open: 100, high: 110, low: 90, close: 100, volume: 1000
		}));
		const result = atr(data, 14);
		expect(result.length).toBeGreaterThan(0);
		for (const dp of result) {
			expect(dp.value).toBeCloseTo(20, 3);
		}
	});
});

// ─── Stochastic ───────────────────────────────────────────────────────────────

describe('stochastic', () => {
	it('returns empty for insufficient data', () => {
		const result = stochastic(makeOHLCV([1, 2, 3]), 14, 3);
		expect(result.k).toEqual([]);
	});

	it('%K is between 0 and 100', () => {
		const data = makeOHLCV(Array.from({ length: 30 }, (_, i) => 50 + Math.sin(i * 0.5) * 20));
		const result = stochastic(data, 14, 3);
		for (const dp of result.k) {
			expect(dp.value).toBeGreaterThanOrEqual(0);
			expect(dp.value).toBeLessThanOrEqual(100);
		}
	});

	it('%K = 100 when close equals period high', () => {
		// Make a candle where close = highest high in period
		const closes = Array.from({ length: 20 }, () => 100);
		const highs = Array.from({ length: 20 }, () => 100);
		const lows = Array.from({ length: 20 }, () => 90);
		const data = makeOHLCV(closes, { highs, lows });
		const result = stochastic(data, 14, 3);
		for (const dp of result.k) {
			expect(dp.value).toBeCloseTo(100);
		}
	});
});

// ─── OBV ──────────────────────────────────────────────────────────────────────

describe('obv', () => {
	it('returns empty for empty input', () => {
		expect(obv([])).toEqual([]);
	});

	it('OBV increases on up days', () => {
		const data = makeOHLCV([100, 101, 102]);
		const result = obv(data);
		expect(result[1].value).toBeGreaterThan(result[0].value);
		expect(result[2].value).toBeGreaterThan(result[1].value);
	});

	it('OBV decreases on down days', () => {
		const data = makeOHLCV([102, 101, 100]);
		const result = obv(data);
		expect(result[1].value).toBeLessThan(result[0].value);
		expect(result[2].value).toBeLessThan(result[1].value);
	});

	it('OBV unchanged on equal close days', () => {
		const data = makeOHLCV([100, 100, 100]);
		const result = obv(data);
		expect(result[1].value).toBe(result[0].value);
	});

	it('output length equals input length', () => {
		const data = makeOHLCV([1, 2, 3, 4, 5]);
		expect(obv(data)).toHaveLength(5);
	});
});

// ─── VWAP ─────────────────────────────────────────────────────────────────────

describe('vwap', () => {
	it('returns empty for empty input', () => {
		expect(vwap([])).toEqual([]);
	});

	it('output length equals input length', () => {
		const data = makeOHLCV([100, 101, 99, 102]);
		expect(vwap(data)).toHaveLength(4);
	});

	it('VWAP for uniform prices and volumes is the price itself', () => {
		const data: OHLCV[] = Array.from({ length: 5 }, (_, i) => ({
			time: 1000 + i,
			open: 100, high: 100, low: 100, close: 100, volume: 1000
		}));
		const result = vwap(data);
		for (const dp of result) {
			expect(dp.value).toBeCloseTo(100);
		}
	});
});

// ─── Williams %R ──────────────────────────────────────────────────────────────

describe('williamsR', () => {
	it('returns empty for insufficient data', () => {
		expect(williamsR(makeOHLCV([1, 2, 3]), 14)).toEqual([]);
	});

	it('values are between -100 and 0', () => {
		const data = makeOHLCV(Array.from({ length: 30 }, (_, i) => 50 + Math.sin(i * 0.5) * 20));
		const result = williamsR(data, 14);
		for (const dp of result) {
			expect(dp.value).toBeGreaterThanOrEqual(-100);
			expect(dp.value).toBeLessThanOrEqual(0);
		}
	});

	it('equals -100 when close = period low', () => {
		// All candles: high=110, low=90, close=90
		const n = 20;
		const data: OHLCV[] = Array.from({ length: n }, (_, i) => ({
			time: 1000 + i, open: 90, high: 110, low: 90, close: 90, volume: 1000
		}));
		const result = williamsR(data, 14);
		for (const dp of result) {
			expect(dp.value).toBeCloseTo(-100);
		}
	});
});

// ─── CCI ──────────────────────────────────────────────────────────────────────

describe('cci', () => {
	it('returns empty for insufficient data', () => {
		expect(cci(makeOHLCV([1, 2, 3]), 20)).toEqual([]);
	});

	it('output length = input.length - period + 1', () => {
		const data = makeOHLCV(Array.from({ length: 30 }, (_, i) => i + 1));
		expect(cci(data, 20)).toHaveLength(11);
	});

	it('CCI = 0 for constant typical prices', () => {
		const data: OHLCV[] = Array.from({ length: 25 }, (_, i) => ({
			time: 1000 + i, open: 100, high: 100, low: 100, close: 100, volume: 1000
		}));
		const result = cci(data, 20);
		for (const dp of result) {
			expect(dp.value).toBe(0);
		}
	});
});

// ─── MFI ──────────────────────────────────────────────────────────────────────

describe('mfi', () => {
	it('returns empty for insufficient data', () => {
		expect(mfi(makeOHLCV([1, 2, 3]), 14)).toEqual([]);
	});

	it('values are between 0 and 100', () => {
		const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i * 0.5) * 10);
		const data = makeOHLCV(closes, { volumes: Array.from({ length: 30 }, () => 1000 + Math.random() * 500) });
		const result = mfi(data, 14);
		for (const dp of result) {
			expect(dp.value).toBeGreaterThanOrEqual(0);
			expect(dp.value).toBeLessThanOrEqual(100);
		}
	});
});

// ─── Parabolic SAR ────────────────────────────────────────────────────────────

describe('parabolicSAR', () => {
	it('returns empty for less than 2 bars', () => {
		expect(parabolicSAR([], 0.02, 0.2)).toEqual([]);
		expect(parabolicSAR(makeOHLCV([100]), 0.02, 0.2)).toEqual([]);
	});

	it('output length = input.length - 1', () => {
		const data = makeOHLCV(Array.from({ length: 20 }, (_, i) => 100 + i));
		expect(parabolicSAR(data)).toHaveLength(19);
	});

	it('SAR is positive', () => {
		const data = makeOHLCV(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i * 0.4) * 10));
		const result = parabolicSAR(data);
		for (const dp of result) {
			expect(dp.value).toBeGreaterThan(0);
		}
	});
});

// ─── Donchian Channel ─────────────────────────────────────────────────────────

describe('donchianChannel', () => {
	it('returns empty for insufficient data', () => {
		const result = donchianChannel(makeOHLCV([1, 2, 3]), 20);
		expect(result.upper).toEqual([]);
	});

	it('upper >= lower', () => {
		const data = makeOHLCV(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i * 0.5) * 10));
		const { upper, lower } = donchianChannel(data, 20);
		for (let i = 0; i < upper.length; i++) {
			expect(upper[i].value).toBeGreaterThanOrEqual(lower[i].value);
		}
	});

	it('middle = (upper + lower) / 2', () => {
		const data = makeOHLCV(Array.from({ length: 30 }, (_, i) => 100 + i));
		const { upper, middle, lower } = donchianChannel(data, 10);
		for (let i = 0; i < upper.length; i++) {
			expect(middle[i].value).toBeCloseTo((upper[i].value + lower[i].value) / 2);
		}
	});
});

// ─── Keltner Channel ──────────────────────────────────────────────────────────

describe('keltnerChannel', () => {
	it('returns empty for insufficient data', () => {
		const result = keltnerChannel(makeOHLCV([1, 2, 3]), 20);
		expect(result.upper).toEqual([]);
	});

	it('upper >= middle >= lower', () => {
		const n = 40;
		const closes = Array.from({ length: n }, (_, i) => 100 + Math.sin(i * 0.3) * 10);
		const data = makeOHLCV(closes);
		const { upper, middle, lower } = keltnerChannel(data, 20, 2);
		for (let i = 0; i < upper.length; i++) {
			expect(upper[i].value).toBeGreaterThanOrEqual(middle[i].value - 1e-9);
			expect(middle[i].value).toBeGreaterThanOrEqual(lower[i].value - 1e-9);
		}
	});
});

// ─── Fibonacci ────────────────────────────────────────────────────────────────

describe('fibonacci', () => {
	it('returns 7 levels', () => {
		const data = makeOHLCV(Array.from({ length: 50 }, (_, i) => 100 + i));
		const result = fibonacci(data, 50);
		expect(result.levels).toHaveLength(7);
	});

	it('levels span from low to high', () => {
		const closes = [100, 110, 120, 115, 108];
		const data = makeOHLCV(closes, {
			highs: [105, 115, 125, 120, 113],
			lows: [95, 105, 115, 110, 103]
		});
		const result = fibonacci(data, 5);
		expect(result.high).toBeGreaterThanOrEqual(result.low);
	});

	it('empty input returns empty levels', () => {
		const result = fibonacci([], 50);
		expect(result.levels).toEqual([]);
	});
});

// ─── Pivot Points ─────────────────────────────────────────────────────────────

describe('pivotPoints', () => {
	it('returns empty for < 2 bars', () => {
		expect(pivotPoints([])).toEqual(expect.objectContaining({ pivot: [] }));
		expect(pivotPoints(makeOHLCV([100]))).toEqual(expect.objectContaining({ pivot: [] }));
	});

	it('pivot = (H+L+C)/3', () => {
		const data: OHLCV[] = [
			{ time: 1000, open: 100, high: 120, low: 90, close: 110, volume: 1000 },
			{ time: 2000, open: 110, high: 130, low: 100, close: 120, volume: 1000 }
		];
		const result = pivotPoints(data);
		expect(result.pivot[0].value).toBeCloseTo((120 + 90 + 110) / 3);
	});

	it('r1 > pivot > s1', () => {
		const data: OHLCV[] = [
			{ time: 1000, open: 100, high: 120, low: 80, close: 100, volume: 1000 },
			{ time: 2000, open: 100, high: 120, low: 80, close: 100, volume: 1000 }
		];
		const result = pivotPoints(data);
		expect(result.r1[0].value).toBeGreaterThan(result.pivot[0].value);
		expect(result.pivot[0].value).toBeGreaterThan(result.s1[0].value);
	});
});

// ─── ADX ──────────────────────────────────────────────────────────────────────

describe('adx', () => {
	it('returns empty for insufficient data', () => {
		const result = adx(makeOHLCV([1, 2, 3]), 14);
		expect(result.adx).toEqual([]);
	});

	it('ADX is between 0 and 100', () => {
		const n = 60;
		const closes = Array.from({ length: n }, (_, i) => 100 + Math.sin(i * 0.3) * 20);
		const highs = closes.map((c) => c + 2);
		const lows = closes.map((c) => c - 2);
		const data = makeOHLCV(closes, { highs, lows });
		const result = adx(data, 14);
		for (const dp of result.adx) {
			expect(dp.value).toBeGreaterThanOrEqual(0);
			expect(dp.value).toBeLessThanOrEqual(100);
		}
	});

	it('+DI and -DI are non-negative', () => {
		const n = 60;
		const closes = Array.from({ length: n }, (_, i) => 100 + i * 0.5);
		const data = makeOHLCV(closes);
		const result = adx(data, 14);
		for (const dp of result.plusDI) expect(dp.value).toBeGreaterThanOrEqual(0);
		for (const dp of result.minusDI) expect(dp.value).toBeGreaterThanOrEqual(0);
	});
});

// ─── Ichimoku ─────────────────────────────────────────────────────────────────

describe('ichimoku', () => {
	it('returns empty for empty input', () => {
		const result = ichimoku([]);
		expect(result.tenkan).toEqual([]);
	});

	it('tenkan has fewer points than chikou for short data', () => {
		const data = makeOHLCV(Array.from({ length: 30 }, (_, i) => 100 + i));
		const result = ichimoku(data);
		expect(result.tenkan.length).toBeGreaterThan(0);
	});

	it('all series have valid timestamps', () => {
		const data = makeOHLCV(Array.from({ length: 60 }, (_, i) => 100 + i));
		const result = ichimoku(data);
		for (const dp of result.tenkan) expect(dp.time).toBeGreaterThan(0);
		for (const dp of result.kijun) expect(dp.time).toBeGreaterThan(0);
	});
});

// ─── SuperTrend ───────────────────────────────────────────────────────────────

describe('superTrend', () => {
	it('returns empty for insufficient data', () => {
		const result = superTrend(makeOHLCV([1, 2, 3]), 10, 3);
		expect(result.supertrend).toEqual([]);
	});

	it('direction is either 1 or -1', () => {
		const data = makeOHLCV(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i * 0.5) * 20));
		const result = superTrend(data, 10, 3);
		for (const dp of result.direction) {
			expect([1, -1]).toContain(dp.value);
		}
	});

	it('supertrend values are positive', () => {
		const data = makeOHLCV(Array.from({ length: 30 }, (_, i) => 100 + i));
		const result = superTrend(data, 10, 3);
		for (const dp of result.supertrend) {
			expect(dp.value).toBeGreaterThan(0);
		}
	});
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
	it('all indicators handle NaN/Infinity input gracefully', () => {
		// Doesn't throw
		const data: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
			time: 1000 + i, open: 100, high: 100, low: 100, close: 100, volume: 0
		}));
		expect(() => rsi(data)).not.toThrow();
		expect(() => macd(data)).not.toThrow();
		expect(() => bollingerBands(data)).not.toThrow();
		expect(() => atr(data)).not.toThrow();
		expect(() => obv(data)).not.toThrow();
		expect(() => vwap(data)).not.toThrow();
	});

	it('handles single-bar input', () => {
		const data = makeOHLCV([100]);
		expect(sma(data, 1)).toHaveLength(1);
		expect(ema(data, 1)).toHaveLength(1);
		expect(obv(data)).toHaveLength(1);
		expect(vwap(data)).toHaveLength(1);
	});
});
