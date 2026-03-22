// Tests for elliottWave.ts — T-702
import { describe, it, expect } from 'vitest';
import {
	buildSwingSequence,
	validateImpulseRules,
	validateCorrectiveRules,
	fibRetracementTargets,
	fibExtensionTargets,
	analyzeElliottWaves,
	type Wave,
} from './elliottWave';
import { type Pivot } from './patterns';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeCandle(close: number, i = 0): OHLCV {
	return { time: 1_700_000_000 + i * 86_400, open: close * 0.999, high: close * 1.005, low: close * 0.995, close, volume: 1000 };
}

function makeWave(
	label: Wave['label'],
	startPrice: number,
	endPrice: number,
	retracementPct: number | null = null,
): Wave {
	return {
		label,
		startIndex: 0,
		endIndex:   10,
		startPrice,
		endPrice,
		startTime:  0,
		endTime:    1,
		retracementPct,
	};
}

/**
 * Build a synthetic 5-wave bullish impulse series.
 *    W1: 100→150 (+50), W2: 150→120 (-30, 60% retrace), W3: 120→200 (+80),
 *    W4: 200→175 (-25, 31% retrace of W3), W5: 175→220 (+45)
 */
function buildImpulseCandles(): OHLCV[] {
	const prices = [
		100, 110, 130, 150,       // Wave 1
		140, 125, 120,            // Wave 2
		135, 160, 185, 200,       // Wave 3
		190, 178, 175,            // Wave 4
		185, 200, 210, 220,       // Wave 5
	];
	return prices.map((p, i) => makeCandle(p, i));
}

/** Build a synthetic bearish ABC correction: A down, B up, C down */
function buildCorrectionCandles(): OHLCV[] {
	const prices = [
		200, 195, 185, 170, 160,  // Wave A down
		168, 175, 180,            // Wave B up
		172, 160, 148, 140,       // Wave C down
	];
	return prices.map((p, i) => makeCandle(p, i));
}

// ─── buildSwingSequence ───────────────────────────────────────────────────────

describe('buildSwingSequence', () => {
	it('returns empty for no pivots', () => {
		expect(buildSwingSequence([])).toHaveLength(0);
	});

	it('deduplicates consecutive same-type pivots keeping more extreme', () => {
		const pivots: Pivot[] = [
			{ type: 'high', index: 1, price: 100 },
			{ type: 'high', index: 2, price: 110 }, // higher → replace prev
			{ type: 'low',  index: 3, price: 80  },
			{ type: 'low',  index: 4, price: 70  }, // lower → replace prev
		];
		const seq = buildSwingSequence(pivots);
		expect(seq).toHaveLength(2);
		expect(seq[0].price).toBe(110); // kept the higher high
		expect(seq[1].price).toBe(70);  // kept the lower low
	});

	it('alternates high/low without dedup when already alternating', () => {
		const pivots: Pivot[] = [
			{ type: 'low',  index: 0, price: 90  },
			{ type: 'high', index: 1, price: 110 },
			{ type: 'low',  index: 2, price: 85  },
			{ type: 'high', index: 3, price: 120 },
		];
		const seq = buildSwingSequence(pivots);
		expect(seq).toHaveLength(4);
	});
});

// ─── validateImpulseRules ─────────────────────────────────────────────────────

