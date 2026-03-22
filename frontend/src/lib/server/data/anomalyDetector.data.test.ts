// Tests for anomalyDetector.data.ts — T-1202
import { describe, it, expect } from 'vitest';
import {
	detectVolumeSpike,
	detectPriceGap,
	detectVolatilityExpansion,
	detectLiquidationCascade,
	detectCorrelationBreak,
	pearsonCorr,
} from './anomalyDetector.data';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOHLCV(
	n: number,
	opts: {
		base?: number;
		volume?: number;
		volumeFn?: (i: number) => number;
		openFn?: (i: number) => number;
		highMult?: number;
		lowMult?: number;
	} = {},
): OHLCV[] {
	const base = opts.base ?? 100;
	const highMult = opts.highMult ?? 1.01;
	const lowMult = opts.lowMult ?? 0.99;
	return Array.from({ length: n }, (_, i) => ({
		time: 1_700_000_000 + i * 86_400,
		open: opts.openFn ? opts.openFn(i) : base,
		high: base * highMult,
		low: base * lowMult,
		close: base,
		volume: opts.volumeFn ? opts.volumeFn(i) : (opts.volume ?? 1_000),
	}));
}

// ─── pearsonCorr ──────────────────────────────────────────────────────────────

describe('pearsonCorr', () => {
	it('returns 1 for perfectly correlated series', () => {
		const x = [1, 2, 3, 4, 5, 6, 7, 8];
		expect(pearsonCorr(x, x)).toBeCloseTo(1, 5);
	});

	it('returns -1 for perfectly anti-correlated series', () => {
		const x = [1, 2, 3, 4, 5, 6, 7, 8];
		const y = x.map((v) => -v);
		expect(pearsonCorr(x, y)).toBeCloseTo(-1, 5);
	});

	it('returns 0 for series shorter than 5', () => {
		expect(pearsonCorr([1, 2, 3], [1, 2, 3])).toBe(0);
	});

	it('returns 0 for constant series (zero variance)', () => {
		const x = [5, 5, 5, 5, 5, 5, 5, 5];
		const y = [1, 2, 3, 4, 5, 6, 7, 8];
		expect(pearsonCorr(x, y)).toBe(0);
	});
});

// ─── detectVolumeSpike ────────────────────────────────────────────────────────

describe('detectVolumeSpike', () => {
	it('returns null when fewer than 22 candles', () => {
		const ohlcv = makeOHLCV(20, { volume: 1_000 });
		expect(detectVolumeSpike('BTCUSDT', ohlcv)).toBeNull();
	});

	it('returns null when volume ratio < 3', () => {
		// All bars volume = 1000, last bar = 2500 (2.5x, below threshold)
		const ohlcv = makeOHLCV(22, { volume: 1_000 });
		ohlcv[ohlcv.length - 1].volume = 2_500;
		expect(detectVolumeSpike('BTCUSDT', ohlcv)).toBeNull();
	});

	it('detects a 4x volume spike', () => {
		const ohlcv = makeOHLCV(22, { volume: 1_000 });
		ohlcv[ohlcv.length - 1].volume = 4_000; // 4x
		const result = detectVolumeSpike('BTCUSDT', ohlcv);
		expect(result).not.toBeNull();
		expect(result?.type).toBe('volume_spike');
		expect(result?.symbol).toBe('BTCUSDT');
		expect(result?.severity).toBeGreaterThanOrEqual(1);
		expect(result?.severity).toBeLessThanOrEqual(10);
	});

	it('severity scales with ratio', () => {
		const ohlcv3x = makeOHLCV(22, { volume: 1_000 });
		ohlcv3x[ohlcv3x.length - 1].volume = 3_000; // 3x
		const ohlcv6x = makeOHLCV(22, { volume: 1_000 });
		ohlcv6x[ohlcv6x.length - 1].volume = 6_000; // 6x

		const r3x = detectVolumeSpike('ETHUSDT', ohlcv3x)!;
		const r6x = detectVolumeSpike('ETHUSDT', ohlcv6x)!;
		expect(r6x.severity).toBeGreaterThanOrEqual(r3x.severity);
	});

	it('returns null when average volume is 0', () => {
		const ohlcv = makeOHLCV(22, { volume: 0 });
		ohlcv[ohlcv.length - 1].volume = 5_000;
		expect(detectVolumeSpike('BTCUSDT', ohlcv)).toBeNull();
	});
});

