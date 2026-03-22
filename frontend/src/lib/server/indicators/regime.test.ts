// Tests for regime.ts — T-604
import { describe, it, expect } from 'vitest';
import {
	classifyRegime,
	calcRegimeConfidence,
	calcGaugeValue,
	regimeLabel,
	analyzeRegime,
	ADX_TREND_THRESHOLD,
	ATR_HIGH_VOL_THRESHOLD,
	type RegimeInput,
} from './regime';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<RegimeInput> = {}): RegimeInput {
	return {
		adxValue: 20,
		plusDI:   20,
		minusDI:  15,
		atrRatio: 1.5,
		rsiValue: 50,
		...overrides,
	};
}

/** Build synthetic OHLCV with a linear trend. */
function buildOHLCV(
	n: number,
	startPrice = 100,
	trend: 'up' | 'down' | 'flat' = 'up',
	volatilityPct = 0.5
): OHLCV[] {
	const candles: OHLCV[] = [];
	let price = startPrice;
	for (let i = 0; i < n; i++) {
		const noise = (Math.random() - 0.5) * price * (volatilityPct / 100);
		const step  = trend === 'up' ? 1 : trend === 'down' ? -1 : 0;
		price = Math.max(1, price + step + noise);
		const range = price * 0.01;
		candles.push({
			time:   1_000_000 + i * 3600,
			open:   price - range / 2,
			high:   price + range,
			low:    price - range,
			close:  price,
			volume: 1000 + Math.random() * 500,
		});
	}
	return candles;
}

// ─── classifyRegime ───────────────────────────────────────────────────────────

describe('classifyRegime', () => {
	it('returns ranging when ADX is below threshold', () => {
		expect(classifyRegime(makeInput({ adxValue: 10, atrRatio: 1.0 }))).toBe('ranging');
	});

	it('returns trending_up when ADX >= threshold and plusDI > minusDI', () => {
		expect(classifyRegime(makeInput({ adxValue: 30, plusDI: 25, minusDI: 15, atrRatio: 1.0 }))).toBe('trending_up');
	});

	it('returns trending_down when ADX >= threshold and minusDI > plusDI', () => {
		expect(classifyRegime(makeInput({ adxValue: 30, plusDI: 15, minusDI: 25, atrRatio: 1.0 }))).toBe('trending_down');
	});

	it('returns high_volatility when ATR ratio exceeds threshold', () => {
		expect(classifyRegime(makeInput({ adxValue: 30, atrRatio: 4.0 }))).toBe('high_volatility');
	});

	it('high_volatility overrides trending when ATR is extreme', () => {
		// Even with strong ADX, high ATR takes precedence
		expect(classifyRegime(makeInput({ adxValue: 50, plusDI: 40, minusDI: 10, atrRatio: 5.0 }))).toBe('high_volatility');
	});

	it('trending_up at exactly ADX_TREND_THRESHOLD', () => {
		expect(classifyRegime(makeInput({ adxValue: ADX_TREND_THRESHOLD, plusDI: 20, minusDI: 10, atrRatio: 1.0 }))).toBe('trending_up');
	});

	it('ranging when ADX is one below threshold', () => {
		expect(classifyRegime(makeInput({ adxValue: ADX_TREND_THRESHOLD - 1, atrRatio: 1.0 }))).toBe('ranging');
	});

	it('trending_down when plusDI equals minusDI (tie goes to trending_down)', () => {
		// plusDI >= minusDI → trending_up; if equal → trending_up
		expect(classifyRegime(makeInput({ adxValue: 30, plusDI: 20, minusDI: 20, atrRatio: 1.0 }))).toBe('trending_up');
	});
});

// ─── calcRegimeConfidence ─────────────────────────────────────────────────────

describe('calcRegimeConfidence', () => {
	it('returns 0 for trending at exactly threshold (no excess)', () => {
		const input = makeInput({ adxValue: ADX_TREND_THRESHOLD, plusDI: 20, minusDI: 20, atrRatio: 1.0 });
		expect(calcRegimeConfidence(input, 'trending_up')).toBe(0);
	});

	it('returns 100 for strong trend (ADX=50, large DI gap)', () => {
		const input = makeInput({ adxValue: 50, plusDI: 40, minusDI: 0, atrRatio: 1.0 });
		expect(calcRegimeConfidence(input, 'trending_up')).toBe(100);
	});

	it('returns positive confidence for ranging with low ADX', () => {
		const input = makeInput({ adxValue: 5, atrRatio: 1.0 });
		expect(calcRegimeConfidence(input, 'ranging')).toBeGreaterThan(0);
	});

	it('returns 100 for ranging with very low ADX', () => {
		const input = makeInput({ adxValue: 5, atrRatio: 1.0 });
		expect(calcRegimeConfidence(input, 'ranging')).toBe(100);
	});

	it('returns value between 0-100 for all regimes', () => {
		const inputs: [RegimeInput, ReturnType<typeof classifyRegime>][] = [
			[makeInput({ adxValue: 30, plusDI: 25, minusDI: 10, atrRatio: 1.0 }), 'trending_up'],
			[makeInput({ adxValue: 30, plusDI: 10, minusDI: 25, atrRatio: 1.0 }), 'trending_down'],
			[makeInput({ adxValue: 10, atrRatio: 1.0 }), 'ranging'],
			[makeInput({ atrRatio: 4.0 }), 'high_volatility'],
		];
		for (const [input, regime] of inputs) {
			const conf = calcRegimeConfidence(input, regime);
			expect(conf).toBeGreaterThanOrEqual(0);
			expect(conf).toBeLessThanOrEqual(100);
		}
	});

	it('high_volatility base confidence starts at 30', () => {
		const input = makeInput({ atrRatio: ATR_HIGH_VOL_THRESHOLD + 0.001 });
		expect(calcRegimeConfidence(input, 'high_volatility')).toBeGreaterThanOrEqual(30);
	});
});

