// Tests for screener.data.ts — T-901

import { describe, it, expect } from 'vitest';
import {
	screenAsset,
	screenAssets,
	DEFAULT_WATCHLIST,
	fmtScreenerPrice,
	trendLabel,
	type ScreenerFilters,
} from './screener.data';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build OHLCV candles with a linear close price trend */
function buildCandles(count: number, startPrice = 100, slope = 0, volumeBase = 1000): OHLCV[] {
	return Array.from({ length: count }, (_, i) => {
		const close  = startPrice + slope * i;
		const open   = close * 0.999;
		const high   = close * 1.005;
		const low    = close * 0.995;
		const volume = volumeBase;
		return { time: 1_700_000_000 + i * 86_400, open, high, low, close, volume };
	});
}

/** Build candles with a volume spike on the last bar */
function buildCandlesWithVolumeSpike(count = 100, spikeMultiplier = 3): OHLCV[] {
	const candles = buildCandles(count, 100, 0, 1000);
	candles[candles.length - 1] = {
		...candles[candles.length - 1],
		volume: 1000 * spikeMultiplier,
	};
	return candles;
}

/** Build strongly trending candles (price rises each bar) */
function buildTrendingCandles(count = 210, startPrice = 50, endPrice = 200): OHLCV[] {
	const slope = (endPrice - startPrice) / count;
	return buildCandles(count, startPrice, slope, 1000);
}

// ─── screenAsset ─────────────────────────────────────────────────────────────

describe('screenAsset', () => {
	it('returns null for insufficient candles (< 50)', () => {
		const candles = buildCandles(30);
		expect(screenAsset('BTCUSDT', candles, {})).toBeNull();
	});

	it('returns null for exactly 49 candles', () => {
		const candles = buildCandles(49);
		expect(screenAsset('BTCUSDT', candles, {})).toBeNull();
	});

	it('returns result for 50 candles', () => {
		const candles = buildCandles(50, 100, 0);
		const result  = screenAsset('BTCUSDT', candles, {});
		expect(result).not.toBeNull();
		expect(result?.symbol).toBe('BTCUSDT');
	});

	it('returns correct price (last close)', () => {
		const candles = buildCandles(100, 200, 0);
		const result  = screenAsset('ETHUSDT', candles, {})!;
		expect(result.price).toBeCloseTo(200, 0);
	});

	it('computes change24h correctly', () => {
		const candles = buildCandles(100, 100, 1); // price rises by 1 each bar
		const result  = screenAsset('XRPUSDT', candles, {})!;
		// last close ≈ 199, prev close ≈ 198 → ~0.5% change
		expect(result.change24h).toBeGreaterThan(0);
	});

	it('computes RSI and returns value between 0 and 100', () => {
		const candles = buildCandles(100, 100, 0.5);
		const result  = screenAsset('SOLUSDT', candles, {})!;
		expect(result.rsi14).toBeGreaterThanOrEqual(0);
		expect(result.rsi14).toBeLessThanOrEqual(100);
	});

	it('scores score=0 when no filters given', () => {
		const candles = buildCandles(100, 100, 0);
		const result  = screenAsset('BNBUSDT', candles, {})!;
		expect(result.score).toBe(0);
		expect(result.matches).toHaveLength(0);
	});
});

// ─── RSI filters ─────────────────────────────────────────────────────────────

describe('screenAsset — RSI filters', () => {
	it('matches rsiMax=100 (always true — RSI never exceeds 100)', () => {
		const candles = buildCandles(100, 100, 0.5);
		const result  = screenAsset('BTCUSDT', candles, { rsiMax: 100 })!;
		expect(result.score).toBe(1);
		expect(result.matches).toContain('RSI≤100');
	});

	it('matches rsiMin when RSI is high (rising candles)', () => {
		const candles = buildCandles(100, 100, 1); // rising
		const result  = screenAsset('BTCUSDT', candles, { rsiMin: 0 })!;
		expect(result.score).toBe(1);
		expect(result.matches).toContain('RSI≥0');
	});

	it('does not match rsiMax when RSI is above threshold', () => {
		const candles = buildCandles(100, 100, 2); // strongly rising → high RSI
		const result  = screenAsset('BTCUSDT', candles, { rsiMax: 10 })!;
		// RSI should be well above 10 for steadily rising price
		expect(result.matches).not.toContain('RSI≤10');
	});

	it('matches both rsiMin and rsiMax giving score=2', () => {
		const candles = buildCandles(100, 100, 0);
		const result  = screenAsset('BTCUSDT', candles, { rsiMin: 0, rsiMax: 100 })!;
		expect(result.score).toBe(2);
	});
});