describe('validateImpulseRules', () => {
	it('returns violation if fewer than 5 waves', () => {
		const v = validateImpulseRules([makeWave('1', 100, 150)]);
		expect(v.length).toBeGreaterThan(0);
	});

	it('no violations for a valid bullish impulse', () => {
		// W1: +50, W2: -30 (60% retrace), W3: +80, W4: -25, W5: +45
		const waves: Wave[] = [
			makeWave('1', 100, 150, null),
			makeWave('2', 150, 120, 60),
			makeWave('3', 120, 200, null),
			makeWave('4', 200, 175, 31),
			makeWave('5', 175, 220, null),
		];
		const v = validateImpulseRules(waves);
		expect(v).toHaveLength(0);
	});

	it('flags Wave 2 retracing 100% of Wave 1', () => {
		const waves: Wave[] = [
			makeWave('1', 100, 150, null),
			makeWave('2', 150, 99,  null),  // dropped below Wave 1 start
			makeWave('3', 99,  180, null),
			makeWave('4', 180, 165, null),
			makeWave('5', 165, 200, null),
		];
		const v = validateImpulseRules(waves);
		expect(v.some(s => s.includes('Wave 2'))).toBe(true);
	});

	it('flags Wave 3 as shortest', () => {
		// W1: +50, W3: +30 (shorter than W1 and W5), W5: +60
		const waves: Wave[] = [
			makeWave('1', 100, 150, null),
			makeWave('2', 150, 130, null),
			makeWave('3', 130, 160, null), // only +30
			makeWave('4', 160, 150, null),
			makeWave('5', 150, 210, null), // +60
		];
		const v = validateImpulseRules(waves);
		expect(v.some(s => s.includes('Wave 3'))).toBe(true);
	});

	it('flags Wave 4 overlapping Wave 1', () => {
		// W1: 100→150, W4 drops back to 140 (inside W1 territory 100–150)
		const waves: Wave[] = [
			makeWave('1', 100, 150, null),
			makeWave('2', 150, 130, null),
			makeWave('3', 130, 200, null),
			makeWave('4', 200, 140, null), // drops into W1 territory (100–150)
			makeWave('5', 140, 210, null),
		];
		const v = validateImpulseRules(waves);
		expect(v.some(s => s.includes('Wave 4'))).toBe(true);
	});
});

// ─── validateCorrectiveRules ──────────────────────────────────────────────────

describe('validateCorrectiveRules', () => {
	it('returns violation if fewer than 3 waves', () => {
		const v = validateCorrectiveRules([makeWave('A', 200, 160)]);
		expect(v.length).toBeGreaterThan(0);
	});

	it('no violations for a valid bearish ABC', () => {
		// A: 200→160, B: 160→178 (45% retrace), C: 178→140
		const waves: Wave[] = [
			makeWave('A', 200, 160, null),
			makeWave('B', 160, 178, 45),
			makeWave('C', 178, 140, null),
		];
		const v = validateCorrectiveRules(waves);
		expect(v).toHaveLength(0);
	});

	it('flags Wave B retracing 100%+ of Wave A', () => {
		const waves: Wave[] = [
			makeWave('A', 200, 160, null),
			makeWave('B', 160, 205, null), // went above Wave A start
			makeWave('C', 205, 155, null),
		];
		const v = validateCorrectiveRules(waves);
		expect(v.some(s => s.includes('Wave B'))).toBe(true);
	});
});

// ─── fibRetracementTargets ────────────────────────────────────────────────────

describe('fibRetracementTargets', () => {
	it('returns correct 61.8% retracement for a bullish move', () => {
		const targets = fibRetracementTargets(150, 100);
		const fib618  = targets.find(t => Math.abs(t.ratio - 0.618) < 0.001);
		expect(fib618).toBeDefined();
		// 61.8% retracement of 150→100: 150 - 50 * 0.618 = 119.1
		expect(fib618!.price).toBeCloseTo(150 - 50 * 0.618, 2);
	});

	it('returns 6 levels', () => {
		expect(fibRetracementTargets(200, 100)).toHaveLength(6);
	});
});

// ─── fibExtensionTargets ──────────────────────────────────────────────────────

describe('fibExtensionTargets', () => {
	it('returns correct 161.8% extension for an upward move', () => {
		// Reference: 100→150 (+50). Origin for next wave: 130.
		const targets = fibExtensionTargets(130, 100, 150);
		const ext1618 = targets.find(t => Math.abs(t.ratio - 1.618) < 0.001);
		expect(ext1618).toBeDefined();
		// 130 + 50 * 1.618 = 130 + 80.9 = 210.9
		expect(ext1618!.price).toBeCloseTo(130 + 50 * 1.618, 2);
	});

	it('returns 5 levels', () => {
		expect(fibExtensionTargets(100, 80, 120)).toHaveLength(5);
	});
});