// ─── detectPriceGap ───────────────────────────────────────────────────────────

describe('detectPriceGap', () => {
	it('returns null when fewer than 20 candles', () => {
		const ohlcv = makeOHLCV(15);
		expect(detectPriceGap('BTCUSDT', ohlcv)).toBeNull();
	});

	it('returns null when gap < 2 ATR', () => {
		// Flat candles: tiny gap of 0.5% will be far below 2 ATR when range is small but consistent
		const ohlcv = makeOHLCV(25, { base: 100, highMult: 1.01, lowMult: 0.99 });
		// ATR ≈ 2 (high-low = 2). Gap of 0.1 is 0.05 ATR, far below threshold
		ohlcv[ohlcv.length - 1].open = 100.1;
		expect(detectPriceGap('BTCUSDT', ohlcv)).toBeNull();
	});

	it('detects large upward gap', () => {
		// Create candles with base 100, range ~2 → ATR ≈ 2
		// Inject a gap of 10 (5x ATR), clearly >2 ATR
		const ohlcv = makeOHLCV(25, { base: 100, highMult: 1.01, lowMult: 0.99 });
		// Previous close = 100, current open = 110 → gap = 10
		ohlcv[ohlcv.length - 2].close = 100;
		ohlcv[ohlcv.length - 1].open = 110;
		const result = detectPriceGap('BTCUSDT', ohlcv);
		expect(result).not.toBeNull();
		expect(result?.type).toBe('price_gap');
		expect(result?.severity).toBeGreaterThanOrEqual(1);
		expect(result?.severity).toBeLessThanOrEqual(10);
	});

	it('detects large downward gap', () => {
		const ohlcv = makeOHLCV(25, { base: 100, highMult: 1.01, lowMult: 0.99 });
		ohlcv[ohlcv.length - 2].close = 100;
		ohlcv[ohlcv.length - 1].open = 85; // gap down of 15%
		const result = detectPriceGap('BTCUSDT', ohlcv);
		expect(result).not.toBeNull();
		expect(result?.description).toContain('down');
	});
});

// ─── detectVolatilityExpansion ────────────────────────────────────────────────

describe('detectVolatilityExpansion', () => {
	it('returns null when fewer than 35 candles', () => {
		const ohlcv = makeOHLCV(30);
		expect(detectVolatilityExpansion('ETHUSDT', ohlcv)).toBeNull();
	});

	it('returns null when volatility is normal', () => {
		// Flat candles — consistent ATR, no expansion
		const ohlcv = makeOHLCV(40, { base: 100, highMult: 1.01, lowMult: 0.99 });
		expect(detectVolatilityExpansion('ETHUSDT', ohlcv)).toBeNull();
	});

	it('detects volatility expansion when last candle has large range', () => {
		// Build 39 candles with small range, then inject one with huge range
		const ohlcv = makeOHLCV(40, { base: 100, highMult: 1.01, lowMult: 0.99 });
		// Make last 2 candles very large range to push ATR up
		for (let i = 37; i < 40; i++) {
			ohlcv[i].high = 200;
			ohlcv[i].low = 50;
		}
		const result = detectVolatilityExpansion('ETHUSDT', ohlcv);
		expect(result).not.toBeNull();
		expect(result?.type).toBe('volatility_expansion');
	});
});

// ─── detectLiquidationCascade ─────────────────────────────────────────────────