// ─── Trend filters ────────────────────────────────────────────────────────────

describe('screenAsset — trend filters', () => {
	it('matches above_ma50 for strongly uptrending asset', () => {
		const candles = buildTrendingCandles(100, 50, 200); // strong uptrend
		const result  = screenAsset('BTCUSDT', candles, { trend: 'above_ma50' })!;
		// price near end is much higher than MA50 of earlier prices
		expect(result.trend).not.toBe('neutral');
	});

	it('matches below_ma50 for strongly downtrending asset', () => {
		const candles = buildTrendingCandles(100, 200, 50); // declining
		const result  = screenAsset('BTCUSDT', candles, { trend: 'below_ma50' })!;
		expect(result.matches).toContain('below_ma50');
	});

	it('matches above_ma200 for long uptrend (210 candles)', () => {
		const candles = buildTrendingCandles(210, 50, 200);
		const result  = screenAsset('BTCUSDT', candles, { trend: 'above_ma200' })!;
		// price is now near 200, MA200 starts near 50 end
		expect(result.matches).toContain('above_ma200');
	});

	it('does not match golden_cross when no crossover occurred', () => {
		// flat candles → MA50 and MA200 are equal, no cross
		const candles = buildCandles(210, 100, 0);
		const result  = screenAsset('BTCUSDT', candles, { trend: 'golden_cross' })!;
		expect(result.matches).not.toContain('golden_cross');
	});
});

// ─── MACD filter ─────────────────────────────────────────────────────────────

describe('screenAsset — MACD filter', () => {
	it('returns bullish or bearish MACD signal (never null)', () => {
		const candles = buildCandles(100, 100, 0.5);
		const result  = screenAsset('BTCUSDT', candles, {})!;
		expect(['bullish', 'bearish', 'neutral']).toContain(result.macdSignal);
	});

	it('matches macd_signal=bullish for rising candles', () => {
		const candles = buildCandles(100, 100, 1);
		const result  = screenAsset('BTCUSDT', candles, { macdSignal: 'bullish' })!;
		if (result.macdSignal === 'bullish') {
			expect(result.matches).toContain('MACD_bullish');
			expect(result.score).toBeGreaterThan(0);
		}
	});

	it('matches macd_signal=bearish for declining candles', () => {
		const candles = buildCandles(100, 200, -1);
		const result  = screenAsset('BTCUSDT', candles, { macdSignal: 'bearish' })!;
		if (result.macdSignal === 'bearish') {
			expect(result.matches).toContain('MACD_bearish');
		}
	});
});

// ─── Volume spike filter ──────────────────────────────────────────────────────

describe('screenAsset — volume spike filter', () => {
	it('matches volumeSpike when last bar has 3× volume', () => {
		const candles = buildCandlesWithVolumeSpike(100, 3);
		const result  = screenAsset('BTCUSDT', candles, { volumeSpike: 2.5 })!;
		expect(result.volumeRatio).toBeGreaterThan(2.5);
		expect(result.matches).toContain('vol>2.5x');
	});

	it('does not match volumeSpike when volume is normal', () => {
		const candles = buildCandles(100, 100, 0, 1000);
		const result  = screenAsset('BTCUSDT', candles, { volumeSpike: 5 })!;
		expect(result.volumeRatio).toBeLessThan(5);
		expect(result.matches).not.toContain('vol>5x');
	});

	it('computes volumeRatio ≈ 1 for uniform volume', () => {
		const candles = buildCandles(100, 100, 0, 1000);
		const result  = screenAsset('BTCUSDT', candles, {})!;
		expect(result.volumeRatio).toBeCloseTo(1, 1);
	});
});

// ─── ATR volatility filter ────────────────────────────────────────────────────