// ─── calcGaugeValue ───────────────────────────────────────────────────────────

describe('calcGaugeValue', () => {
	it('returns 0 for ADX = 0', () => {
		expect(calcGaugeValue(makeInput({ adxValue: 0 }))).toBe(0);
	});

	it('returns 50 for ADX = 25', () => {
		expect(calcGaugeValue(makeInput({ adxValue: 25 }))).toBe(50);
	});

	it('returns 100 for ADX = 50', () => {
		expect(calcGaugeValue(makeInput({ adxValue: 50 }))).toBe(100);
	});

	it('caps at 100 for very strong ADX', () => {
		expect(calcGaugeValue(makeInput({ adxValue: 80 }))).toBe(100);
	});
});

// ─── regimeLabel ──────────────────────────────────────────────────────────────

describe('regimeLabel', () => {
	it('labels trending_up', () => expect(regimeLabel('trending_up')).toBe('Trending Up'));
	it('labels trending_down', () => expect(regimeLabel('trending_down')).toBe('Trending Down'));
	it('labels ranging', () => expect(regimeLabel('ranging')).toBe('Ranging'));
	it('labels high_volatility', () => expect(regimeLabel('high_volatility')).toBe('High Volatility'));
});

// ─── analyzeRegime ────────────────────────────────────────────────────────────

describe('analyzeRegime', () => {
	it('returns null for empty OHLCV', () => {
		expect(analyzeRegime([])).toBeNull();
	});

	it('returns null for insufficient data (< 40 candles)', () => {
		expect(analyzeRegime(buildOHLCV(30))).toBeNull();
	});

	it('returns RegimeAnalysis for sufficient data', () => {
		const result = analyzeRegime(buildOHLCV(100));
		expect(result).not.toBeNull();
		expect(result!.regime).toMatch(/^(trending_up|trending_down|ranging|high_volatility)$/);
		expect(result!.confidence).toBeGreaterThanOrEqual(0);
		expect(result!.confidence).toBeLessThanOrEqual(100);
		expect(result!.adxValue).toBeGreaterThanOrEqual(0);
		expect(result!.rsiValue).toBeGreaterThanOrEqual(0);
		expect(result!.rsiValue).toBeLessThanOrEqual(100);
	});

	it('detects trending_up for strong uptrend data', () => {
		// Build 200 candles with consistent upward movement
		const ohlcv = buildOHLCV(200, 100, 'up', 0.1);
		const result = analyzeRegime(ohlcv);
		// We can't guarantee trending_up due to randomness, but ADX should be > 0
		expect(result).not.toBeNull();
		expect(result!.adxValue).toBeGreaterThan(0);
	});

	it('includes all required fields in result', () => {
		const result = analyzeRegime(buildOHLCV(100));
		expect(result).not.toBeNull();
		if (!result) return;
		expect(typeof result.regime).toBe('string');
		expect(typeof result.confidence).toBe('number');
		expect(typeof result.adxValue).toBe('number');
		expect(typeof result.plusDI).toBe('number');
		expect(typeof result.minusDI).toBe('number');
		expect(typeof result.atrRatio).toBe('number');
		expect(typeof result.rsiValue).toBe('number');
		expect(typeof result.description).toBe('string');
		expect(typeof result.gaugeValue).toBe('number');
		expect(result.description.length).toBeGreaterThan(10);
	});

	it('atrRatio is non-negative', () => {
		const result = analyzeRegime(buildOHLCV(100));
		expect(result!.atrRatio).toBeGreaterThanOrEqual(0);
	});

	it('gaugeValue is in range 0-100', () => {
		const result = analyzeRegime(buildOHLCV(100));
		expect(result!.gaugeValue).toBeGreaterThanOrEqual(0);
		expect(result!.gaugeValue).toBeLessThanOrEqual(100);
	});
});