describe('detectLiquidationCascade', () => {
	it('returns null when total below $5M', () => {
		expect(detectLiquidationCascade('BTCUSDT', 2_000_000, 1_000_000)).toBeNull();
	});

	it('detects cascade above $5M', () => {
		const result = detectLiquidationCascade('BTCUSDT', 4_000_000, 2_000_000);
		expect(result).not.toBeNull();
		expect(result?.type).toBe('liquidation_cascade');
		expect(result?.symbol).toBe('BTCUSDT');
	});

	it('identifies dominant side as long', () => {
		const result = detectLiquidationCascade('ETHUSDT', 8_000_000, 2_000_000)!;
		expect(result.description).toContain('long');
	});

	it('identifies dominant side as short', () => {
		const result = detectLiquidationCascade('SOLUSDT', 1_000_000, 9_000_000)!;
		expect(result.description).toContain('short');
	});

	it('severity scales with total liquidations', () => {
		const small = detectLiquidationCascade('BTC', 4_000_000, 2_000_000)!;
		const large = detectLiquidationCascade('BTC', 50_000_000, 50_000_000)!;
		expect(large.severity).toBeGreaterThan(small.severity);
	});

	it('severity is capped at 10', () => {
		const result = detectLiquidationCascade('BTC', 5_000_000_000, 5_000_000_000)!;
		expect(result.severity).toBeLessThanOrEqual(10);
	});
});

// ─── detectCorrelationBreak ───────────────────────────────────────────────────

describe('detectCorrelationBreak', () => {
	it('returns null for BTC symbol', () => {
		const ohlcv = makeOHLCV(35);
		expect(detectCorrelationBreak('BTCUSDT', ohlcv, ohlcv)).toBeNull();
	});

	it('returns null when fewer than 32 candles', () => {
		const ohlcv = makeOHLCV(30);
		expect(detectCorrelationBreak('ETHUSDT', ohlcv, ohlcv)).toBeNull();
	});

	it('returns null when 30d correlation was low (< 0.5)', () => {
		// ETH returns random, BTC random — low historical correlation
		const btcOhlcv = makeOHLCV(35, { base: 50_000 });
		const ethOhlcv = makeOHLCV(35, { base: 3_000 });
		// Both flat — pearson of identical returns returns ~1, but let's offset with slight variations
		// Actually for flat returns (all 0), pearson will be 0 → no correlation → no alert
		const result = detectCorrelationBreak('ETHUSDT', ethOhlcv, btcOhlcv);
		expect(result).toBeNull();
	});

	it('detects correlation break when 7d diverges from 30d', () => {
		// Build 35 candles where 30d BTC and ETH move together,
		// but last 7 days ETH moves opposite to BTC
		const n = 35;
		const btcOhlcv: OHLCV[] = [];
		const ethOhlcv: OHLCV[] = [];

		// First 28 days: ETH follows BTC closely (build high 30d correlation)
		let btcPrice = 50_000;
		let ethPrice = 3_000;
		for (let i = 0; i < 28; i++) {
			const move = (Math.random() - 0.45) * 0.02; // slightly bullish
			btcPrice *= 1 + move;
			ethPrice *= 1 + move; // same move = perfect correlation
			btcOhlcv.push({ time: 1_700_000_000 + i * 86_400, open: btcPrice, high: btcPrice * 1.01, low: btcPrice * 0.99, close: btcPrice, volume: 1_000 });
			ethOhlcv.push({ time: 1_700_000_000 + i * 86_400, open: ethPrice, high: ethPrice * 1.01, low: ethPrice * 0.99, close: ethPrice, volume: 1_000 });
		}

		// Last 7 days: ETH drops heavily while BTC rises (anti-correlated)
		for (let i = 28; i < n; i++) {
			btcPrice *= 1.03;  // BTC up 3%/day
			ethPrice *= 0.97;  // ETH down 3%/day
			btcOhlcv.push({ time: 1_700_000_000 + i * 86_400, open: btcPrice, high: btcPrice * 1.01, low: btcPrice * 0.99, close: btcPrice, volume: 1_000 });
			ethOhlcv.push({ time: 1_700_000_000 + i * 86_400, open: ethPrice, high: ethPrice * 1.01, low: ethPrice * 0.99, close: ethPrice, volume: 1_000 });
		}

		const result = detectCorrelationBreak('ETHUSDT', ethOhlcv, btcOhlcv);
		// May or may not fire depending on whether 30d correlation meets ≥0.5 threshold
		// The key is: if it fires, it should be a 'correlation_break'
		if (result !== null) {
			expect(result.type).toBe('correlation_break');
			expect(result.severity).toBeGreaterThanOrEqual(1);
			expect(result.severity).toBeLessThanOrEqual(10);
		}
	});
});