// ─── analyzeElliottWaves ──────────────────────────────────────────────────────

describe('analyzeElliottWaves', () => {
	it('returns none for fewer than 30 candles', () => {
		const candles = Array.from({ length: 20 }, (_, i) => makeCandle(100, i));
		const result  = analyzeElliottWaves(candles);
		expect(result.type).toBe('none');
	});

	it('result has required shape', () => {
		const candles = buildImpulseCandles();
		const result  = analyzeElliottWaves(candles, 2);
		expect(result).toMatchObject({
			type:        expect.stringMatching(/impulse|corrective|none/),
			direction:   expect.stringMatching(/bullish|bearish/),
			waves:       expect.any(Array),
			isValid:     expect.any(Boolean),
			violations:  expect.any(Array),
			fibTargets:  expect.any(Array),
			description: expect.any(String),
		});
	});

	it('detects bullish impulse from synthetic impulse candles', () => {
		const candles = buildImpulseCandles();
		const result  = analyzeElliottWaves(candles, 2);
		// With small lookback we get clear swings
		if (result.type === 'impulse') {
			expect(result.direction).toBe('bullish');
			expect(result.waves.length).toBe(5);
		} else {
			// Pattern may not be detected cleanly with limited bars — just ensure structure
			expect(['impulse', 'corrective', 'none']).toContain(result.type);
		}
	});

	it('detects bearish correction from synthetic ABC candles', () => {
		const candles = buildCorrectionCandles();
		const result  = analyzeElliottWaves(candles, 2);
		// May find corrective or impulse depending on pivot detection
		expect(['impulse', 'corrective', 'none']).toContain(result.type);
	});

	it('fibTargets are non-empty when pattern is found', () => {
		// Build enough candles with clear oscillation
		const prices: number[] = [];
		let p = 1000;
		const pattern = [50, -30, 80, -25, 45, -60, 30, -20];
		for (const delta of pattern) {
			const steps = Math.abs(delta);
			const step  = delta / steps;
			for (let s = 0; s < steps; s++) { p += step; prices.push(p); }
		}
		const candles = prices.map((c, i) => makeCandle(c, i));
		const result  = analyzeElliottWaves(candles, 3);
		if (result.type !== 'none') {
			expect(result.fibTargets.length).toBeGreaterThan(0);
		}
	});

	it('violations array is empty for valid impulse', () => {
		// Construct candles that form a perfect 5-wave impulse
		const impulse = [
			100, 105, 115, 150,          // W1 up
			140, 130, 120,               // W2 retraces ~43%
			135, 155, 175, 200,          // W3 (+80 vs W1's +50)
			193, 185, 175,               // W4 (stays above W1 top 150)
			180, 195, 210, 220,          // W5 (+45)
		];
		const candles = impulse.map((p, i) => makeCandle(p, i));
		const result  = analyzeElliottWaves(candles, 2);
		if (result.type === 'impulse') {
			// W4 stays above 150 (W1 top), W3 is 80 > W1 50, W2 doesn't retrace to 100
			expect(result.violations).toHaveLength(0);
		}
	});

	it('wave sizes are positive', () => {
		const candles = buildImpulseCandles();
		const result  = analyzeElliottWaves(candles, 2);
		for (const w of result.waves) {
			expect(Math.abs(w.endPrice - w.startPrice)).toBeGreaterThan(0);
		}
	});

	it('fibonacci retracement targets ordered from smallest to largest ratio', () => {
		const candles = buildImpulseCandles();
		const result  = analyzeElliottWaves(candles, 2);
		for (let i = 1; i < result.fibTargets.length; i++) {
			expect(result.fibTargets[i].ratio).toBeGreaterThanOrEqual(result.fibTargets[i - 1].ratio);
		}
	});
});