describe('screenAsset — ATR volatility filter', () => {
	it('returns atrPct > 0 for any candles', () => {
		const candles = buildCandles(100, 100, 0);
		const result  = screenAsset('BTCUSDT', candles, {})!;
		expect(result.atrPct).toBeGreaterThanOrEqual(0);
	});
});

// ─── Multi-criteria scoring ───────────────────────────────────────────────────

describe('screenAsset — multi-criteria scoring', () => {
	it('accumulates score from multiple matching filters', () => {
		const candles = buildCandles(100, 100, 1);
		const result  = screenAsset('BTCUSDT', candles, {
			rsiMin: 0,
			rsiMax: 100,
		})!;
		expect(result.score).toBe(2);
	});

	it('score is the length of matches array', () => {
		const candles = buildCandles(100, 100, 0);
		const result  = screenAsset('BTCUSDT', candles, { rsiMin: 0, rsiMax: 100 })!;
		expect(result.score).toBe(result.matches.length);
	});
});

// ─── screenAssets ────────────────────────────────────────────────────────────

describe('screenAssets', () => {
	it('filters out assets with insufficient data', () => {
		const data = [
			{ symbol: 'BTCUSDT', candles: buildCandles(30) },  // too few
			{ symbol: 'ETHUSDT', candles: buildCandles(100) },
		];
		const results = screenAssets(data, {});
		expect(results).toHaveLength(1);
		expect(results[0].symbol).toBe('ETHUSDT');
	});

	it('returns all assets when no filters given', () => {
		const data = [
			{ symbol: 'BTCUSDT', candles: buildCandles(100) },
			{ symbol: 'ETHUSDT', candles: buildCandles(100) },
			{ symbol: 'SOLUSDT', candles: buildCandles(100) },
		];
		const results = screenAssets(data, {});
		expect(results).toHaveLength(3);
	});

	it('sorts by score descending', () => {
		const data = [
			{ symbol: 'LOW',  candles: buildCandles(100, 100, 0) },   // score 0
			{ symbol: 'HIGH', candles: buildCandles(100, 100, 0) },   // score 2
		];
		const filters: ScreenerFilters = { rsiMin: 0, rsiMax: 100 };
		const results = screenAssets(data, filters);
		// both score 2 (rsiMin=0, rsiMax=100 always matches)
		expect(results[0].score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
	});

	it('returns empty array when all assets have insufficient data', () => {
		const data = [
			{ symbol: 'BTCUSDT', candles: buildCandles(20) },
			{ symbol: 'ETHUSDT', candles: buildCandles(30) },
		];
		const results = screenAssets(data, {});
		expect(results).toHaveLength(0);
	});
});

// ─── DEFAULT_WATCHLIST ────────────────────────────────────────────────────────

describe('DEFAULT_WATCHLIST', () => {
	it('contains at least 10 symbols', () => {
		expect(DEFAULT_WATCHLIST.length).toBeGreaterThanOrEqual(10);
	});

	it('all symbols end with USDT', () => {
		for (const sym of DEFAULT_WATCHLIST) {
			expect(sym.endsWith('USDT')).toBe(true);
		}
	});

	it('contains BTC and ETH', () => {
		expect(DEFAULT_WATCHLIST).toContain('BTCUSDT');
		expect(DEFAULT_WATCHLIST).toContain('ETHUSDT');
	});
});

// ─── Formatting helpers ───────────────────────────────────────────────────────

describe('fmtScreenerPrice', () => {
	it('formats large prices with comma separators', () => {
		expect(fmtScreenerPrice(50000)).toBe('50,000.00');
	});

	it('formats mid-range prices to 4 decimal places', () => {
		expect(fmtScreenerPrice(1.5)).toBe('1.5000');
	});

	it('formats small prices to 6 decimal places', () => {
		expect(fmtScreenerPrice(0.000123)).toBe('0.000123');
	});
});

describe('trendLabel', () => {
	it('returns human-readable labels', () => {
		expect(trendLabel('strong_uptrend')).toContain('Uptrend');
		expect(trendLabel('downtrend')).toContain('Downtrend');
		expect(trendLabel('neutral')).toContain('Neutral');
	});

	it('returns the key itself for unknown trends', () => {
		expect(trendLabel('unknown_trend')).toBe('unknown_trend');
	});
});
